// Sessão do usuário: proteção das páginas (guards) e saída.
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  doc,
  getDoc,
  getDocFromCache,
  terminate,
  clearIndexedDbPersistence,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { auth, db, navigate, markLeaving } from './firebase.js';
import { mustChangePassword } from './auth-api.js';
import { nextParam } from './redirect.js';

export { HOME, nextUrl, nextParam } from './redirect.js';

// Espera o Firebase dizer se há alguém logado (só a primeira resposta)
export function currentUser() {
  return new Promise((resolve) => {
    const stop = onAuthStateChanged(auth, (user) => {
      stop();
      resolve(user);
    });
  });
}

export async function loadProfile(uid) {
  const snapshot = await getDoc(doc(db, 'users', uid));
  return snapshot.exists() ? snapshot.data() : null;
}

// Perfil para as páginas: primeiro o do cache local (na hora) e, se ele estiver completo,
// confere o do servidor em seguida (atualiza o mesmo objeto e avisa com o evento
// "escalamed:perfil"). Sem cache, ou cadastro incompleto no cache, espera o servidor:
// a decisão de mandar para o cadastro é sempre com o dado do servidor.
async function loadProfileFast(uid) {
  const ref = doc(db, 'users', uid);
  const cached = await getDocFromCache(ref)
    .then((s) => (s.exists() ? s.data() : null))
    .catch(() => null);
  if (!isProfileComplete(cached)) return loadProfile(uid);

  loadProfile(uid)
    .then((fresh) => {
      if (!isProfileComplete(fresh)) {
        navigate(`/signup.html${nextParam()}`, { replace: true });
        return;
      }
      Object.assign(cached, fresh);
      saveSessionSummary(auth.currentUser ?? { uid }, cached);
      window.dispatchEvent(new CustomEvent('escalamed:perfil', { detail: cached }));
    })
    .catch(() => {}); // sem conexão: fica o do cache
  return cached;
}

// Cadastro completo = passou pelas 4 etapas (signupStep guarda a última concluída)
export const isProfileComplete = (profile) => (profile?.signupStep ?? 0) >= 4;

// ---------- Resumo da sessão (sessionStorage) ----------
// O layout desenha o menu e a barra do topo na hora com este resumo, enquanto o login é
// conferido de verdade em paralelo (requireAuth). Guarda só o que o menu mostra.
const SESSION_KEY = 'escalamed:sessao';

export function saveSessionSummary(user, profile) {
  try {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        uid: user.uid,
        email: user.email ?? '',
        profile: { name: profile?.name ?? '', photoURL: profile?.photoURL ?? null, categoryId: profile?.categoryId ?? null },
      }),
    );
  } catch {
    // sem armazenamento (aba anônima, cota cheia): o layout só espera o login
  }
}

// { uid, email, profile } ou null
export function readSessionSummary() {
  try {
    const data = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null');
    return data?.uid ? data : null;
  } catch {
    return null;
  }
}

// Ao sair: apaga o resumo e as respostas guardadas da sessão (administrador, gestor...)
function clearSession() {
  try {
    Object.keys(sessionStorage)
      .filter((key) => key.startsWith('escalamed:'))
      .forEach((key) => sessionStorage.removeItem(key));
  } catch {
    // sem armazenamento
  }
}

const halt = () => new Promise(() => {}); // a página para aqui enquanto redireciona

// Guard das páginas. Ordem: login → senha provisória trocada → cadastro completo.
// Devolve { user, profile } (profile só quando profileComplete = true).
export async function requireAuth({ profileComplete = true, allowTemporaryPassword = false } = {}) {
  const user = await currentUser();
  if (!user) {
    navigate(`/${nextParam()}`, { replace: true });
    return halt();
  }

  // As duas consultas correm em paralelo; a ordem das verificações continua a mesma
  const [temporary, profile] = await Promise.all([
    allowTemporaryPassword ? false : mustChangePassword(user),
    profileComplete ? loadProfileFast(user.uid) : null,
  ]);

  // Entrou com senha provisória (gerada pelo administrador): cria uma senha nova antes de tudo
  if (temporary) {
    navigate(`/new-password.html${nextParam()}`, { replace: true });
    return halt();
  }

  if (profileComplete) {
    if (!isProfileComplete(profile)) {
      navigate(`/signup.html${nextParam()}`, { replace: true });
      return halt();
    }
    saveSessionSummary(user, profile);
  }
  return { user, profile };
}

export async function signOutUser() {
  clearSession();
  await signOut(auth);
  // Apaga o cache local do Firestore (dados da conta não ficam no aparelho).
  // Com outra aba do app aberta não dá para apagar agora; fica para a próxima saída.
  markLeaving(); // as listas em tempo real vão receber "shutting down": não é erro
  await terminate(db).catch(() => {});
  await clearIndexedDbPersistence(db).catch(() => {});
  navigate('/', { replace: true });
}
