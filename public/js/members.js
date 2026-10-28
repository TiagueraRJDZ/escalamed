// Operações de membros e convites. Cada uma grava o grupo e os cartões no mesmo lote,
// do jeito que o firestore.rules exige (o cargo do cartão precisa bater com os arrays do grupo).
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch,
  setDoc,
  deleteDoc,
  arrayUnion,
  serverTimestamp,
  Timestamp,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { auth, db } from './firebase.js';
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

export async function listInvites(groupId) {
  const snapshot = await getDocs(collection(db, 'groups', groupId, 'invites'));
  return snapshot.docs.map((d) => d.data());
}

// Convites pendentes de quem está logado (pelo e-mail ou pela pessoa), em todos os grupos
export async function myInvites(user) {
  const invites = collectionGroup(db, 'invites');
  const queries = [query(invites, where('uid', '==', user.uid))];
  if (user.email) queries.push(query(invites, where('email', '==', user.email.toLowerCase())));
  const snapshots = await Promise.all(queries.map((q) => getDocs(q)));
  return snapshots
    .flatMap((s) => s.docs)
    .map((d) => ({ groupId: d.ref.parent.parent.id, ...d.data() }))
    .filter((invite) => invite.expiresAt?.toMillis() > Date.now());
}

// Convite de quem está logado para um grupo (por pessoa ou por e-mail), ou null
export async function myInviteFor(groupId, user) {
  const keys = [user.uid, user.email?.toLowerCase()].filter(Boolean);
  for (const key of keys) {
    const snapshot = await getDoc(inviteRef(groupId, key)).catch(() => null);
    if (snapshot?.exists()) return snapshot.data();
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
