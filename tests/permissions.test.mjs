// Testes dos cargos da plataforma e do papel de cada um nos grupos. Rodar: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  can,
  ACTIONS,
  platformRoleOf,
  approvalState,
  groupRole,
  canEditSettings,
  canRemoveMember,
  canLeave,
  canCreateTeam,
  canApprove,
  seesAllGroups,
  seesReports,
  removeMemberPatch,
  coordinatorPatch,
} from '../public/js/permissions.js';

const team = { type: 'team', ownerId: 'g', memberIds: ['g', 'c', 'm1', 'm2'], coordinatorIds: ['c'], setupStep: 'done' };
const personal = { type: 'personal', ownerId: 'm1', memberIds: ['m1'], coordinatorIds: [] };
const approved = (categoryId) => ({ categoryId, approved: true });

test('cargo que vale: administrador é Gestor; os outros só com aprovação', () => {
  assert.equal(platformRoleOf({ isAdmin: true }), 'gestor');
  assert.equal(platformRoleOf({ access: approved('gestor') }), 'gestor');
  assert.equal(platformRoleOf({ access: approved('coordenador-escala') }), 'coordenador');
  assert.equal(platformRoleOf({ access: approved('administrativo') }), 'administrativo');
  assert.equal(platformRoleOf({ access: { categoryId: 'gestor', approved: false } }), null);
  assert.equal(platformRoleOf({ access: null }), null);
  assert.equal(platformRoleOf(), null);
});

test('Dev: acima de todos, mesmo com outro cargo pedido ou aprovado', () => {
  assert.equal(platformRoleOf({ isDev: true }), 'dev');
  assert.equal(platformRoleOf({ isDev: true, isAdmin: true, access: approved('administrativo') }), 'dev');
  // Grupos de equipe e escalas individuais dos outros; a própria continua "owner"
  assert.equal(groupRole(team, 'x', 'dev'), 'dev');
  assert.equal(groupRole(team, 'c', 'dev'), 'dev');
  assert.equal(groupRole(personal, 'x', 'dev'), 'dev');
  assert.equal(groupRole(personal, 'm1', 'dev'), 'owner');
  // Todas as ações de grupo (o relatório "só o meu" é do membro; o Dev vê o completo)
  for (const action of ACTIONS.filter((a) => a !== 'viewOwnReport')) assert.ok(can('dev', action), action);
  assert.ok(canEditSettings(team, 'dev'));
  assert.ok(canRemoveMember(team, 'dev', 'c', 'x'));
  assert.ok(!canRemoveMember(team, 'dev', 'x', 'x'), 'remover a si mesmo é "Sair do grupo"');
  assert.ok(canCreateTeam('dev') && canApprove('dev') && seesAllGroups('dev') && seesReports('dev'));
});

test('situação da aprovação segue o cargo pedido naquele momento', () => {
  assert.equal(approvalState({ categoryId: 'medico' }, null), 'none');
  assert.equal(approvalState({ categoryId: 'gestor' }, null), 'pending');
  assert.equal(approvalState({ categoryId: 'gestor' }, approved('gestor')), 'approved');
  assert.equal(approvalState({ categoryId: 'gestor' }, { categoryId: 'gestor', approved: false }), 'declined');
  // Trocou de cargo depois de aprovado: volta a aguardar
  assert.equal(approvalState({ categoryId: 'administrativo' }, approved('gestor')), 'pending');
});

test('papel no grupo', () => {
  assert.equal(groupRole(team, 'x', 'gestor'), 'gestor');
  assert.equal(groupRole(team, 'c', 'coordenador'), 'coordinator');
  // Marcado como coordenador, mas sem o cargo aprovado: só membro
  assert.equal(groupRole(team, 'c', null), 'member');
  // Coordenador de outro grupo
  assert.equal(groupRole(team, 'x', 'coordenador'), null);
  assert.equal(groupRole(team, 'x', 'administrativo'), 'administrativo');
  assert.equal(groupRole(team, 'm1', null), 'member');
  assert.equal(groupRole(team, 'x', null), null);
  // Escala individual: só o dono, mesmo para o Gestor
  assert.equal(groupRole(personal, 'm1', null), 'owner');
  assert.equal(groupRole(personal, 'g', 'gestor'), null);
});

test('matriz de permissões', () => {
  assert.ok(can('gestor', 'editSettings'));
  assert.ok(!can('coordinator', 'editSettings'));
  assert.ok(can('coordinator', 'editSchedule'));
  assert.ok(can('coordinator', 'manageMembers'));
  assert.ok(!can('coordinator', 'setCoordinators'));
  assert.ok(can('gestor', 'setCoordinators'));
  assert.ok(!can('administrativo', 'editSchedule'));
  assert.ok(!can('administrativo', 'viewDraft'));
  assert.ok(can('administrativo', 'viewReports'));
  assert.ok(!can('member', 'viewDraft'));
  assert.ok(!can('member', 'manageMembers'));
  assert.ok(can('member', 'viewOwnReport'));
  assert.ok(can('owner', 'editSchedule'));
  assert.ok(!can(null, 'viewHistory'));
  assert.ok(!can('gestor', 'acaoInexistente'));
});

test('todo papel tem ao menos uma ação', () => {
  for (const role of ['dev', 'gestor', 'coordinator', 'administrativo', 'member', 'owner']) {
    assert.ok(ACTIONS.some((a) => can(role, a)), role);
  }
});

test('configurações: coordenador só enquanto o grupo é criado', () => {
  assert.ok(canEditSettings(team, 'gestor'));
  assert.ok(!canEditSettings(team, 'coordinator'));
  assert.ok(canEditSettings({ ...team, setupStep: 'shifts' }, 'coordinator'));
  assert.ok(!canEditSettings(team, 'administrativo'));
});

test('remover membro: coordenador não remove outro coordenador nem a si mesmo', () => {
  assert.ok(canRemoveMember(team, 'gestor', 'c', 'g'));
  assert.ok(canRemoveMember(team, 'coordinator', 'm1', 'c'));
  assert.ok(!canRemoveMember({ ...team, coordinatorIds: ['c', 'm1'] }, 'coordinator', 'm1', 'c'));
  assert.ok(!canRemoveMember(team, 'coordinator', 'c', 'c'));
  assert.ok(!canRemoveMember(team, 'member', 'm2', 'm1'));
  assert.ok(!canRemoveMember(team, 'administrativo', 'm1', 'x'));
});

test('sair do grupo: só membro de grupo de equipe', () => {
  assert.ok(canLeave(team, 'm1'));
  assert.ok(!canLeave(team, 'x'));
  assert.ok(!canLeave(personal, 'm1'));
});

test('o que cada cargo libera fora dos grupos', () => {
  assert.ok(canCreateTeam('gestor') && canCreateTeam('coordenador'));
  assert.ok(!canCreateTeam('administrativo') && !canCreateTeam(null));
  assert.ok(canApprove('gestor') && !canApprove('coordenador'));
  assert.ok(seesAllGroups('gestor') && seesAllGroups('administrativo') && !seesAllGroups('coordenador'));
  assert.ok(seesReports('coordenador') && !seesReports(null));
});

test('remover membro tira a pessoa também dos coordenadores; marcar e desmarcar coordenador', () => {
  const patch = removeMemberPatch(team, 'c');
  assert.deepEqual(patch.memberIds, ['g', 'm1', 'm2']);
  assert.deepEqual(patch.coordinatorIds, []);
  assert.deepEqual(coordinatorPatch(team, 'm1', true).coordinatorIds, ['c', 'm1']);
  assert.deepEqual(coordinatorPatch(team, 'c', false).coordinatorIds, []);
  // Marcar duas vezes não repete
  assert.deepEqual(coordinatorPatch(team, 'c', true).coordinatorIds, ['c']);
});
