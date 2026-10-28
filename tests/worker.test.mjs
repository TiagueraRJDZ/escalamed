// Testes das validações do serviço de contas (worker/src/senhas.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gerarSenhaProvisoria, emailValido, motivoUsuarioInvalido } from '../worker/src/senhas.js';
import { isStrongPassword } from '../public/js/validators.js';

test('senha provisória: sem caracteres que se confundem e aceita pelas regras do app', () => {
  for (let i = 0; i < 50; i++) {
    const senha = gerarSenhaProvisoria();
    assert.match(senha, /^[A-HJ-NP-Za-km-z]{6}[2-9]{2}@$/);
    assert.ok(isStrongPassword(senha), senha);
  }
});

test('e-mail e nome de usuário', () => {
  assert.ok(emailValido('ana@hapvida.com.br'));
  assert.ok(!emailValido('ana@hapvida'));
  assert.equal(motivoUsuarioInvalido('tiago.martins'), '');
  assert.equal(motivoUsuarioInvalido('dr_ana2'), '');
  assert.ok(motivoUsuarioInvalido('ab'));
  assert.ok(motivoUsuarioInvalido('Tiago'));
  assert.ok(motivoUsuarioInvalido('ana@x'));
  assert.ok(motivoUsuarioInvalido('123456'));
  assert.ok(motivoUsuarioInvalido('.ana'));
  assert.ok(motivoUsuarioInvalido('ana..b'));
});
