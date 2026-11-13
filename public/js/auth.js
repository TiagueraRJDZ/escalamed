// Sessão do usuário: proteção das páginas (guards) e saída.
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  doc,
  getDoc,
  getDocFromCache,
  onSnapshot,
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

// ---------- Saída ----------
let signingOut = false;
// "Sair" clicado nesta ou em outra aba: as outras abas saem sem o aviso de acesso expirado
const LOGOUT_KEY = 'escalamed:saiu';

// Encerra a sessão neste aparelho: login, respostas guardadas e cache local do Firestore
async function endLocalSession() {
  clearSession();
  await signOut(auth).catch(() => {});
  // Com outra aba do app aberta não dá para apagar o cache agora; fica para a próxima saída.
  markLeaving(); // as listas em tempo real vão receber "shutting down": não é erro
  await terminate(db).catch(() => {});
  await clearIndexedDbPersistence(db).catch(() => {});
}

export async function signOutUser() {
  if (signingOut) return;
  signingOut = true;
  try {
    localStorage.setItem(LOGOUT_KEY, String(Date.now()));
  } catch {
    // sem armazenamento: as outras abas mostram o aviso de acesso expirado
  }
  // Este aparelho para de receber as notificações push desta conta (ainda com o login
  // valendo). No máximo 2 s: sem internet, sai assim mesmo.
  await Promise.race([
    import('./push.js').then((push) => push.forgetPushOnSignOut()).catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
  await endLocalSession();
  navigate('/', { replace: true });
}

// ---------- Acesso expirado (sessão encerrada pelo administrador) ----------
// Sai na hora, mostra o aviso por alguns segundos e leva para a tela de entrada, que repete o
// aviso (?sessao=encerrada). Sem o layout do app (ex.: tela de espera), vai direto.
const EXPIRED_URL = '/?sessao=encerrada';
const EXPIRED_SECONDS = 2; // curto: a sessão já caiu, o aviso só confirma (a tela de entrada repete)

function showExpiredDialog() {
  if (!document.querySelector('.app')) return false;
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  const dialog = document.createElement('dialog');
  dialog.className = 'modal modal-center session-expired';
  dialog.setAttribute('aria-labelledby', 'session-expired-title');
  dialog.setAttribute('aria-describedby', 'session-expired-text');
  dialog.innerHTML = `
    <div class="dialog-body">
      <span class="session-expired-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>
      <h2 id="session-expired-title">Seu acesso expirou</h2>
      <p class="muted" id="session-expired-text">A sua sessão foi encerrada pelo administrador da plataforma. Se precisar de acesso, fale com ele.</p>
      <p class="muted text-sm" aria-live="polite">Indo para a tela de entrada em <span data-seconds>${EXPIRED_SECONDS}</span> s…</p>
    </div>
    <div class="dialog-footer"><button type="button" class="btn btn-primary">Ir para a tela de entrada</button></div>`;
  document.body.append(dialog);
  const go = () => location.replace(EXPIRED_URL);
  dialog.addEventListener('cancel', (event) => event.preventDefault()); // Esc não fecha
  dialog.querySelector('button').addEventListener('click', go);
  dialog.showModal();
  dialog.querySelector('button').focus();
  let left = EXPIRED_SECONDS;
  const timer = setInterval(() => {
    left -= 1;
    dialog.querySelector('[data-seconds]').textContent = String(Math.max(left, 0));
    if (left <= 0) {
      clearInterval(timer);
      go();
    }
  }, 1000);
  return true;
}

async function expireSession() {
  if (signingOut) return;
  signingOut = true;
  const shown = showExpiredDialog();
  await endLocalSession();
  if (!shown) location.replace(EXPIRED_URL);
}

// Inativar, gerar senha provisória ou excluir o acesso derruba as sessões no Firebase, mas o
// app só perceberia ao abrir outra página. Aqui ele sai na hora:
//  1. sessions/{uid}.endedAt (gravado por Configurações > Usuários no clique) depois do login
//     desta sessão: chega em tempo real;
//  2. ao voltar para a aba, confere a conta no Firebase;
//  3. o Firebase desconectou sozinho (não conseguiu renovar o login).
// Sair pelo botão (nesta ou em outra aba) não conta como acesso expirado.
const ENDED_CODES = ['auth/user-disabled', 'auth/user-token-expired', 'auth/user-not-found', 'auth/invalid-user-token'];

function loggedOutOnPurpose() {
  try {
    return Date.now() - Number(localStorage.getItem(LOGOUT_KEY) || 0) < 15000;
  } catch {
    return false;
  }
}

export async function watchSession(user) {
  // Conferindo a conta: se ela caiu, o próprio Firebase desconecta antes de devolver o erro;
  // quem decide a saída é o catch abaixo
  let checking = false;
  onAuthStateChanged(auth, (current) => {
    if (current || signingOut || checking) return;
    if (loggedOutOnPurpose()) signOutUser();
    else expireSession();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || signingOut || checking) return;
    checking = true;
    user
      .reload()
      .catch((error) => {
        if (ENDED_CODES.includes(error?.code) || !auth.currentUser) expireSession();
      })
      .finally(() => (checking = false));
  });

  const authTime = Date.parse((await user.getIdTokenResult().catch(() => null))?.authTime ?? '') || 0;
  onSnapshot(
    doc(db, 'sessions', user.uid),
    (snapshot) => {
      const endedAt = snapshot.data()?.endedAt?.toMillis?.() ?? 0;
      if (endedAt > authTime) expireSession();
    },
    () => {}, // regras ainda não publicadas ou sem conexão: ficam os outros dois avisos
  );
}
