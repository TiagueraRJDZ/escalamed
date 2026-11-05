// Grupos de quem está logado, com o cargo em cada um, e os membros de um grupo.
// Usado pelas páginas globais (Relatórios e Histórico), que ficam fora de um grupo.
import { collection, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db } from './firebase.js';
import { roleOf } from './permissions.js';

// Grupos prontos (wizard concluído), em ordem alfabética, cada um com { role }
export async function loadMyGroups(uid) {
  const snapshot = await getDocs(query(collection(db, 'groups'), where('memberIds', 'array-contains', uid)));
  return snapshot.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((g) => g.setupStep === 'done')
    .map((g) => ({ ...g, role: roleOf(g, uid) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

// Quem vê escalas em rascunho (e o histórico delas): gestor, auxiliar e analista
export const seesDrafts = (group) => ['manager', 'assistant', 'analyst'].includes(group.role);

// "Antonio Prudente · Fortaleza/CE"
export function groupLabel(group) {
  if (group.type === 'personal') return `${group.name} · Escala individual`;
  return group.unit ? `${group.name} · ${group.unit.city}/${group.unit.state}` : group.name;
}

// Cartões de membro do grupo (nome, foto, profissão), em ordem alfabética
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
