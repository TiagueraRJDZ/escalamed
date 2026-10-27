// Tela de entrada: entrar, criar conta, Google e recuperar senha.
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  sendEmailVerification,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { auth } from '../firebase.js';
import { currentUser, ensureUserProfile, nextUrl } from '../auth.js';
import { icon, GOOGLE_LOGO } from '../icons.js';
import { isValidEmail, isValidName, isStrongPassword, PASSWORD_RULES } from '../validators.js';
import {
  setLoading,
  setFieldError,
  clearFormErrors,
  showFormAlert,
  firebaseErrorMessage,
  toast,
} from '../ui.js';

// ---------- Já está logado? Vai direto para o app ----------
const existingUser = await currentUser();
if (existingUser) {
  await ensureUserProfile(existingUser);
  location.replace(nextUrl());
}

async function finishLogin(user, fallbackName) {
  await ensureUserProfile(user, fallbackName);
  location.replace(nextUrl());
}

// ---------- Carrossel de benefícios ----------
const SLIDES = [
  {
    icon: 'calendar',
    title: 'Escalas prontas em minutos',
    text: 'Monte os turnos, distribua os plantões e acompanhe tudo em um único calendário.',
  },
  {
    icon: 'arrowRightLeft',
    title: 'Trocas sem confusão',
    text: 'Ceda, troque ou assuma plantões com registro e histórico, sem depender de grupo de mensagens.',
  },
  {
    icon: 'mapPin',
    title: 'Check-in com localização',
    text: 'Saiba quem chegou, quem atrasou e quem está de plantão agora.',
  },
  {
    icon: 'chart',
    title: 'Relatórios para fechar o mês',
    text: 'Horas, valores, atrasos e faltas por plantonista, sem planilha.',
  },
];

function setupCarousel() {
  const track = document.getElementById('carousel-track');
  const dots = document.getElementById('carousel-dots');
  const carousel = document.getElementById('carousel');
  let current = 0;
  let timer = null;

  track.innerHTML = SLIDES.map(
    (s, i) => `
      <div class="slide${i === 0 ? ' is-active' : ''}" aria-hidden="${i !== 0}">
        <div class="slide-icon">${icon(s.icon)}</div>
        <h2>${s.title}</h2>
        <p>${s.text}</p>
      </div>`,
  ).join('');

  dots.innerHTML = SLIDES.map(
    (s, i) =>
      `<button type="button" class="carousel-dot" aria-label="${s.title}" aria-current="${i === 0}"></button>`,
  ).join('');

  const slideEls = [...track.children];
  const dotEls = [...dots.children];

  function show(index) {
    current = (index + SLIDES.length) % SLIDES.length;
    slideEls.forEach((el, i) => {
      el.classList.toggle('is-active', i === current);
      el.setAttribute('aria-hidden', String(i !== current));
    });
    dotEls.forEach((el, i) => el.setAttribute('aria-current', String(i === current)));
  }

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const start = () => {
    if (!reducedMotion) timer = setInterval(() => show(current + 1), 6000);
  };
  const stop = () => clearInterval(timer);

  dotEls.forEach((dot, i) =>
    dot.addEventListener('click', () => {
      stop();
      show(i);
      start();
    }),
  );
  carousel.addEventListener('mouseenter', stop);
  carousel.addEventListener('mouseleave', start);
  carousel.addEventListener('focusin', stop);
  carousel.addEventListener('focusout', start);
  start();
}

// ---------- Troca de tela pelo endereço (#entrar, #cadastro, #recuperar) ----------
const VIEWS = { '': 'view-start', '#entrar': 'view-login', '#cadastro': 'view-signup', '#recuperar': 'view-forgot' };

function showView({ focus = true } = {}) {
  const target = VIEWS[location.hash] ?? 'view-start';
  document.querySelectorAll('.auth-view').forEach((view) => {
    view.hidden = view.id !== target;
  });
  if (focus) {
    const heading = document.querySelector(`#${target} h1`);
    heading.tabIndex = -1;
    heading.focus();
  }
}

// ---------- Botões de mostrar/ocultar senha ----------
function setupPasswordToggles() {
  document.querySelectorAll('.password-wrap').forEach((wrap) => {
    const input = wrap.querySelector('input');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn-icon';
    button.setAttribute('aria-label', 'Mostrar senha');
    button.innerHTML = icon('eye');
    button.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
      button.innerHTML = icon(show ? 'eyeOff' : 'eye');
    });
    wrap.append(button);
  });
}

// ---------- Requisitos da senha (atualiza enquanto digita) ----------
function setupPasswordRules() {
  const list = document.getElementById('password-rules');
  const input = document.getElementById('signup-password');
  const render = () => {
    list.innerHTML = PASSWORD_RULES.map((rule) => {
      const ok = rule.test(input.value);
      return `<li class="${ok ? 'is-ok' : ''}">${icon(ok ? 'checkCircle' : 'clock')}<span>${rule.label}</span></li>`;
    }).join('');
  };
  input.addEventListener('input', render);
  render();
}

// ---------- Google ----------
async function signInWithGoogle(button) {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  setLoading(button, true);
  try {
    const { user } = await signInWithPopup(auth, provider);
    await finishLogin(user);
  } catch (error) {
    if (error.code === 'auth/popup-blocked') {
      // Navegador bloqueou a janela: entra pela própria página
      await signInWithRedirect(auth, provider);
      return;
    }
    const message = firebaseErrorMessage(error);
    if (message) toast(message, 'error');
    setLoading(button, false);
  }
}

// ---------- Formulários ----------
function setupLogin() {
  const form = document.getElementById('login-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormErrors(form);
    const email = form.email.value.trim();
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
      const { user } = await signInWithEmailAndPassword(auth, email, password);
      await finishLogin(user);
    } catch (error) {
      showFormAlert(form, firebaseErrorMessage(error));
      setLoading(button, false);
    }
  });
}

function setupSignup() {
  const form = document.getElementById('signup-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormErrors(form);
    const name = form.name.value.trim().replace(/\s+/g, ' ');
    const email = form.email.value.trim();
    const password = form.password.value;

    const errors = [];
    if (!isValidName(name)) errors.push([form.name, 'Informe seu nome completo.']);
    if (!isValidEmail(email)) errors.push([form.email, 'Informe um e-mail válido.']);
    if (!isStrongPassword(password)) errors.push([form.password, 'A senha não atende aos requisitos acima.']);
    if (form.confirm.value !== password) errors.push([form.confirm, 'As senhas não conferem.']);
    if (!form.terms.checked) errors.push([form.terms, 'Para continuar, aceite os termos.']);
    if (errors.length) {
      errors.forEach(([input, message]) => setFieldError(input, message));
      errors[0][0].focus();
      return;
    }

    const button = form.querySelector('[type=submit]');
    setLoading(button, true);
    try {
      const { user } = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(user, { displayName: name });
      sendEmailVerification(user).catch(() => {}); // falha aqui não impede o cadastro
      await finishLogin(user, name);
    } catch (error) {
      showFormAlert(form, firebaseErrorMessage(error));
      setLoading(button, false);
    }
  });
}

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
      // "Usuário não encontrado" não é mostrado, para não revelar quem tem conta
      if (error.code !== 'auth/user-not-found') {
        showFormAlert(form, firebaseErrorMessage(error));
        setLoading(button, false);
        return;
      }
    }
    showFormAlert(form, 'Se houver uma conta com este e-mail, você receberá o link em instantes.', 'success');
    setLoading(button, false);
  });
}

// ---------- Início ----------
setupCarousel();
setupPasswordToggles();
setupPasswordRules();
setupLogin();
setupSignup();
setupForgot();

document.querySelectorAll('[data-google]').forEach((button) => {
  button.insertAdjacentHTML('afterbegin', GOOGLE_LOGO);
  button.addEventListener('click', () => signInWithGoogle(button));
});

document.querySelectorAll('[data-back]').forEach((link) =>
  link.addEventListener('click', (event) => {
    event.preventDefault();
    history.pushState(null, '', location.pathname + location.search);
    showView();
  }),
);

document.querySelectorAll('.auth-back').forEach((link) => link.insertAdjacentHTML('afterbegin', icon('arrowLeft')));

window.addEventListener('hashchange', () => showView());
showView({ focus: false });
