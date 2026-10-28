// Tela de acesso: escolher (entrar ou criar conta), login e "esqueci a senha".
// Login por e-mail no Firebase; por nome de usuário, pelo serviço de contas (ver auth-api.js).
import { navigate } from '../firebase.js';
import { currentUser, nextUrl, nextParam } from '../auth.js';
import { signIn } from '../auth-api.js';
import { renderIcons } from '../icons.js';
import { setupCarousel, setupPasswordToggles } from '../auth-ui.js';
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

// ---------- Login (nome de usuário ou e-mail) ----------
function setupLogin() {
  const form = document.getElementById('login-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormErrors(form);
    const identifier = form.identifier.value.trim();
    const password = form.password.value;

    let valid = true;
    if (!identifier) {
      setFieldError(form.identifier, 'Informe seu nome de usuário ou e-mail.');
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
      const { mustChangePassword } = await signIn(identifier, password);
      navigate(mustChangePassword ? `/new-password.html${nextParam()}` : nextUrl(), { replace: true });
    } catch (error) {
      showFormAlert(form, firebaseErrorMessage(error));
      setLoading(button, false);
    }
  });
}

// ---------- Início ----------
renderIcons();
setupCarousel();
setupPasswordToggles();
setupLogin();
document.getElementById('signup-link').href = `/signup.html${nextParam()}`;

clearErrorsWhileTyping(document.getElementById('login-form'));

window.addEventListener('hashchange', () => showView());
showView({ focus: false });
