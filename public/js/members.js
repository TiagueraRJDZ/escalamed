// Operações de membros e convites. Cada uma grava o grupo e os cartões no mesmo lote,
// do jeito que o firestore.rules exige (o cargo do cartão precisa bater com os arrays do grupo).
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  writeBatch,
  setDoc,
  updateDoc,
  deleteDoc,
  arrayUnion,
  serverTimestamp,
  Timestamp,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { auth, db, isLeaving } from './firebase.js';
import { ROLE_ARRAY, roleOf, changeRolePatch, removeMemberPatch } from './permissions.js';

export const INVITE_DAYS = 7;

// Dados do perfil copiados para o cartão do membro (evita uma leitura por pessoa).
// O cartão é sempre gravado pela própria pessoa: o e-mail é o da conta logada
// (as regras recusam outro), usado na busca da aba Membros.
export function memberCard(profile = {}) {
  return {
    name: profile.name ?? 'Usuário',
    email: auth.currentUser?.email?.toLowerCase() ?? null,
    photoURL: profile.photoURL ?? null,
    categoryId: profile.categoryId ?? null,
    specialty: profile.specialty ?? null,
    council: profile.council ?? null,
  };
}

const groupRef = (groupId) => doc(db, 'groups', groupId);
const memberRef = (groupId, uid) => doc(db, 'groups', groupId, 'members', uid);
// Convite por e-mail (id = e-mail em minúsculas) ou por pessoa da plataforma (id = uid;
// o e-mail dela continua privado). inviteKey devolve o id de um convite.
export const inviteKey = (invite) => invite.uid ?? invite.email;
const inviteRef = (groupId, key) => doc(db, 'groups', groupId, 'invites', key.includes('@') ? key.toLowerCase() : key);

// Muda o cargo de alguém. Para "manager" é a transferência de gestão:
// o gestor antigo vira auxiliar (se houver vaga) ou plantonista.
export async function changeRole(group, uid, newRole) {
  const patch = changeRolePatch(group, uid, newRole);
  const after = { ...group, ...patch };
  const batch = writeBatch(db);
  batch.update(groupRef(group.id), { ...patch, updatedAt: serverTimestamp() });
  batch.update(memberRef(group.id, uid), { role: newRole });
  const previousManager = group.managerIds?.[0];
  if (newRole === 'manager' && previousManager && previousManager !== uid) {
    batch.update(memberRef(group.id, previousManager), { role: roleOf(after, previousManager) });
  }
  await batch.commit();
}

// Remover alguém (gestor/auxiliar) ou sair do grupo (a própria pessoa)
export async function removeMember(group, uid) {
  const batch = writeBatch(db);
  batch.update(groupRef(group.id), { ...removeMemberPatch(group, uid), updatedAt: serverTimestamp() });
  batch.delete(memberRef(group.id, uid));
  await batch.commit();
}

// target: { email } ou { uid, name } (pessoa escolhida na busca)
export async function createInvite(group, target, role, inviter) {
  const now = Date.now();
  const who = target.uid ? { uid: target.uid, name: target.name } : { email: target.email.toLowerCase() };
  await setDoc(inviteRef(group.id, inviteKey(who)), {
    ...who,
    role,
    groupName: group.name,
    unitName: group.unit?.name ?? null,
    invitedBy: inviter.uid,
    invitedByName: inviter.name,
    createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(now + INVITE_DAYS * 24 * 60 * 60 * 1000),
  });
}

export const cancelInvite = (groupId, key) => deleteDoc(inviteRef(groupId, key));

// Recusado pela pessoa convidada (fica guardado para quem convidou ver; ver watchSentInvites)
export const isDeclined = (invite) => invite?.status === 'declined';

// Recusar: marca o convite como recusado (não apaga), com o nome de quem recusou
export const declineInvite = (groupId, invite, name) =>
  updateDoc(inviteRef(groupId, inviteKey(invite)), {
    status: 'declined',
    respondedAt: serverTimestamp(),
    respondedByName: String(name || 'Convidado').slice(0, 80),
  });

export async function listInvites(groupId) {
  const snapshot = await getDocs(collection(db, 'groups', groupId, 'invites'));
  return snapshot.docs.map((d) => d.data());
}

// Convites pendentes de quem está logado (pelo e-mail ou pela pessoa), em todos os grupos
export async function myInvites(user) {
  const invites = collectionGroup(db, 'invites');
  const queries = [query(invites, where('uid', '==', user.uid))];
  if (user.email) queries.push(query(invites, where('email', '==', user.email.toLowerCase())));
  // Cada consulta vale sozinha: se uma falhar (ex.: índice ainda sendo criado),
  // os convites da outra continuam aparecendo
  const results = await Promise.allSettled(queries.map((q) => getDocs(q)));
  results
    .filter((r) => r.status === 'rejected')
    .forEach((r) => console.warn('Convites: uma das consultas falhou.', r.reason?.message ?? r.reason));
  return results
    .filter((r) => r.status === 'fulfilled')
    .flatMap((r) => r.value.docs)
    .map((d) => ({ groupId: d.ref.parent.parent.id, ...d.data() }))
    .filter((invite) => !isDeclined(invite) && invite.expiresAt?.toMillis() > Date.now());
}

// Escuta uma consulta em tempo real e, se ela falhar (ex.: índice ainda sendo criado logo
// depois de publicar, conexão caindo), tenta de novo sozinha a cada 30 s. Enquanto isso,
// fica a última lista que chegou. Devolve a função que para de escutar.
const RETRY_MS = 30000;

function listenWithRetry(q, onNext, label) {
  let stop = () => {};
  let timer = null;
  let stopped = false;
  const start = () => {
    stop = onSnapshot(
      q,
      // includeMetadataChanges: avisa também quando o servidor só confirma o que o cache já tinha
      { includeMetadataChanges: true },
      onNext,
      (error) => {
        if (stopped || isLeaving()) return;
        console.warn(`${label}: a consulta falhou; tentando de novo em 30 s.`, error.message);
        timer = setTimeout(start, RETRY_MS);
      },
    );
  };
  start();
  return () => {
    stopped = true;
    clearTimeout(timer);
    stop();
  };
}

// Convites pendentes em tempo real (as mesmas duas consultas de myInvites).
// onChange(lista, { synced }) a cada mudança; synced = as duas consultas já responderam
// pelo servidor (não só pelo cache local). Devolve a função que para de escutar.
export function watchMyInvites(user, onChange) {
  const invites = collectionGroup(db, 'invites');
  const queries = [query(invites, where('uid', '==', user.uid))];
  if (user.email) queries.push(query(invites, where('email', '==', user.email.toLowerCase())));
  const results = queries.map(() => null); // { docs, fromCache } de cada consulta

  const emit = () => {
    const byPath = new Map();
    results.forEach((r) => r?.docs.forEach((d) => byPath.set(d.ref.path, d)));
    const list = [...byPath.values()]
      .map((d) => ({ id: d.ref.path, groupId: d.ref.parent.parent.id, ...d.data() }))
      .filter((invite) => !isDeclined(invite) && invite.expiresAt?.toMillis() > Date.now())
      .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
    // Uma consulta falhando não esconde os convites da outra (ela tenta de novo sozinha)
    onChange(list, { synced: results.every((r) => r && !r.fromCache) });
  };

  const stops = queries.map((q, i) =>
    listenWithRetry(
      q,
      (snapshot) => {
        results[i] = { docs: snapshot.docs, fromCache: snapshot.metadata.fromCache };
        emit();
      },
      'Convites',
    ),
  );
  return () => stops.forEach((stop) => stop());
}

// Convites recusados que quem está logado mandou, em tempo real (para o sininho).
// onChange(lista, { synced }). Devolve a função que para de escutar.
export function watchDeclinedInvites(uid, onChange) {
  return listenWithRetry(
    query(collectionGroup(db, 'invites'), where('invitedBy', '==', uid)),
    (snapshot) => {
      const list = snapshot.docs
        .map((d) => ({ id: d.ref.path, groupId: d.ref.parent.parent.id, ...d.data() }))
        .filter(isDeclined)
        .sort((a, b) => (b.respondedAt?.toMillis?.() ?? 0) - (a.respondedAt?.toMillis?.() ?? 0));
      onChange(list, { synced: !snapshot.metadata.fromCache });
    },
    'Convites recusados',
  );
}

// Convite de quem está logado para um grupo (por pessoa ou por e-mail), ou null
export async function myInviteFor(groupId, user) {
  const keys = [user.uid, user.email?.toLowerCase()].filter(Boolean);
  for (const key of keys) {
    const snapshot = await getDoc(inviteRef(groupId, key)).catch(() => null);
    if (snapshot?.exists() && !isDeclined(snapshot.data())) return snapshot.data();
  }
  return null;
}

// Aceitar: entra no grupo (no cargo do convite), cria o cartão e apaga o convite
export async function acceptInvite(groupId, invite, user, profile) {
  const field = ROLE_ARRAY[invite.role];
  const batch = writeBatch(db);
  batch.update(groupRef(groupId), {
    memberIds: arrayUnion(user.uid),
    ...(field ? { [field]: arrayUnion(user.uid) } : {}),
    updatedAt: serverTimestamp(),
  });
  batch.set(memberRef(groupId, user.uid), {
    ...memberCard(profile),
    role: invite.role,
    joinedAt: serverTimestamp(),
    addedBy: invite.invitedBy,
  });
  batch.delete(inviteRef(groupId, inviteKey(invite)));
  await batch.commit();
}

export const inviteLink = (groupId) => `${location.origin}/invite.html?g=${encodeURIComponent(groupId)}`;

// Depois de mudar nome, e-mail, foto ou profissão: atualiza o cartão em todos os grupos
export async function syncMemberCards(uid, profile) {
  const snapshot = await getDocs(query(collection(db, 'groups'), where('memberIds', 'array-contains', uid)));
  if (snapshot.empty) return;
  const batch = writeBatch(db);
  snapshot.docs.forEach((g) => batch.update(memberRef(g.id, uid), memberCard(profile)));
  await batch.commit();
}
