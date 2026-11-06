// Página pública (sem login) com os Termos de Uso e o Aviso de Privacidade.
// /termos.html#termos ou #privacidade marca a aba e rola até o documento.
import { renderIcons } from '../icons.js';
import { mountCredits } from '../version.js';
import { LEGAL_DOCS, legalMeta } from '../legal.js';

renderIcons();
mountCredits();

document.getElementById('legal-content').innerHTML = Object.entries(LEGAL_DOCS)
  .map(
    ([id, doc]) => `<article class="legal-doc" id="${id}" aria-labelledby="${id}-title">
      <h2 id="${id}-title">${doc.title}</h2>
      ${legalMeta()}
      ${doc.html}
    </article>`,
  )
  .join('');

function markTab() {
  const id = location.hash.slice(1) || 'termos';
  document.querySelectorAll('.legal-tab').forEach((tab) => {
    tab.setAttribute('aria-current', String(tab.getAttribute('href') === `#${id}`));
  });
}
addEventListener('hashchange', markTab);
markTab();
// O conteúdo entrou depois do carregamento: rola até o documento pedido
if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();

// Aberta a partir do cadastro (nova aba ou mesma aba): "Voltar" volta para lá
if (document.referrer && new URL(document.referrer).origin === location.origin) {
  document.getElementById('legal-back').addEventListener('click', (event) => {
    if (history.length > 1) {
      event.preventDefault();
      history.back();
    }
  });
}
