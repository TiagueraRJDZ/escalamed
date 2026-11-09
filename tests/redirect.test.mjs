// Testes do caminho da página (public/js/redirect.js): com e sem ".html" é a mesma página.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pagePath, HOME } from '../public/js/redirect.js';

test('caminho da página: tira o ".html" e trata /index como a raiz', () => {
  assert.equal(pagePath('/schedules.html'), '/schedules');
  assert.equal(pagePath('/schedules'), '/schedules');
  assert.equal(pagePath('/index.html'), '/');
  assert.equal(pagePath('/'), '/');
  assert.equal(pagePath('/group.html?id=1'), '/group.html?id=1');
  assert.equal(pagePath(HOME), '/schedules');
});
