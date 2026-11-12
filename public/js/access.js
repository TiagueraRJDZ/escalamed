// Cargo de quem está logado: administrador da plataforma (config/admins) e a aprovação do
// cargo pedido (access/{uid}). A resposta fica guardada na sessão para o menu não piscar
// a cada troca de página; cada página confere de novo em segundo plano.
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db } from './firebase.js';
import { platformRoleOf, approvalState } from './permissions.js';

const storageKey = (uid) => `escalamed:acesso:${uid}`;

// { isDev, isAdmin, access, role } guardado na sessão (ou null)
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

// Dev: as regras só deixam o Dev ler config/dev (o documento pode nem existir).
// Leitura recusada = não é Dev; outro erro (sem conexão) sobe para usar o guardado.
const checkDev = () =>
  getDoc(doc(db, 'config', 'dev')).then(
    () => true,
    (error) => (error?.code === 'permission-denied' ? false : Promise.reject(error)),
  );

// Lê do servidor. Falhou a leitura: devolve o que estava guardado (ou sem cargo).
// O Dev vale também como administrador da plataforma (Configurações > Usuários completo).
export async function loadMyAccess(uid) {
  try {
    const [isDev, admins, mine] = await Promise.all([
      checkDev(),
      getDoc(doc(db, 'config', 'admins')),
      getDoc(doc(db, 'access', uid)),
    ]);
    const isAdmin = isDev || (admins.data()?.uids ?? []).includes(uid);
    const access = mine.exists() ? { categoryId: mine.data().categoryId ?? null, approved: mine.data().approved === true } : null;
    const value = { isDev, isAdmin, access, role: platformRoleOf({ isDev, isAdmin, access }) };
    save(uid, value);
    return value;
  } catch {
    // unknown: sem resposta do servidor nem nada guardado (não dá para dizer se foi aprovado)
    return cachedAccess(uid) ?? { isDev: false, isAdmin: false, access: null, role: null, unknown: true };
  }
}

// Situação do cargo pedido no perfil ('none' | 'pending' | 'approved' | 'declined')
export const myApprovalState = (profile, value) =>
  value?.isDev || value?.isAdmin ? 'none' : approvalState(profile, value?.access);

// Tela de espera: quem pediu Gestor, Coordenador de escala ou Administrativo só entra na
// plataforma depois de aprovado. Recusado também fica de fora até trocar de cargo.
export const PENDING_PAGE = '/aguardando.html';

export const isBarred = (profile, value) =>
  !value?.unknown && ['pending', 'declined'].includes(myApprovalState(profile, value));
