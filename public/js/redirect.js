// Para onde ir depois de entrar. Sem Firebase: as telas de entrada usam isto
// antes de o SDK terminar de baixar (ver pages/login.js).

export const HOME = '/schedules.html';

// Páginas do fluxo de entrada: elas repassam o "next" em vez de virar o destino
const AUTH_PAGES = ['/', '/index.html', '/signup.html', '/new-password.html'];

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
