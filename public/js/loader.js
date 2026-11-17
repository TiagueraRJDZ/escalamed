// Carregando do login: o ícone do EscalaMed com a mesma animação do topo do login (os blocos
// trocando de lugar), em loop, num painel azul no meio de um véu que cobre a tela.
// Estilo em base.css (.app-loader e .cube-loader).
// Uso: showLoader() ao enviar o login; hideLoader() se der erro (com sucesso, a página
// muda e o carregando sai junto).

let overlay = null;

// O mesmo SVG do ícone (brand-icon), recortado só na grade: viewBox de 7 a 33
function create() {
  overlay = document.createElement('div');
  overlay.className = 'app-loader';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="cube-loader" role="status" aria-live="polite">
      <svg class="cube-loader-icon" viewBox="7 7 26 26" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="7" y="7" width="12" height="12" rx="3.5" fill="#FFFFFF"/>
        <rect x="21" y="7" width="12" height="12" rx="3.5" fill="#FFFFFF" fill-opacity=".35"/>
        <rect x="7" y="21" width="12" height="12" rx="3.5" fill="#FFFFFF" fill-opacity=".35"/>
        <rect x="21" y="21" width="12" height="12" rx="3.5" fill="#2FD3B5"/>
        <path d="M27 24.5v5M24.5 27h5" stroke="#0B4F45" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <span class="sr-only" data-loader-text></span>
    </div>`;
  document.body.append(overlay);
}

export function showLoader(text = 'Entrando…') {
  if (!overlay) create();
  overlay.querySelector('[data-loader-text]').textContent = text;
  overlay.hidden = false;
  document.body.setAttribute('aria-busy', 'true');
}

export function hideLoader() {
  if (!overlay) return;
  overlay.hidden = true;
  document.body.removeAttribute('aria-busy');
}

// Voltou para o login pelo botão Voltar (página restaurada do cache): sem carregando na tela
window.addEventListener('pageshow', (event) => {
  if (event.persisted) hideLoader();
});
