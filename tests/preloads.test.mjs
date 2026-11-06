// Os <link rel="modulepreload"> das páginas estão em dia com os imports? Rodar: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('modulepreload das páginas em dia (node scripts/write-preloads.mjs)', () => {
  const script = fileURLToPath(new URL('../scripts/write-preloads.mjs', import.meta.url));
  assert.doesNotThrow(() => execFileSync(process.execPath, [script, '--check'], { stdio: 'pipe' }));
});
