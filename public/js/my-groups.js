// Grupos que quem está logado pode ver, com o papel dele em cada um, e os membros de um grupo.
// Usado pela lista de Escalas e pelas páginas globais (Relatórios e Histórico).
import { collection, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db } from './firebase.js';
import { groupRole, seesAllGroups, can } from './permissions.js';

// Consultas que as regras deixam fazer: grupos em que está, grupos que coordena e,
// para Gestor e Administrativo, todos os grupos de equipe
export function groupQueries(uid, platformRole) {
  const groups = collection(db, 'groups');
  const list = [query(groups, where('memberIds', 'array-contains', uid))];
  if (platformRole === 'coordenador') list.push(query(groups, where('coordinatorIds', 'array-contains', uid)));
  if (seesAllGroups(platformRole)) list.push(query(groups, where('type', '==', 'team')));
  return list;
}

// Junta os resultados das consultas sem repetir grupo, cada um com { role }
export function mergeGroups(snapshots, uid, platformRole) {
  const byId = new Map();
  snapshots.forEach((snapshot) => snapshot?.docs.forEach((d) => byId.set(d.id, { id: d.id, ...d.data() })));
  return [...byId.values()].map((g) => ({ ...g, role: groupRole(g, uid, platformRole) })).filter((g) => g.role);
}

// Grupos prontos (wizard concluído), em ordem alfabética, cada um com { role }
export async function loadMyGroups(uid, platformRole = null) {
  const snapshots = await Promise.all(groupQueries(uid, platformRole).map((q) => getDocs(q)));
  return mergeGroups(snapshots, uid, platformRole)
    .filter((g) => g.setupStep === 'done')
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

// Vê escalas em rascunho (e o histórico delas): Gestor, coordenador do grupo e dono
export const seesDrafts = (group) => can(group.role, 'viewDraft');

// "Antonio Prudente · Fortaleza/CE"
export function groupLabel(group) {
  if (group.type === 'personal') return `${group.name} · Escala individual`;
  return group.unit ? `${group.name} · ${group.unit.city}/${group.unit.state}` : group.name;
}

// Cartões de membro do grupo (nome, foto, cargo), em ordem alfabética
export async function loadMembers(groupId) {
  const snapshot = await getDocs(collection(db, 'groups', groupId, 'members'));
  return snapshot.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'pt-BR'));
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
