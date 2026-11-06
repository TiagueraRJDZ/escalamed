// Pré-carregamento de páginas (speculation rules no <head> das páginas do app):
// o navegador pode abrir a próxima página escondida antes do clique. Enquanto ela
// está escondida (document.prerendering), nada com efeito colateral pode rodar:
// gravações, avisos (toast), redirecionamentos, marcar coisas como lidas.

// Resolve na hora numa página normal; numa pré-carregada, quando a pessoa abrir
export function whenActivated() {
  if (!document.prerendering) return Promise.resolve();
  return new Promise((resolve) => document.addEventListener('prerenderingchange', () => resolve(), { once: true }));
}
