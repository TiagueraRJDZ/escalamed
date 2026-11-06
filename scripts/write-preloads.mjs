// Versões dos arquivos do app no HTML, sem build (os nomes dos arquivos não mudam):
//  1. import map: cada módulo (.js) aponta para "arquivo.js?v=<hash do conteúdo>";
//  2. modulepreload de todos os módulos que a página importa, já com ?v= (baixam em paralelo);
//  3. o <script type="module"> de entrada, os <link rel="stylesheet"> e o favicon/ícones com ?v=.
// O HTML é sempre buscado de novo (no-cache); quando um .js ou .css muda, a URL dele muda
// junto. Por isso .js e .css podem ter cache "immutable" de 1 ano (firebase.json).
// Roda sozinho antes de publicar (predeploy em firebase.json).
//   node scripts/write-preloads.mjs          atualiza os HTML
//   node scripts/write-preloads.mjs --check  só confere (sai com erro se algum estiver desatualizado)
// Mexeu em algum .js ou .css? Rode este script (o teste tests/preloads.test.mjs avisa).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = fileURLToPath(new URL('../public', import.meta.url));
const MAP_START = '<!-- importmap: versões dos módulos (gerado por scripts/write-preloads.mjs) -->';
const MAP_END = '<!-- /importmap -->';
const START = '<!-- modulepreload: módulos do app em paralelo (gerado por scripts/write-preloads.mjs) -->';
const END = '<!-- /modulepreload -->';

// import x from '...', import '...', export { x } from '...' (os import() dinâmicos ficam de fora)
const IMPORT = /(?:^|[\n;])\s*(?:import|export)\s+(?:[\w*{}\s,$]+\s+from\s*)?['"]([^'"]+)['"]/g;

const url = (path) => `/${relative(PUBLIC, path).split('\\').join('/')}`;

function filesIn(dir, ext) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return filesIn(path, ext);
    return name.endsWith(ext) ? [path] : [];
  });
}

// "/js/layout.js" → "/js/layout.js?v=1a2b3c4d5e" (hash do conteúdo)
const versions = new Map(
  [...filesIn(join(PUBLIC, 'js'), '.js'), ...filesIn(join(PUBLIC, 'data'), '.js'), ...filesIn(join(PUBLIC, 'css'), '.css')].map(
    (path) => [url(path), `${url(path)}?v=${createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 10)}`],
  ),
);
const versioned = (href) => versions.get(href) ?? href;
const hashOf = (path) => createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 10);

function resolveSpec(spec, fromFile) {
  if (/^https?:/.test(spec)) return null; // CDN (o SDK do Firebase já tem preload próprio)
  const path = spec.startsWith('/') ? join(PUBLIC, spec) : resolve(dirname(fromFile), spec);
  return existsSync(path) ? path : null;
}

// Módulos alcançados a partir da entrada, em largura (os mais próximos primeiro)
function moduleGraph(entry) {
  const seen = new Set([entry]);
  const order = [];
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift();
    for (const [, spec] of readFileSync(file, 'utf8').matchAll(IMPORT)) {
      const path = resolveSpec(spec, file);
      if (!path || seen.has(path)) continue;
      seen.add(path);
      order.push(path);
      queue.push(path);
    }
  }
  return order;
}

// Troca o bloco entre os marcadores (procura como texto: os marcadores têm parênteses)
function replaceBlock(html, start, end, block) {
  const from = html.indexOf(start);
  if (from < 0) return null;
  const to = html.indexOf(end, from) + end.length;
  return html.slice(0, from) + block + html.slice(to);
}

// Todos os módulos do app no import map (inclusive os de import() dinâmico)
const importMap = Object.fromEntries([...versions].filter(([key]) => key.endsWith('.js')));
const mapBlock = [
  MAP_START,
  `  <script type="importmap">${JSON.stringify({ imports: importMap }, null, 1).replace(/\n\s*/g, ' ')}</script>`,
  `  ${MAP_END}`,
].join('\n');

const check = process.argv.includes('--check');
const outdated = [];

for (const name of readdirSync(PUBLIC).filter((f) => f.endsWith('.html'))) {
  const file = join(PUBLIC, name);
  const html = readFileSync(file, 'utf8');
  const entry = html.match(/<script type="module" src="([^"?]+)(?:\?v=[^"]*)?"/)?.[1];
  let next = html;

  // Folhas de estilo com ?v=
  next = next.replace(/href="(\/css\/[^"?]+\.css)(?:\?v=[^"]*)?"/g, (_, href) => `href="${versioned(href)}"`);

  // Favicon e ícones de atalho com ?v= (o navegador guarda o favicon por muito tempo:
  // com a versão no endereço, um ícone novo aparece logo)
  next = next.replace(/<link rel="(?:icon|apple-touch-icon)"[^>]*>/g, (tag) =>
    tag.replace(/href="(\/img\/[^"?]+)(?:\?v=[^"]*)?"/, (_, href) => `href="${href}?v=${hashOf(join(PUBLIC, href))}"`),
  );

  if (entry) {
    // 1. Import map: antes de qualquer carregamento de módulo (inclusive os modulepreload)
    next =
      replaceBlock(next, MAP_START, MAP_END, mapBlock) ??
      next.replace(/(\s*)(<link rel="modulepreload"|<link)/, `$1${mapBlock}$1$2`);

    // 2. modulepreload de todos os módulos da página
    const modules = moduleGraph(join(PUBLIC, entry));
    const block = [START, ...modules.map((m) => `  <link rel="modulepreload" href="${versioned(url(m))}" />`), `  ${END}`].join('\n');
    next =
      replaceBlock(next, START, END, block) ??
      (() => {
        const anchor = next.match(/.*firebase-firestore\.js" \/>\n/);
        return anchor ? next.replace(anchor[0], `${anchor[0]}  ${block}\n`) : next.replace('</head>', `  ${block}\n</head>`);
      })();

    // 3. Entrada da página com ?v=
    next = next.replace(/(<script type="module" src=")[^"]+(")/, `$1${versioned(entry)}$2`);
  }

  if (next === html) continue;
  outdated.push(name);
  if (!check) writeFileSync(file, next);
}

if (check && outdated.length) {
  console.error(`Versões desatualizadas em: ${outdated.join(', ')}. Rode: node scripts/write-preloads.mjs`);
  process.exit(1);
}
console.log(outdated.length ? `versões atualizadas: ${outdated.join(', ')}` : 'versões em dia');
