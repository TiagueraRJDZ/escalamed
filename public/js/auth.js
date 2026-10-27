// Sessão do usuário: proteção das páginas, criação do perfil e saída.
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  doc,
  getDoc,
  writeBatch,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { auth, db, navigate } from './firebase.js';
import { normalize, searchKeywords } from './validators.js';

const HOME = '/schedules.html';

// Espera o Firebase dizer se há alguém logado (só a primeira resposta)
export function currentUser() {
  return new Promise((resolve) => {
    const stop = onAuthStateChanged(auth, (user) => {
      stop();
      resolve(user);
    });
  });
}

// Páginas internas: sem login, volta para a tela de entrada
export async function requireAuth() {
  const user = await currentUser();
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    navigate(`/?next=${next}`, { replace: true });
    return new Promise(() => {}); // a página para aqui enquanto redireciona
  }
  return user;
}

// Para onde ir depois de entrar (só caminhos internos, para evitar redirecionamento malicioso)
export function nextUrl() {
  const next = new URLSearchParams(location.search).get('next');
  return next && next.startsWith('/') && !next.startsWith('//') ? next : HOME;
}

// Cria o perfil no Firestore no primeiro acesso (cadastro ou primeiro login)
export async function ensureUserProfile(user, fallbackName = '') {
  const userRef = doc(db, 'users', user.uid);
  const snapshot = await getDoc(userRef);
  if (snapshot.exists()) return;

  let name = (user.displayName || fallbackName || user.email?.split('@')[0] || '').trim().slice(0, 80);
  if (name.length < 2) name = 'Usuário';

  const batch = writeBatch(db);
  batch.set(userRef, {
    name,
    nameLower: normalize(name),
    photoURL: user.photoURL ?? null,
    username: null,
    categoryId: null,
    searchKeywords: searchKeywords(name),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'users', user.uid, 'private', 'data'), {
    email: user.email ?? null,
    phone: null,
    cpf: null,
    state: null,
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
}

export async function signOutUser() {
  await signOut(auth);
  navigate('/', { replace: true });
}
