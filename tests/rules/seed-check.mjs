// Confere o seed: roda o script e testa, com as regras de verdade, o que cada cargo consegue.
// Uso: firebase emulators:exec --config firebase.test.json --project demo-escalamed-test "node --test tests/rules/seed-check.mjs"
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { canRead, canQueryGroup, clearFirestore, clearAuth } from './emulator.mjs';

const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9199'}`;

async function login(email) {
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=x`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Teste@123', returnSecureToken: true }),
  });
  return res.json();
}

before(async () => {
  await clearFirestore();
  await clearAuth();
  execFileSync(process.execPath, ['scripts/seed-emulator.mjs'], { stdio: 'inherit' });
});

test('usuários do seed entram e leem o grupo', async () => {
  const gestor = await login('gestor@teste.com');
  assert.ok(gestor.idToken);
  assert.ok(await canRead(gestor.idToken, 'groups/teleauditoria-hapvida'));
  assert.ok(await canRead(gestor.idToken, `users/${gestor.localId}`));
});

test('convidado vê o próprio convite, mas ainda não lê o grupo', async () => {
  const novo = await login('novo@teste.com');
  assert.ok(await canQueryGroup(novo.idToken, 'invites', 'email', 'novo@teste.com'));
  assert.ok(!(await canRead(novo.idToken, 'groups/teleauditoria-hapvida')));
});
