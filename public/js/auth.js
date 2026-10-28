// Sessão do usuário: proteção das páginas (guards) e saída.
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { auth, db, navigate } from './firebase.js';

export const HOME = '/schedules.html';

// Páginas do fluxo de entrada: elas repassam o "next" em vez de virar o destino
const AUTH_PAGES = ['/', '/index.html', '/signup.html', '/verify-email.html'];

// Espera o Firebase dizer se há alguém logado (só a primeira resposta)
export function currentUser() {
  return new Promise((resolve) => {
    const stop = onAuthStateChanged(auth, (user) => {
      stop();
      resolve(user);
    });
  });
}

// Para onde ir depois de entrar (só caminhos internos, para evitar redirecionamento malicioso)
export function nextUrl() {
  const next = new URLSearchParams(location.search).get('next');
  return next && next.startsWith('/') && !next.startsWith('//') ? next : HOME;
}

// "?next=..." para levar adiante: a página atual, ou o next que ela já recebeu
export function nextParam() {
  const target = AUTH_PAGES.includes(location.pathname) ? nextUrl() : location.pathname + location.search;
  return target === HOME ? '' : `?next=${encodeURIComponent(target)}`;
}

export async function loadProfile(uid) {
  const snapshot = await getDoc(doc(db, 'users', uid));
  return snapshot.exists() ? snapshot.data() : null;
}

// Cadastro completo = passou pelas 4 etapas (signupStep guarda a última concluída)
export const isProfileComplete = (profile) => (profile?.signupStep ?? 0) >= 4;

const halt = () => new Promise(() => {}); // a página para aqui enquanto redireciona

// Guard das páginas. Ordem: login → e-mail verificado → cadastro completo.
// Devolve { user, profile } (profile só quando profileComplete = true).
export async function requireAuth({ verified = true, profileComplete = true } = {}) {
  const user = await currentUser();
  if (!user) {
    navigate(`/${nextParam()}`, { replace: true });
    return halt();
  }

  if (verified && !user.emailVerified) {
    // Pode ter confirmado em outra aba: atualiza antes de mandar para a verificação
    await user.reload().catch(() => {});
    if (user.emailVerified) {
      await user.getIdToken(true); // o banco só enxerga a verificação com um token novo
    } else {
      navigate(`/verify-email.html${nextParam()}`, { replace: true });
      return halt();
    }
  }

  let profile = null;
  if (profileComplete) {
    profile = await loadProfile(user.uid);
    if (!isProfileComplete(profile)) {
      navigate(`/signup.html${nextParam()}`, { replace: true });
      return halt();
    }
  }
  return { user, profile };
}

export async function signOutUser() {
  await signOut(auth);
  navigate('/', { replace: true });
}
