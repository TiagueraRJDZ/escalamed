// Testes das validações e máscaras. Rodar: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPhone, isValidPhone, formatCPF, isValidCPF, isStrongPassword } from '../public/js/validators.js';
import { PROFESSIONAL_CATEGORIES, professionLabel, councilLabel } from '../public/data/categories.js';

test('máscara de telefone', () => {
  assert.equal(formatPhone('8'), '(8');
  assert.equal(formatPhone('85999'), '(85) 999');
  assert.equal(formatPhone('8532221111'), '(85) 3222-1111');
  assert.equal(formatPhone('85999990000'), '(85) 99999-0000');
  assert.equal(formatPhone('859999900001234'), '(85) 99999-0000');
});

test('telefone válido', () => {
  assert.ok(isValidPhone('(85) 99999-0000'));
  assert.ok(isValidPhone('8532221111'));
  assert.ok(!isValidPhone('(85) 89999-0000')); // celular sem o 9
  assert.ok(!isValidPhone('(05) 99999-0000')); // DDD inválido
  assert.ok(!isValidPhone('859999'));
});

test('CPF', () => {
  assert.equal(formatCPF('52998224725'), '529.982.247-25');
  assert.ok(isValidCPF('529.982.247-25'));
  assert.ok(!isValidCPF('529.982.247-24'));
  assert.ok(!isValidCPF('111.111.111-11'));
});

test('senha forte', () => {
  assert.ok(isStrongPassword('Plantao@2026'));
  assert.ok(!isStrongPassword('plantao2026'));
  assert.ok(!isStrongPassword('Pl@1'));
});

test('categorias: ids únicos e em minúsculas', () => {
  const ids = PROFESSIONAL_CATEGORIES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z-]+$/);
});

test('rótulos de profissão e conselho', () => {
  assert.equal(professionLabel({ categoryId: 'medico', specialty: 'Clínico Geral' }), 'Médico / Clínico Geral');
  assert.equal(professionLabel({ categoryId: 'administrativo' }), 'Administrativo');
  assert.equal(councilLabel({ type: 'CRM', number: '28890', state: 'CE' }), 'CRM 28890/CE');
  assert.equal(councilLabel(null), '');
});
