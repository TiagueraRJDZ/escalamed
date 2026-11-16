// Grupos que quem está logado pode ver, com o papel dele em cada um, e os membros de um grupo.
// Usado pela lista de Escalas e pelas páginas globais (Relatórios e Histórico).
import { collection, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db } from './firebase.js';
import { groupRole, seesAllGroups, can } from './permissions.js';
import { listenWithRetry } from './live.js';

// Consultas que as regras deixam fazer: grupos em que está, grupos que coordena e,
// para Gestor e Administrativo, todos os grupos de equipe. Dev: todos, inclusive as escalas
// individuais dos outros.
export function groupQueries(uid, platformRole) {
  const groups = collection(db, 'groups');
  const list = [query(groups, where('memberIds', 'array-contains', uid))];
  if (platformRole === 'coordenador') list.push(query(groups, where('coordinatorIds', 'array-contains', uid)));
  if (platformRole === 'dev') list.push(query(groups));
  else if (seesAllGroups(platformRole)) list.push(query(groups, where('type', '==', 'team')));
  return list;
}

// Junta os resultados das consultas sem repetir grupo, cada um com { role }
export function mergeGroups(snapshots, uid, platformRole) {
  const byId = new Map();
  snapshots.forEach((snapshot) => snapshot?.docs.forEach((d) => byId.set(d.id, { id: d.id, ...d.data() })));
  return [...byId.values()].map((g) => ({ ...g, role: groupRole(g, uid, platformRole) })).filter((g) => g.role);
}

const readySorted = (list) =>
  list.filter((g) => g.setupStep === 'done').sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

// Grupos prontos (wizard concluído), em ordem alfabética, cada um com { role }
export async function loadMyGroups(uid, platformRole = null) {
  const snapshots = await Promise.all(groupQueries(uid, platformRole).map((q) => getDocs(q)));
  return readySorted(mergeGroups(snapshots, uid, platformRole));
}

// Os mesmos grupos, em tempo real: onChange(lista) quando todas as consultas responderam e a
// cada mudança (entrou, saiu, grupo novo, nome trocado). Devolve a função que para de escutar.
export function watchMyGroups(uid, platformRole, onChange) {
  const queries = groupQueries(uid, platformRole);
  const snapshots = queries.map(() => null);
  const emit = () => snapshots.every(Boolean) && onChange(readySorted(mergeGroups(snapshots, uid, platformRole)));
  const stops = queries.map((q, i) =>
    listenWithRetry(q, (snapshot) => ((snapshots[i] = snapshot), emit()), 'Grupos', {
      // Uma consulta falhando não segura as outras (ela tenta de novo sozinha)
      onError: () => ((snapshots[i] ??= { docs: [] }), emit()),
    }),
  );
  return () => stops.forEach((stop) => stop());
}

// Cartões de membro do grupo em tempo real (mesma ordem de loadMembers)
export const watchMembers = (groupId, onChange) =>
  listenWithRetry(collection(db, 'groups', groupId, 'members'), (snapshot) => onChange(membersFrom(snapshot)), 'Membros');

// Vê escalas em rascunho (e o histórico delas): Gestor, coordenador do grupo e dono
export const seesDrafts = (group) => can(group.role, 'viewDraft');

// "Antonio Prudente · Fortaleza/CE"
export function groupLabel(group) {
  if (group.type === 'personal') return `${group.name} · Escala individual`;
  return group.unit ? `${group.name} · ${group.unit.city}/${group.unit.state}` : group.name;
}

// Cartões de membro do grupo (nome, foto, cargo), em ordem alfabética
const membersFrom = (snapshot) =>
  snapshot.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'pt-BR'));

export async function loadMembers(groupId) {
  return membersFrom(await getDocs(collection(db, 'groups', groupId, 'members')));
}

// Último grupo escolhido numa página (lembrado por navegador)
export function rememberGroup(page, id) {
  try {
    localStorage.setItem(`escalamed:${page}:grupo`, id);
  } catch {
    // sem armazenamento: só não lembra
  }
}

export function lastGroup(page) {
  try {
    return localStorage.getItem(`escalamed:${page}:grupo`);
  } catch {
    return null;
  }
}
