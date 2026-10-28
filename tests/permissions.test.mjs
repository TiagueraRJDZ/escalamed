// Testes dos cargos e permissões. Rodar: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  can,
  roleOf,
  roleUsage,
  hasRoom,
  assignableRoles,
  changeRolePatch,
  removeMemberPatch,
  ACTIONS,
} from '../public/js/permissions.js';

const group = {
  memberIds: ['g', 'a1', 'a2', 'an', 'ob', 'p1', 'p2'],
  managerIds: ['g'],
  assistantIds: ['a1', 'a2'],
  analystIds: ['an'],
  observerIds: ['ob'],
};

test('roleOf identifica o cargo pelos arrays do grupo', () => {
  assert.equal(roleOf(group, 'g'), 'manager');
  assert.equal(roleOf(group, 'a2'), 'assistant');
  assert.equal(roleOf(group, 'an'), 'analyst');
  assert.equal(roleOf(group, 'ob'), 'observer');
  assert.equal(roleOf(group, 'p1'), 'staff');
  assert.equal(roleOf(group, 'estranho'), null);
});

test('roleUsage conta os lugares ocupados', () => {
  assert.deepEqual(roleUsage(group), { manager: 1, assistant: 2, analyst: 1, observer: 1, staff: 2 });
  assert.equal(hasRoom(group, 'manager'), false);
  assert.equal(hasRoom(group, 'assistant'), true);
  assert.equal(hasRoom({ ...group, assistantIds: ['a1', 'a2', 'a3'] }, 'assistant'), false);
  assert.equal(hasRoom(group, 'staff'), true);
});

test('matriz de permissões', () => {
  assert.ok(can('manager', 'editSettings'));
  assert.ok(!can('assistant', 'editSettings'));
  assert.ok(can('assistant', 'editSchedule'));
  assert.ok(!can('analyst', 'editSchedule'));
  assert.ok(can('analyst', 'viewReports'));
  assert.ok(!can('observer', 'viewReports'));
  assert.ok(!can('observer', 'viewDraft'));
  assert.ok(can('observer', 'viewPublished'));
  assert.ok(can('staff', 'takeShifts'));
  assert.ok(!can('analyst', 'takeShifts'));
  assert.ok(!can('staff', 'inviteMembers'));
  assert.ok(can('assistant', 'inviteMembers'));
  assert.ok(can('manager', 'transferManagement'));
  assert.ok(!can('assistant', 'transferManagement'));
  assert.ok(!can('manager', 'leaveGroup'));
  assert.ok(can('staff', 'leaveGroup'));
  assert.ok(!can(null, 'viewPublished'));
  assert.ok(!can('manager', 'acaoInexistente'));
});

test('todo cargo tem ao menos uma ação, e o gestor quase todas', () => {
  for (const role of ['manager', 'assistant', 'analyst', 'observer', 'staff']) {
    assert.ok(ACTIONS.some((a) => can(role, a)), role);
  }
  const managerMissing = ACTIONS.filter((a) => !can('manager', a));
  assert.deepEqual(managerMissing.sort(), ['leaveGroup', 'viewOwnHistory', 'viewOwnReport']);
});

test('auxiliar não pode dar o cargo de gestor', () => {
  assert.ok(!assignableRoles('assistant').includes('manager'));
  assert.ok(assignableRoles('manager').includes('manager'));
  assert.deepEqual(assignableRoles('staff'), []);
});

test('mudar cargo move a pessoa entre os arrays', () => {
  const patch = changeRolePatch(group, 'p1', 'analyst');
  assert.deepEqual(patch.analystIds, ['an', 'p1']);
  assert.deepEqual(patch.assistantIds, ['a1', 'a2']);

  const back = changeRolePatch(group, 'a1', 'staff');
  assert.deepEqual(back.assistantIds, ['a2']);
  assert.equal(back.managerIds.length, 1);
});

test('transferir gestão: antigo gestor vira auxiliar se houver vaga', () => {
  const patch = changeRolePatch(group, 'p1', 'manager');
  assert.deepEqual(patch.managerIds, ['p1']);
  assert.deepEqual(patch.assistantIds, ['a1', 'a2', 'g']);
});

test('transferir gestão: sem vaga de auxiliar, antigo gestor vira plantonista', () => {
  const full = { ...group, memberIds: [...group.memberIds, 'a3'], assistantIds: ['a1', 'a2', 'a3'] };
  const patch = changeRolePatch(full, 'p1', 'manager');
  assert.deepEqual(patch.managerIds, ['p1']);
  assert.deepEqual(patch.assistantIds, ['a1', 'a2', 'a3']);
  assert.equal(roleOf({ ...full, ...patch }, 'g'), 'staff');
});

test('transferir gestão para um auxiliar libera a vaga dele para o antigo gestor', () => {
  const full = { ...group, memberIds: [...group.memberIds, 'a3'], assistantIds: ['a1', 'a2', 'a3'] };
  const patch = changeRolePatch(full, 'a1', 'manager');
  assert.deepEqual(patch.managerIds, ['a1']);
  assert.deepEqual(patch.assistantIds, ['a2', 'a3', 'g']);
});

test('remover membro tira a pessoa de todos os arrays', () => {
  const patch = removeMemberPatch(group, 'a2');
  assert.ok(!patch.memberIds.includes('a2'));
  assert.deepEqual(patch.assistantIds, ['a1']);
  assert.deepEqual(patch.managerIds, ['g']);
});
