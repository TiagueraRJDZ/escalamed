// Peças comuns das telas de entrada (acesso, cadastro): carrossel, mostrar senha e requisitos da senha.
import { icon } from './icons.js';
import { PASSWORD_RULES } from './validators.js';

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
