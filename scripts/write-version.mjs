// Gera public/version.json com a versão do último commit ("1.0.15 - resumo" → "1.0.15").
// Roda sozinho: depois de cada commit, checkout e pull (hooks em .githooks/) e antes de
// publicar no Firebase (predeploy em firebase.json). O arquivo não vai para o repositório.
// Uso manual: node scripts/write-version.mjs
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

// Primeiro commit (do mais novo para o mais antigo) cuja mensagem começa com a versão
const subjects = git('log', '-n', '200', '--format=%s').split('\n');
const version = subjects.map((s) => s.match(/^(\d+(?:\.\d+){1,3})\s*-/)?.[1]).find(Boolean) ?? '';

const info = {
  version,
  commit: git('rev-parse', '--short', 'HEAD'),
  date: git('log', '-1', '--format=%cI'),
};

writeFileSync(new URL('../public/version.json', import.meta.url), `${JSON.stringify(info, null, 2)}\n`);
console.log(`version.json: v${info.version || '?'} (${info.commit})`);
