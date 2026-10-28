// Tela de acesso: escolher (entrar ou criar conta), login e recuperar senha.
// Login só por e-mail: entrar por "nome de usuário" exigiria uma lista pública
// nome -> e-mail, que exporia os e-mails. Ver resolveLoginIdentifier abaixo.
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { auth, navigate } from '../firebase.js';
import { currentUser, nextUrl, nextParam } from '../auth.js';
import { renderIcons } from '../icons.js';
import { setupCarousel, setupPasswordToggles } from '../auth-ui.js';
import { isValidEmail } from '../validators.js';
import {
  setLoading,
  setFieldError,
  clearFormErrors,
  clearErrorsWhileTyping,
  showFormAlert,
  firebaseErrorMessage,
} from '../ui.js';

// ---------- Já está logado? Vai direto para o app (os guards cuidam do resto) ----------
if (await currentUser()) navigate(nextUrl(), { replace: true });

// Hoje só aceita e-mail. Para aceitar nome de usuário no futuro (plano Blaze),
// esta função chamaria uma Cloud Function que devolve o e-mail sem expô-lo.
async function resolveLoginIdentifier(identifier) {
  return identifier.trim();
}

// ---------- Troca de tela pelo endereço (#entrar, #recuperar) ----------
// Sem endereço (ou desconhecido), mostra a escolha entre entrar e criar conta.
// "#cadastro" (links antigos) vai para a página de cadastro.
const VIEWS = { '#entrar': 'view-login', '#recuperar': 'view-forgot' };

function showView({ focus = true } = {}) {
  if (location.hash === '#cadastro') {
    navigate(`/signup.html${nextParam()}`, { replace: true });
    return;
  }
  const target = VIEWS[location.hash] ?? 'view-choose';
  document.querySelectorAll('.auth-view').forEach((view) => {
    view.hidden = view.id !== target;
  });
  if (focus) {
    const heading = document.querySelector(`#${target} h1`);
    heading.tabIndex = -1;
    heading.focus();
  }
}

// ---------- Login ----------
function setupLogin() {
  const form = document.getElementById('login-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormErrors(form);
    const email = await resolveLoginIdentifier(form.email.value);
    const password = form.password.value;

    let valid = true;
    if (!isValidEmail(email)) {
      setFieldError(form.email, 'Informe um e-mail válido.');
      valid = false;
    }
    if (!password) {
      setFieldError(form.password, 'Informe sua senha.');
      valid = false;
    }
    if (!valid) return;

    const button = form.querySelector('[type=submit]');
    setLoading(button, true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      navigate(nextUrl(), { replace: true });
    } catch (error) {
      showFormAlert(form, firebaseErrorMessage(error));
      setLoading(button, false);
    }
  });
}

// ---------- Recuperar senha ----------
// A mensagem é sempre a mesma, exista ou não a conta (não revela quem tem cadastro).
function setupForgot() {
  const form = document.getElementById('forgot-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormErrors(form);
    const email = form.email.value.trim();
    if (!isValidEmail(email)) {
      setFieldError(form.email, 'Informe um e-mail válido.');
      return;
    }

    const button = form.querySelector('[type=submit]');
    setLoading(button, true);
    try {
      await sendPasswordResetEmail(auth, email);
    } catch (error) {
      const hidden = ['auth/user-not-found', 'auth/invalid-email'];
      if (!hidden.includes(error.code)) {
        showFormAlert(form, firebaseErrorMessage(error));
        setLoading(button, false);
        return;
      }
    }
    showFormAlert(form, 'Se existir uma conta com este e-mail, enviaremos um link para redefinir a senha.', 'success');
    setLoading(button, false);
  });
}

// ---------- Início ----------
renderIcons();
setupCarousel();
setupPasswordToggles();
setupLogin();
setupForgot();
document.getElementById('signup-link').href = `/signup.html${nextParam()}`;

['login-form', 'forgot-form'].forEach((id) => clearErrorsWhileTyping(document.getElementById(id)));

window.addEventListener('hashchange', () => showView());
showView({ focus: false });
