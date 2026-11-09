// Para onde ir depois de entrar. Sem Firebase: as telas de entrada usam isto
// antes de o SDK terminar de baixar (ver pages/login.js).

export const HOME = '/schedules.html';

// Caminho da página sem ".html": em produção o Firebase tira a extensão do endereço
// (cleanUrls), no Go Live ela continua. "/schedules.html" e "/schedules" são a mesma página.
export const pagePath = (path) => path.replace(/\.html$/, '').replace(/^\/index$/, '/');

// Páginas do fluxo de entrada: elas repassam o "next" em vez de virar o destino
const AUTH_PAGES = ['/', '/signup', '/new-password'];

// Para onde ir depois de entrar (só caminhos internos, para evitar redirecionamento malicioso)
export function nextUrl() {
  const next = new URLSearchParams(location.search).get('next');
  return next && next.startsWith('/') && !next.startsWith('//') ? next : HOME;
}

// "?next=..." para levar adiante: a página atual, ou o next que ela já recebeu
export function nextParam() {
  const target = AUTH_PAGES.includes(pagePath(location.pathname)) ? nextUrl() : location.pathname + location.search;
  return pagePath(target) === pagePath(HOME) ? '' : `?next=${encodeURIComponent(target)}`;
}
