// Login e senhas: Firebase Authentication (e-mail e senha, ou conta Google). O serviço de contas
// (Cloudflare Worker, pasta worker/) faz só o que o navegador não consegue sozinho:
// login por nome de usuário, senha provisória gerada pelo administrador e troca de e-mail
// sem link de confirmação.
import {
  signInWithEmailAndPassword,
  signInWithCustomToken,
  createUserWithEmailAndPassword,
  reauthenticateWithCredential,
  updatePassword,
  EmailAuthProvider,
  GoogleAuthProvider,
  signInWithPopup,
  reauthenticateWithPopup,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { auth } from './firebase.js';
import { authApiUrl } from './config.js';

// Erro do serviço de contas, com a mensagem pronta para mostrar
export class AuthApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'AuthApiError';
    this.status = status;
  }
}

async function call(route, body, { signedIn = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (signedIn) {
    if (!auth.currentUser) throw new AuthApiError('Entre de novo para continuar.', 401);
    headers.Authorization = `Bearer ${await auth.currentUser.getIdToken()}`;
  }
  let response;
  try {
    response = await fetch(`${authApiUrl}/${route}`, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch {
    throw new AuthApiError('Não foi possível falar com o serviço de contas. Verifique sua conexão e tente de novo.', 0);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new AuthApiError(data.erro || 'Não foi possível concluir. Tente de novo.', response.status);
  return data;
}

// A senha atual é provisória? (marca colocada pelo Worker quando o gestor gera a senha)
export async function mustChangePassword(user, { refresh = false } = {}) {
  const { claims } = await user.getIdTokenResult(refresh);
  return claims.trocarSenha === true;
}

// identifier: e-mail (direto no Firebase) ou nome de usuário (pelo Worker)
export async function signIn(identifier, password) {
  const value = identifier.trim();
  if (value.includes('@')) {
    await signInWithEmailAndPassword(auth, value, password);
  } else {
    const { token } = await call('entrar-usuario', { usuario: value, senha: password });
    await signInWithCustomToken(auth, token);
  }
  return { mustChangePassword: await mustChangePassword(auth.currentUser) };
}

export const signUp = (email, password) => createUserWithEmailAndPassword(auth, email, password);

// ---------- Conta Google ----------
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' }); // sempre deixa escolher a conta

// Abre a janela do Google. Primeiro acesso cria a conta no Firebase (o perfil vem no cadastro).
export const signInWithGoogle = () => signInWithPopup(auth, googleProvider);

// A conta tem senha? Quem entrou só pelo Google não tem, até criar uma nas Configurações.
export const hasPassword = (user = auth.currentUser) =>
  user?.providerData.some((provider) => provider.providerId === 'password') ?? false;

// Confere a identidade de novo (antes de ações sensíveis): pela senha ou, sem senha, pelo Google
export const reauthenticate = (password) =>
  hasPassword()
    ? reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(auth.currentUser.email, password))
    : reauthenticateWithPopup(auth.currentUser, googleProvider);

// Sem senha (conta Google), confirma pelo Google e a senha nova passa a valer também
export async function changePassword(currentPassword, newPassword) {
  await reauthenticate(currentPassword);
  await updatePassword(auth.currentUser, newPassword);
  // Era a senha provisória? Tira a marca e pega um token novo, já sem ela
  if (await mustChangePassword(auth.currentUser)) {
    await call('senha-definida', {}, { signedIn: true });
    await auth.currentUser.getIdToken(true);
  }
}

// Troca na hora, sem link: confere a senha aqui e o Worker altera a conta
export async function changeEmail(newEmail, password) {
  await reauthenticate(password);
  await call('trocar-email', { novoEmail: newEmail }, { signedIn: true });
  await auth.currentUser.reload();
  await auth.currentUser.getIdToken(true); // as regras passam a ver o e-mail novo
}

// Vazio remove o nome de usuário. Devolve o nome gravado (em minúsculas) ou null.
export const changeUsername = async (username) =>
  (await call('trocar-usuario', { usuario: username }, { signedIn: true })).usuario;

// ---------- Administrador da plataforma (Configurações > Usuários) ----------
// O Worker confere em config/admins se quem chamou é administrador.

// Todas as contas: [{ uid, email, usuario, inativa, provedores, criadaEm, ultimoAcesso }]
export const adminAccounts = async () => (await call('admin/contas', {}, { signedIn: true })).contas;

export const adminTemporaryPassword = async (uid) =>
  (await call('admin/senha-provisoria', { uid }, { signedIn: true })).senha;

// active = false inativa (a pessoa não entra mais e as sessões abertas caem)
export const adminSetAccess = (uid, active) => call('admin/acesso', { uid, ativo: active }, { signedIn: true });

// Apaga o login e libera o nome de usuário (o perfil no Firestore é apagado antes, pelo app)
export const adminDeleteAccount = (uid) => call('admin/excluir', { uid }, { signedIn: true });
