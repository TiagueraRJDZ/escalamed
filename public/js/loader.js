// Carregando do login: o ícone do EscalaMed (grade 2x2) animado no estilo "Cube Grid",
// num painel azul no meio de um véu que cobre a tela. Estilo em base.css (.app-loader e .cube-loader).
// Uso: showLoader() ao enviar o login; hideLoader() se der erro (com sucesso, a página
// muda e o carregando sai junto).

let overlay = null;

// Ordem dos quadrados igual à do logo: branco, branco 35%, branco 35%, verde com "+"
function create() {
  overlay = document.createElement('div');
  overlay.className = 'app-loader';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="cube-loader" role="status" aria-live="polite">
      <div class="cube-loader-grid" aria-hidden="true">
        <span class="cube-loader-cube"></span>
        <span class="cube-loader-cube"></span>
        <span class="cube-loader-cube"></span>
        <span class="cube-loader-cube">
          <svg viewBox="0 0 12 12"><path d="M6 3.5v5M3.5 6h5" /></svg>
        </span>
      </div>
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
