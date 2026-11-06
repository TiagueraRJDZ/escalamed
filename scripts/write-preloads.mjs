// Escreve em cada página (public/*.html) um <link rel="modulepreload"> para cada módulo
// que ela importa, direta ou indiretamente. Sem isso o navegador descobre os imports em
// cascata (um nível por ida e volta à rede); com isso baixa todos em paralelo.
// Roda sozinho antes de publicar (predeploy em firebase.json).
//   node scripts/write-preloads.mjs          atualiza os HTML
//   node scripts/write-preloads.mjs --check  só confere (sai com erro se algum estiver desatualizado)
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = fileURLToPath(new URL('../public', import.meta.url));
const START = '<!-- modulepreload: módulos do app em paralelo (gerado por scripts/write-preloads.mjs) -->';
const END = '<!-- /modulepreload -->';

// import x from '...', import '...', export { x } from '...' (os import() dinâmicos ficam de fora)
const IMPORT = /(?:^|[\n;])\s*(?:import|export)\s+(?:[\w*{}\s,$]+\s+from\s*)?['"]([^'"]+)['"]/g;

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
    const source = readFileSync(file, 'utf8');
    for (const [, spec] of source.matchAll(IMPORT)) {
      const path = resolveSpec(spec, file);
      if (!path || seen.has(path)) continue;
      seen.add(path);
      order.push(path);
      queue.push(path);
    }
  }
  return order;
}

const url = (path) => `/${relative(PUBLIC, path).split('\\').join('/')}`;

const check = process.argv.includes('--check');
const outdated = [];

for (const name of readdirSync(PUBLIC).filter((f) => f.endsWith('.html'))) {
  const file = join(PUBLIC, name);
  const html = readFileSync(file, 'utf8');
  const entry = html.match(/<script type="module" src="([^"]+)"/)?.[1];
  if (!entry) continue;
  const modules = moduleGraph(join(PUBLIC, entry));
  const block = [START, ...modules.map((m) => `  <link rel="modulepreload" href="${url(m)}" />`), `  ${END}`].join('\n');

  let next;
  if (html.includes(START)) {
    next = html.replace(new RegExp(`${START}[\\s\\S]*?${END}`), block);
  } else {
    // Primeira vez: logo depois dos preloads do SDK do Firebase (ou antes do </head>)
    const anchor = html.match(/.*firebase-firestore\.js" \/>\n/);
    next = anchor
      ? html.replace(anchor[0], `${anchor[0]}  ${block}\n`)
      : html.replace('</head>', `  ${block}\n</head>`);
  }
  if (next === html) continue;
  outdated.push(name);
  if (!check) writeFileSync(file, next);
}

if (check && outdated.length) {
  console.error(`modulepreload desatualizado em: ${outdated.join(', ')}. Rode: node scripts/write-preloads.mjs`);
  process.exit(1);
}
console.log(outdated.length ? `modulepreload atualizado: ${outdated.join(', ')}` : 'modulepreload em dia');
