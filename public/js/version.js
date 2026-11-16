// Crédito e versão no rodapé: "Desenvolvido por Tiago Martins · v1.0.15".
// A versão vem de /version.json, gerado a cada commit (scripts/write-version.mjs).
// Preenche todo elemento com o atributo data-credits.

export const AUTHOR = 'Tiago Martins';

let cached = null;

export function loadVersion() {
  cached ??= fetch('/version.json', { cache: 'no-store' })
    .then((response) => (response.ok ? response.json() : {}))
    .catch(() => ({}));
  return cached;
}

// Versão nova publicada: o app instalado no celular (tela inicial) não recarrega ao voltar para
// ele, continua com o código antigo. Ao voltar para o app (ou para a aba), confere /version.json
// e, se mudou, recarrega. Não recarrega com uma janela aberta ou alguém digitando: espera a
// próxima volta. No máximo uma conferência por minuto.
const CHECK_EVERY = 60_000;

const busy = () =>
  Boolean(document.querySelector('dialog[open]')) || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);

export async function watchForUpdates() {
  const { version: current } = await loadVersion();
  if (!current) return;
  let lastCheck = Date.now();
  const check = async () => {
    if (document.visibilityState !== 'visible' || Date.now() - lastCheck < CHECK_EVERY) return;
    lastCheck = Date.now();
    const { version } = await fetch('/version.json', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : {}))
      .catch(() => ({}));
    if (version && version !== current && !busy()) location.reload();
  };
  document.addEventListener('visibilitychange', check);
  window.addEventListener('pageshow', (event) => event.persisted && check()); // voltou pelo "voltar"
}

export async function mountCredits(root = document) {
  const targets = root.querySelectorAll('[data-credits]');
  if (!targets.length) return;
  const { version, commit, date } = await loadVersion();
  const text = `Desenvolvido por ${AUTHOR}${version ? ` · v${version}` : ''}`;
  const title = commit ? `Versão ${version} (${commit}${date ? `, ${new Date(date).toLocaleDateString('pt-BR')}` : ''})` : '';
  targets.forEach((el) => {
    el.textContent = text;
    if (title) el.title = title;
  });
}
