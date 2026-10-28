// Peças comuns das telas de entrada (acesso, cadastro): carrossel, mostrar senha,
// requisitos da senha e botão "Continuar com Google".
import { icon } from './icons.js';
import { PASSWORD_RULES } from './validators.js';
import { navigate } from './firebase.js';
import { loadProfile, isProfileComplete, nextUrl, nextParam } from './auth.js';
import { signInWithGoogle } from './auth-api.js';
import { setLoading, toast, firebaseErrorMessage } from './ui.js';

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

export function setupCarousel() {
  const track = document.getElementById('carousel-track');
  const dots = document.getElementById('carousel-dots');
  const carousel = document.getElementById('carousel');
  if (!carousel) return;
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

// Botão de olho em cada campo de senha (.password-wrap)
export function setupPasswordToggles(root = document) {
  root.querySelectorAll('.password-wrap').forEach((wrap) => {
    if (wrap.querySelector('.btn-icon')) return;
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

// Lista de requisitos + barra de força, atualizadas enquanto digita
export function setupPasswordRules(input, list, meter) {
  const LEVELS = ['Muito fraca', 'Fraca', 'Média', 'Boa', 'Forte'];
  const render = () => {
    const value = input.value;
    const passed = PASSWORD_RULES.filter((rule) => rule.test(value)).length;
    list.innerHTML = PASSWORD_RULES.map((rule) => {
      const ok = rule.test(value);
      return `<li class="${ok ? 'is-ok' : ''}">${icon(ok ? 'checkCircle' : 'clock')}<span>${rule.label}</span></li>`;
    }).join('');
    if (meter) {
      // Bônus de força para senhas longas
      const score = value ? Math.min(4, passed + (value.length >= 12 ? 1 : 0) - 1) : 0;
      meter.dataset.level = value ? String(score) : '';
      meter.querySelector('span').textContent = value ? `Força: ${LEVELS[Math.max(0, score)]}` : '';
    }
  };
  input.addEventListener('input', render);
  render();
}

// ---------- Continuar com Google ----------
const GOOGLE_LOGO = `
  <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
  </svg>`;

// Botões com data-google-login: entra pelo Google e segue para o app ou, no
// primeiro acesso, para o cadastro (que continua a partir dos dados pessoais).
export function setupGoogleButtons() {
  document.querySelectorAll('[data-google-login]').forEach((button) => {
    button.insertAdjacentHTML('afterbegin', GOOGLE_LOGO);
    button.addEventListener('click', async () => {
      setLoading(button, true);
      try {
        const { user } = await signInWithGoogle();
        const profile = await loadProfile(user.uid).catch(() => null);
        navigate(isProfileComplete(profile) ? nextUrl() : `/signup.html${nextParam()}`, { replace: true });
      } catch (error) {
        const message = firebaseErrorMessage(error); // null quando a pessoa fechou a janela
        if (message) toast(message, 'error', 6000);
        setLoading(button, false);
      }
    });
  });
}
