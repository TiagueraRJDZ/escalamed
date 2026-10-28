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
