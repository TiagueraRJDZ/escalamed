// Cargo de quem está logado: administrador da plataforma (config/admins) e a aprovação do
// cargo pedido (access/{uid}). A resposta fica guardada na sessão para o menu não piscar
// a cada troca de página; cada página confere de novo em segundo plano.
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db } from './firebase.js';
import { platformRoleOf, approvalState } from './permissions.js';

const storageKey = (uid) => `escalamed:acesso:${uid}`;

// { isAdmin, access, role } guardado na sessão (ou null)
export function cachedAccess(uid) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey(uid)) ?? 'null');
    return saved && typeof saved === 'object' ? saved : null;
  } catch {
    return null;
  }
}

function save(uid, value) {
  try {
    sessionStorage.setItem(storageKey(uid), JSON.stringify(value));
  } catch {
    // sem armazenamento: só consulta de novo na próxima página
  }
}

export function forgetAccess(uid) {
  try {
    sessionStorage.removeItem(storageKey(uid));
  } catch {
    // sem armazenamento
  }
}

// Lê do servidor. Falhou a leitura: devolve o que estava guardado (ou sem cargo).
export async function loadMyAccess(uid) {
  try {
    const [admins, mine] = await Promise.all([getDoc(doc(db, 'config', 'admins')), getDoc(doc(db, 'access', uid))]);
    const isAdmin = (admins.data()?.uids ?? []).includes(uid);
    const access = mine.exists() ? { categoryId: mine.data().categoryId ?? null, approved: mine.data().approved === true } : null;
    const value = { isAdmin, access, role: platformRoleOf({ isAdmin, access }) };
    save(uid, value);
    return value;
  } catch {
    return cachedAccess(uid) ?? { isAdmin: false, access: null, role: null };
  }
}

// Situação do cargo pedido no perfil ('none' | 'pending' | 'approved' | 'declined')
export const myApprovalState = (profile, value) => (value?.isAdmin ? 'none' : approvalState(profile, value?.access));
