// Testes das regras do Firestore (cargos da plataforma, grupos, convites, perfis).
// Rodam em emuladores próprios (portas 8180 e 9199, firebase.test.json), então
// podem rodar com os emuladores de desenvolvimento ligados. Na pasta do projeto:
//   firebase emulators:exec --config firebase.test.json --project demo-escalamed-test "node --test tests/rules/rules.test.mjs"
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { w, NOW, commit, admin, canRead, canQuery, canQueryGroup, clearFirestore, clearAuth, createUser, PROJECT } from './emulator.mjs';

// Cargos: plataforma (config/admins), gestor, coordenador (marcado no g1), coordenador de outro
// grupo, administrativo, médico membro, pendente (pediu Gestor, sem aprovação), de fora.
let dev, platformAdmin, gestor, coord, coordOther, adm, medico, pending, outsider, invited, unverified;
const G = 'groups/g1';
const G2 = 'groups/g2'; // grupo de que o gestor não é membro
const DAYS = 24 * 60 * 60 * 1000;

before(async () => {
  await clearAuth();
  // Dev: e-mail listado em isDev() no firestore.rules
  dev = await createUser('tiago.smartins@hapvida.com.br');
  platformAdmin = await createUser('admin@teste.com');
  gestor = await createUser('gestor@teste.com');
  coord = await createUser('coordenador@teste.com');
  coordOther = await createUser('coordenador2@teste.com');
  adm = await createUser('administrativo@teste.com');
  medico = await createUser('medico@teste.com');
  pending = await createUser('pendente@teste.com');
  outsider = await createUser('estranho@teste.com');
  invited = await createUser('convidado@teste.com');
  unverified = await createUser('naoconfirmado@teste.com', { verified: false });
});

function baseGroup(extra = {}) {
  return {
    name: 'TELEAUDITORIA HAPVIDA',
    type: 'team',
    color: '#2563EB',
    unit: { id: 'u1', name: 'HAPVIDA ANTONIO PRUDENTE', city: 'Fortaleza', state: 'CE' },
    categoryId: 'medico',
    timezone: 'America/Sao_Paulo',
    ownerId: gestor.uid,
    memberIds: [gestor.uid, coord.uid, medico.uid],
    coordinatorIds: [coord.uid],
    setupStep: 'done',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...extra,
  };
}

const card = (name = 'Fulano de Tal') => ({ name, photoURL: null, joinedAt: new Date() });
const profile = (categoryId, extra = {}) => ({ name: 'Fulano de Tal', categoryId, signupStep: 4, ...extra });
const decision = (categoryId, approved = true) => ({ categoryId, approved, decidedBy: 'seed', decidedAt: new Date() });

function invite(email, extra = {}) {
  return {
    email,
    groupName: 'TELEAUDITORIA HAPVIDA',
    unitName: 'HAPVIDA ANTONIO PRUDENTE',
    invitedBy: gestor.uid,
    invitedByName: 'Gestor',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 7 * DAYS),
    ...extra,
  };
}

beforeEach(async () => {
  await clearFirestore();
  await admin([
    w.set('config/admins', { uids: [platformAdmin.uid] }),
    w.set(`users/${gestor.uid}`, profile('gestor')),
    w.set(`users/${coord.uid}`, profile('coordenador-escala')),
    w.set(`users/${coordOther.uid}`, profile('coordenador-escala')),
    w.set(`users/${adm.uid}`, profile('administrativo')),
    w.set(`users/${medico.uid}`, profile('medico')),
    w.set(`users/${pending.uid}`, profile('gestor')),
    w.set(`access/${gestor.uid}`, decision('gestor')),
    w.set(`access/${coord.uid}`, decision('coordenador-escala')),
    w.set(`access/${coordOther.uid}`, decision('coordenador-escala')),
    w.set(`access/${adm.uid}`, decision('administrativo')),
    w.set(G, baseGroup()),
    w.set(`${G}/members/${gestor.uid}`, card('Gestor')),
    w.set(`${G}/members/${coord.uid}`, card('Coordenador')),
    w.set(`${G}/members/${medico.uid}`, card('Médico')),
    w.set(G2, baseGroup({ ownerId: coordOther.uid, memberIds: [coordOther.uid], coordinatorIds: [coordOther.uid] })),
    w.set(`${G2}/members/${coordOther.uid}`, card('Outro Coordenador')),
  ]);
});

// ---------- Ver grupos ----------
test('ver grupo: membro, coordenador, Gestor e Administrativo; pendente e de fora não', async () => {
  assert.ok(await canRead(medico.token, G));
  assert.ok(await canRead(coord.token, G));
  assert.ok(await canRead(medico.token, `${G}/members/${gestor.uid}`));
  // Gestor e Administrativo veem grupos de que não são membros
  assert.ok(await canRead(gestor.token, G2));
  assert.ok(await canRead(adm.token, G2));
  assert.ok(await canRead(adm.token, `${G2}/members/${coordOther.uid}`));
  assert.ok(await canRead(platformAdmin.token, G2));
  // Cargo pendente vale como Médico; coordenador de outro grupo não vê
  assert.ok(!(await canRead(pending.token, G2)));
  assert.ok(!(await canRead(coordOther.token, G)));
  assert.ok(!(await canRead(outsider.token, G)));
  assert.ok(!(await canRead(outsider.token, `${G}/members/${gestor.uid}`)));
});

test('listas de grupos: todos os de equipe só para Gestor e Administrativo', async () => {
  const allTeams = (actor) => canQuery(actor.token, 'groups', [['type', 'EQUAL', 'team']]);
  assert.ok(await allTeams(gestor));
  assert.ok(await allTeams(adm));
  assert.ok(await allTeams(platformAdmin));
  assert.ok(!(await allTeams(medico)));
  assert.ok(!(await allTeams(pending)));
  assert.ok(!(await allTeams(coord)));
  // Grupos que coordena e grupos em que está
  assert.ok(await canQuery(coord.token, 'groups', [['coordinatorIds', 'ARRAY_CONTAINS', coord.uid]]));
  assert.ok(await canQuery(medico.token, 'groups', [['memberIds', 'ARRAY_CONTAINS', medico.uid]]));
  assert.ok(!(await canQuery(medico.token, 'groups', [['memberIds', 'ARRAY_CONTAINS', gestor.uid]])));
});

test('ninguém lê os dados pessoais de outra pessoa', async () => {
  await admin([w.set(`users/${medico.uid}/private/data`, { email: medico.email, phone: null, cpf: null, state: 'CE', updatedAt: new Date() })]);
  assert.ok(await canRead(medico.token, `users/${medico.uid}/private/data`));
  assert.ok(!(await canRead(gestor.token, `users/${medico.uid}/private/data`)));
});

// ---------- Sessão encerrada pelo administrador (sessions/{uid}) ----------
const endSession = (actor, target, extra = {}) =>
  commit(actor.token, [w.set(`sessions/${target.uid}`, { endedAt: NOW, endedBy: actor.uid, ...extra })]);

test('sessão encerrada: só o administrador grava (nunca sobre si); só a própria pessoa lê', async () => {
  assert.ok(!(await endSession(gestor, medico)));
  assert.ok(!(await endSession(medico, medico)));
  assert.ok(!(await endSession(platformAdmin, platformAdmin)));
  assert.ok(!(await endSession(platformAdmin, medico, { endedBy: gestor.uid })));
  assert.ok(!(await endSession(platformAdmin, medico, { motivo: 'x' })));
  assert.ok(await endSession(platformAdmin, medico));
  assert.ok(await canRead(medico.token, `sessions/${medico.uid}`));
  assert.ok(!(await canRead(gestor.token, `sessions/${medico.uid}`)));
});

// ---------- Aprovação de cargos ----------
const approve = (actor, target, categoryId, approved = true) =>
  commit(actor.token, [w.set(`access/${target.uid}`, { categoryId, approved, decidedBy: actor.uid, decidedAt: NOW })]);

test('aprovação: Gestor e administrador aprovam; os demais não; ninguém aprova a si mesmo', async () => {
  assert.ok(!(await approve(medico, pending, 'gestor')));
  assert.ok(!(await approve(adm, pending, 'gestor')));
  assert.ok(!(await approve(coord, pending, 'gestor')));
  assert.ok(!(await approve(pending, pending, 'gestor')));
  assert.ok(await approve(gestor, pending, 'gestor'));
  await admin([w.delete(`access/${pending.uid}`)]);
  assert.ok(await approve(platformAdmin, pending, 'gestor'));
});

test('aprovação: precisa ser o cargo que a pessoa pediu, com quem decidiu e quando', async () => {
  assert.ok(!(await approve(gestor, pending, 'administrativo'))); // pediu Gestor
  assert.ok(!(await approve(gestor, medico, 'medico'))); // Médico não passa por aprovação
  assert.ok(!(await commit(gestor.token, [w.set(`access/${pending.uid}`, { categoryId: 'gestor', approved: true, decidedBy: medico.uid, decidedAt: NOW })])));
});

test('aprovação: pendente ganha acesso só depois de aprovado; recusado continua sem', async () => {
  assert.ok(!(await canRead(pending.token, G2)));
  assert.ok(await approve(gestor, pending, 'gestor', false));
  assert.ok(!(await canRead(pending.token, G2)));
  assert.ok(await approve(gestor, pending, 'gestor', true));
  assert.ok(await canRead(pending.token, G2));
});

test('aprovação: a própria pessoa apaga a sua (troca de cargo); outra pessoa não', async () => {
  assert.ok(!(await commit(medico.token, [w.delete(`access/${coord.uid}`)])));
  assert.ok(await commit(coord.token, [w.delete(`access/${coord.uid}`)]));
  // Gestor retira a aprovação de alguém
  assert.ok(await commit(gestor.token, [w.delete(`access/${adm.uid}`)]));
});

test('aprovação: todos os logados leem (selo do cargo)', async () => {
  assert.ok(await canRead(medico.token, `access/${gestor.uid}`));
});

// ---------- Escala mensal ----------
const S = `${G}/schedules/2026-10`;
const S2 = `${G2}/schedules/2026-10`;

function schedule(actor, extra = {}) {
  return {
    status: 'draft',
    assignments: { '05_m': [medico.uid] },
    vacancies: { '05_n': 2 },
    createdAt: NOW,
    updatedAt: NOW,
    updatedBy: actor.uid,
    ...extra,
  };
}

test('escala: Gestor (qualquer grupo) e coordenador do grupo editam; os demais não', async () => {
  assert.ok(await commit(coord.token, [w.set(S, schedule(coord))]));
  assert.ok(await commit(gestor.token, [w.set(S2, schedule(gestor))])); // não é membro do g2
  assert.ok(!(await commit(coordOther.token, [w.update(S, { status: 'published', updatedAt: NOW, updatedBy: coordOther.uid })])));
  assert.ok(!(await commit(adm.token, [w.update(S, { status: 'published', updatedAt: NOW, updatedBy: adm.uid })])));
  assert.ok(!(await commit(medico.token, [w.update(S, { status: 'published', updatedAt: NOW, updatedBy: medico.uid })])));
  assert.ok(!(await commit(pending.token, [w.update(S2, { status: 'published', updatedAt: NOW, updatedBy: pending.uid })])));
  // Alocar como o app faz: arrayUnion no campo da célula + quem e quando
  const allocate = (actor) =>
    commit(actor.token, [
      {
        update: { name: `projects/${PROJECT}/databases/(default)/documents/${S}`, fields: { updatedBy: { stringValue: actor.uid } } },
        updateMask: { fieldPaths: ['updatedBy'] },
        updateTransforms: [
          { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
          { fieldPath: 'assignments.`05_t`', appendMissingElements: { values: [{ stringValue: medico.uid }] } },
        ],
        currentDocument: { exists: true },
      },
    ]);
  assert.ok(await allocate(coord));
  assert.ok(!(await allocate(medico)));
  // updatedBy precisa ser quem grava
  assert.ok(!(await commit(coord.token, [w.update(S, { status: 'draft', updatedAt: NOW, updatedBy: medico.uid })])));
});

test('escala: coordenador sem a aprovação do cargo perde a edição', async () => {
  await admin([w.set(`access/${coord.uid}`, decision('coordenador-escala', false))]);
  assert.ok(!(await commit(coord.token, [w.set(S, schedule(coord))])));
});

test('escala: id precisa ser um mês válido e campos estranhos são recusados', async () => {
  assert.ok(!(await commit(gestor.token, [w.set(`${G}/schedules/2026-13`, schedule(gestor))])));
  assert.ok(!(await commit(gestor.token, [w.set(`${G}/schedules/outubro`, schedule(gestor))])));
  assert.ok(!(await commit(gestor.token, [w.set(S, schedule(gestor, { extra: 1 }))])));
  assert.ok(!(await commit(gestor.token, [w.set(S, schedule(gestor, { status: 'final' }))])));
});

test('escala: rascunho só Gestor e coordenador; publicada também membros e Administrativo', async () => {
  await admin([w.set(S, { ...schedule(gestor), createdAt: new Date(), updatedAt: new Date() })]);
  assert.ok(await canRead(gestor.token, S));
  assert.ok(await canRead(coord.token, S));
  assert.ok(!(await canRead(adm.token, S)));
  assert.ok(!(await canRead(medico.token, S)));
  assert.ok(!(await canRead(outsider.token, S)));
  await admin([w.update(S, { status: 'published' })]);
  assert.ok(await canRead(adm.token, S));
  assert.ok(await canRead(medico.token, S));
  assert.ok(!(await canRead(outsider.token, S)));
  assert.ok(!(await canRead(pending.token, S)));
  // Mês sem escala: membro consegue perguntar (e recebe "não existe")
  assert.ok(await canRead(medico.token, `${G}/schedules/2026-11`));
});

// ---------- Membros e coordenadores ----------
test('Gestor marca e desmarca coordenadores; coordenador não', async () => {
  assert.ok(!(await commit(coord.token, [w.update(G, { coordinatorIds: [coord.uid, medico.uid], updatedAt: NOW })])));
  assert.ok(await commit(gestor.token, [w.update(G, { coordinatorIds: [coord.uid, medico.uid], updatedAt: NOW })]));
  assert.ok(await commit(gestor.token, [w.update(G, { coordinatorIds: [], updatedAt: NOW })]));
  // Coordenador precisa ser membro
  assert.ok(!(await commit(gestor.token, [w.update(G, { coordinatorIds: [outsider.uid], updatedAt: NOW })])));
});

test('remover membro: Gestor remove qualquer um; coordenador só quem não é coordenador', async () => {
  const remove = (actor, target, coordinatorIds = baseGroup().coordinatorIds) =>
    commit(actor.token, [
      w.update(G, { memberIds: baseGroup().memberIds.filter((id) => id !== target.uid), coordinatorIds, updatedAt: NOW }),
      w.delete(`${G}/members/${target.uid}`),
    ]);
  assert.ok(!(await remove(medico, gestor)));
  assert.ok(!(await remove(adm, medico)));
  assert.ok(await remove(coord, medico));
  await admin([w.set(G, baseGroup()), w.set(`${G}/members/${medico.uid}`, card('Médico'))]);
  // Coordenador não remove outro coordenador (isso é com o Gestor)
  await admin([w.update(G, { coordinatorIds: [coord.uid, medico.uid] })]);
  const removeCoordinator = (actor) =>
    commit(actor.token, [
      w.update(G, { memberIds: [gestor.uid, coord.uid], coordinatorIds: [coord.uid], updatedAt: NOW }),
      w.delete(`${G}/members/${medico.uid}`),
    ]);
  assert.ok(!(await removeCoordinator(coord)));
  assert.ok(await removeCoordinator(gestor));
});

test('ninguém adiciona membro direto (só por convite)', async () => {
  for (const actor of [gestor, coord]) {
    assert.ok(!(await commit(actor.token, [w.update(G, { memberIds: [...baseGroup().memberIds, outsider.uid], updatedAt: NOW })])));
  }
});

test('sair do grupo: a pessoa tira só a si mesma (inclusive coordenador)', async () => {
  const leave = (actor, fields) =>
    commit(actor.token, [w.update(G, { ...fields, updatedAt: NOW }), w.delete(`${G}/members/${actor.uid}`)]);
  assert.ok(!(await leave(medico, { memberIds: [gestor.uid] })));
  assert.ok(await leave(coord, { memberIds: [gestor.uid, medico.uid], coordinatorIds: [] }));
  assert.ok(await leave(medico, { memberIds: [gestor.uid] }));
});

// ---------- Convites ----------
const join = (user, extra = {}) =>
  commit(user.token, [
    w.update(G, { memberIds: [...baseGroup().memberIds, user.uid], ...extra, updatedAt: NOW }),
    w.set(`${G}/members/${user.uid}`, { ...card('Convidado Silva'), joinedAt: NOW }),
    w.delete(`${G}/invites/${user.email}`),
  ]);

test('sem convite, ninguém entra', async () => {
  assert.ok(!(await join(invited)));
});

test('com convite, entra só a si mesmo e como membro', async () => {
  await admin([w.set(`${G}/invites/${invited.email}`, invite(invited.email))]);
  // Tentando entrar como coordenador
  assert.ok(!(await join(invited, { coordinatorIds: [coord.uid, invited.uid] })));
  // Tentando colocar outra pessoa junto
  const withOther = await commit(invited.token, [
    w.update(G, { memberIds: [...baseGroup().memberIds, invited.uid, outsider.uid], updatedAt: NOW }),
    w.set(`${G}/members/${invited.uid}`, { ...card(), joinedAt: NOW }),
  ]);
  assert.ok(!withOther);
  assert.ok(await join(invited));
});

test('convite vencido não vale', async () => {
  await admin([w.set(`${G}/invites/${invited.email}`, invite(invited.email, { expiresAt: new Date(Date.now() - DAYS) }))]);
  assert.ok(!(await join(invited)));
});

test('Gestor e coordenador convidam; Administrativo e membro não', async () => {
  const create = (actor) =>
    commit(actor.token, [
      w.set(`${G}/invites/novo@teste.com`, { ...invite('novo@teste.com'), invitedBy: actor.uid, createdAt: NOW }),
    ]);
  assert.ok(await create(gestor));
  assert.ok(await create(coord));
  assert.ok(!(await create(adm)));
  assert.ok(!(await create(medico)));
  assert.ok(!(await create(coordOther)));
  // Convite com cargo (campo antigo) é recusado
  assert.ok(!(await commit(gestor.token, [w.set(`${G}/invites/novo@teste.com`, { ...invite('novo@teste.com'), role: 'assistant', invitedBy: gestor.uid, createdAt: NOW })])));
});

test('cada um vê só os próprios convites', async () => {
  await admin([w.set(`${G}/invites/${invited.email}`, invite(invited.email))]);
  assert.ok(await canRead(invited.token, `${G}/invites/${invited.email}`));
  assert.ok(await canRead(coord.token, `${G}/invites/${invited.email}`));
  assert.ok(!(await canRead(outsider.token, `${G}/invites/${invited.email}`)));
  assert.ok(await canQueryGroup(invited.token, 'invites', 'email', invited.email));
  assert.ok(!(await canQueryGroup(outsider.token, 'invites', 'email', invited.email)));
});

function personInvite(person, extra = {}) {
  const { email, ...rest } = invite('x@teste.com', extra);
  return { ...rest, uid: person.uid, name: 'Convidado Silva' };
}

test('convite por pessoa: para quem tem perfil; não para membro nem sem perfil', async () => {
  await admin([w.set(`users/${invited.uid}`, { name: 'Convidado Silva', signupStep: 4 })]);
  const create = (actor, person) =>
    commit(actor.token, [w.set(`${G}/invites/${person.uid}`, { ...personInvite(person), invitedBy: actor.uid, createdAt: NOW })]);
  assert.ok(!(await create(gestor, outsider))); // sem perfil na plataforma
  assert.ok(!(await create(gestor, medico))); // já é membro
  assert.ok(!(await create(medico, invited))); // membro não convida
  assert.ok(await create(coord, invited));
});

test('convite por pessoa: só ela vê e entra', async () => {
  await admin([w.set(`${G}/invites/${invited.uid}`, personInvite(invited))]);
  assert.ok(await canRead(invited.token, `${G}/invites/${invited.uid}`));
  assert.ok(!(await canRead(outsider.token, `${G}/invites/${invited.uid}`)));
  assert.ok(await canQueryGroup(invited.token, 'invites', 'uid', invited.uid));
  const joinByPerson = () =>
    commit(invited.token, [
      w.update(G, { memberIds: [...baseGroup().memberIds, invited.uid], updatedAt: NOW }),
      w.set(`${G}/members/${invited.uid}`, { ...card('Convidado Silva'), joinedAt: NOW }),
      w.delete(`${G}/invites/${invited.uid}`),
    ]);
  assert.ok(await joinByPerson());
});

test('convite recusado: só a pessoa marca; não dá para aceitar depois; quem convidou acompanha', async () => {
  await admin([w.set(`${G}/invites/${invited.email}`, invite(invited.email))]);
  const decline = (actor) =>
    commit(actor.token, [
      w.update(`${G}/invites/${invited.email}`, { status: 'declined', respondedAt: NOW, respondedByName: 'Convidado Silva' }),
    ]);
  assert.ok(!(await decline(medico)));
  assert.ok(await decline(invited));
  assert.ok(!(await join(invited)));
  assert.ok(await canQueryGroup(gestor.token, 'invites', 'invitedBy', gestor.uid));
  assert.ok(!(await canQueryGroup(outsider.token, 'invites', 'invitedBy', gestor.uid)));
  assert.ok(await commit(gestor.token, [w.delete(`${G}/invites/${invited.email}`)]));
});

// ---------- Criar grupo e configurações ----------
function newGroup(actor, extra = {}) {
  return {
    ...baseGroup({ ownerId: actor.uid, memberIds: [actor.uid], coordinatorIds: [], setupStep: 'shifts', ...extra }),
    createdAt: NOW,
    updatedAt: NOW,
  };
}
const createGroup = (actor, data, path = 'groups/novo') =>
  commit(actor.token, [w.set(path, data), w.set(`${path}/members/${actor.uid}`, { ...card(), joinedAt: NOW })]);

test('criar grupo de equipe: Gestor e Coordenador; Médico, Administrativo e pendente não', async () => {
  assert.ok(await createGroup(gestor, newGroup(gestor), 'groups/n1'));
  assert.ok(await createGroup(coord, newGroup(coord, { coordinatorIds: [coord.uid] }), 'groups/n2'));
  // Coordenador precisa entrar como coordenador do grupo que cria
  assert.ok(!(await createGroup(coord, newGroup(coord), 'groups/n3')));
  assert.ok(!(await createGroup(medico, newGroup(medico), 'groups/n4')));
  assert.ok(!(await createGroup(adm, newGroup(adm), 'groups/n5')));
  assert.ok(!(await createGroup(pending, newGroup(pending), 'groups/n6')));
  // No nome de outra pessoa
  assert.ok(!(await commit(gestor.token, [w.set('groups/n7', newGroup(medico))])));
});

test('escala individual: qualquer um cria para si; só o dono vê e edita', async () => {
  const personal = newGroup(medico, { type: 'personal', name: 'Meus plantões' });
  assert.ok(await createGroup(medico, personal, 'groups/p1'));
  assert.ok(await canRead(medico.token, 'groups/p1'));
  assert.ok(!(await canRead(gestor.token, 'groups/p1')));
  assert.ok(!(await canRead(adm.token, 'groups/p1')));
  assert.ok(await commit(medico.token, [w.set('groups/p1/schedules/2026-10', schedule(medico))]));
  assert.ok(!(await commit(gestor.token, [w.set('groups/p1/schedules/2026-11', schedule(gestor))])));
  // Com outra pessoa junto não vale
  assert.ok(!(await createGroup(medico, newGroup(medico, { type: 'personal', memberIds: [medico.uid, gestor.uid] }), 'groups/p2')));
});

test('dados e turnos do grupo: Gestor; coordenador só enquanto o grupo é criado', async () => {
  let n = 0;
  const rename = (actor, path = G) => commit(actor.token, [w.update(path, { name: `Novo nome ${++n}`, updatedAt: NOW })]);
  const shift = (actor, path = G) =>
    commit(actor.token, [w.set(`${path}/shifts/t${++n}`, { title: 'M', startMinute: 420, endMinute: 780, createdAt: NOW, updatedAt: NOW })]);
  assert.ok(await rename(gestor));
  assert.ok(await shift(gestor));
  assert.ok(!(await rename(coord)));
  assert.ok(!(await shift(coord)));
  assert.ok(!(await rename(adm)));
  await admin([w.update(G, { setupStep: 'members' })]);
  assert.ok(await rename(coord));
  assert.ok(await shift(coord));
});

test('excluir grupo: Gestor sim; coordenador e membro não', async () => {
  assert.ok(!(await commit(coord.token, [w.delete(G)])));
  assert.ok(!(await commit(medico.token, [w.delete(G)])));
  assert.ok(await commit(gestor.token, [w.delete(G)]));
});

// ---------- Histórico de movimentações ----------
function movement(actor, type, extra = {}) {
  return {
    type,
    groupId: 'g1',
    actorUid: actor.uid,
    targetUid: null,
    memberUids: [actor.uid],
    public: true,
    shiftId: 'm',
    shiftTitle: 'M',
    shiftDate: '2026-11-07',
    shiftStart: '07:00',
    shiftEnd: '13:00',
    monthKey: '2026-11',
    createdAt: NOW,
    ...extra,
  };
}

test('histórico: quem edita grava as ações do editor; membro só troca, cessão e vaga assumida', async () => {
  const add = (actor, data, id) => commit(actor.token, [w.set(`${G}/movements/${id}`, data)]);
  assert.ok(await add(coord, movement(coord, 'assigned', { targetUid: medico.uid, memberUids: [coord.uid, medico.uid] }), 'mv1'));
  assert.ok(await add(platformAdmin, movement(platformAdmin, 'vacant_open', { count: 2 }), 'mv2'));
  assert.ok(!(await add(medico, movement(medico, 'assigned'), 'mv3')));
  assert.ok(!(await add(adm, movement(adm, 'assigned'), 'mv4')));
  assert.ok(await add(medico, movement(medico, 'swap', { targetUid: coord.uid, memberUids: [medico.uid, coord.uid] }), 'mv5'));
  // Não grava no nome de outra pessoa, com tipo inválido, em outro grupo ou sendo de fora
  assert.ok(!(await add(medico, { ...movement(medico, 'swap'), actorUid: gestor.uid, memberUids: [gestor.uid] }, 'mv6')));
  assert.ok(!(await add(medico, movement(medico, 'hackear'), 'mv7')));
  assert.ok(!(await add(medico, movement(medico, 'swap', { groupId: 'outro' }), 'mv8')));
  assert.ok(!(await add(outsider, movement(outsider, 'swap'), 'mv9')));
});

test('histórico: ninguém altera nem apaga; rascunho só para quem edita', async () => {
  await admin([
    w.set(`${G}/movements/pub`, { ...movement(gestor, 'published'), createdAt: new Date() }),
    w.set(`${G}/movements/priv`, { ...movement(gestor, 'assigned'), public: false, createdAt: new Date() }),
  ]);
  assert.ok(!(await commit(gestor.token, [w.update(`${G}/movements/pub`, { type: 'unpublished' })])));
  assert.ok(!(await commit(gestor.token, [w.delete(`${G}/movements/pub`)])));
  assert.ok(await canRead(medico.token, `${G}/movements/pub`));
  assert.ok(await canRead(adm.token, `${G}/movements/pub`));
  assert.ok(!(await canRead(medico.token, `${G}/movements/priv`)));
  assert.ok(!(await canRead(adm.token, `${G}/movements/priv`)));
  assert.ok(await canRead(coord.token, `${G}/movements/priv`));
  assert.ok(!(await canRead(outsider.token, `${G}/movements/pub`)));
});

// ---------- Perfil ----------
test('perfil: a própria pessoa cria; cargo inválido e perfil alheio não', async () => {
  const data = (categoryId) => ({
    name: 'Fulano de Tal',
    nameLower: 'fulano de tal',
    photoURL: null,
    username: null,
    categoryId,
    specialty: null,
    council: null,
    searchKeywords: ['fulano', 'de', 'tal'],
    signupStep: 3,
    termsAcceptedAt: NOW,
    termsVersion: '2026-10',
    createdAt: NOW,
    updatedAt: NOW,
  });
  assert.ok(!(await commit(unverified.token, [w.set(`users/${unverified.uid}`, data('astronauta'))])));
  assert.ok(await commit(unverified.token, [w.set(`users/${unverified.uid}`, data('coordenador-escala'))]));
  assert.ok(!(await commit(outsider.token, [w.set(`users/${unverified.uid}`, data(null))])));
});

test('perfil: apelido, bio de até 160, Lattes e listas de até 20 itens', async () => {
  const base = {
    name: 'Fulano de Tal',
    nameLower: 'fulano de tal',
    photoURL: null,
    username: null,
    categoryId: 'medico',
    specialty: null,
    council: null,
    searchKeywords: ['fulano', 'de', 'tal'],
    signupStep: 4,
    termsAcceptedAt: new Date(),
    termsVersion: '2026-10',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await admin([w.set(`users/${medico.uid}`, base)]);
  const save = (about, actor = medico) => commit(actor.token, [w.update(`users/${medico.uid}`, { about, updatedAt: NOW })]);
  const item = { title: 'ACLS', place: 'AHA', start: '2024', end: null };
  const about = {
    nickname: 'Fulano',
    bio: 'Plantonista de emergência.',
    lattesUrl: 'http://lattes.cnpq.br/123',
    certifications: [item],
    education: [],
    experiences: [],
    academicLeagues: [],
    cooperatives: [],
  };
  assert.ok(await save(about));
  assert.ok(await save(null));
  assert.ok(!(await save({ ...about, bio: 'x'.repeat(161) })));
  assert.ok(!(await save({ ...about, lattesUrl: 'javascript:alert(1)' })));
  assert.ok(!(await save({ ...about, certifications: Array(21).fill(item) })));
  assert.ok(!(await save({ ...about, outro: 'campo' })));
  assert.ok(!(await save(about, outsider)));
});

// ---------- Administrador da plataforma (config/admins) ----------
test('config/admins: todos os logados leem; ninguém grava pelo app', async () => {
  assert.ok(await canRead(medico.token, 'config/admins'));
  assert.ok(!(await commit(platformAdmin.token, [w.set('config/admins', { uids: [platformAdmin.uid, medico.uid] })])));
  assert.ok(!(await commit(gestor.token, [w.set('config/admins', { uids: [gestor.uid] })])));
});

test('administrador apaga o perfil de outra pessoa; Gestor não', async () => {
  const privateData = { email: medico.email, phone: null, cpf: null, state: 'CE', updatedAt: new Date() };
  await admin([w.set(`users/${medico.uid}/private/data`, privateData)]);
  const removeProfile = (actor) =>
    commit(actor.token, [w.delete(`users/${medico.uid}/private/data`), w.delete(`users/${medico.uid}`)]);
  assert.ok(!(await removeProfile(gestor)));
  assert.ok(await removeProfile(platformAdmin));
  // Administrador não lê os dados pessoais de ninguém
  await admin([w.set(`users/${medico.uid}/private/data`, privateData)]);
  assert.ok(!(await canRead(platformAdmin.token, `users/${medico.uid}/private/data`)));
});

// ---------- E-mail no cartão de membro (busca da aba Membros) ----------
test('cartão: cada um grava só o próprio e-mail; cargo antigo no cartão é recusado', async () => {
  const path = `${G}/members/${medico.uid}`;
  assert.ok(await commit(medico.token, [w.update(path, { email: medico.email })]));
  assert.ok(!(await commit(medico.token, [w.update(path, { email: 'outro@teste.com' })])));
  assert.ok(!(await commit(gestor.token, [w.update(path, { email: gestor.email })])));
  assert.ok(!(await commit(medico.token, [w.update(path, { role: 'manager' })])));
});

test('entrar por convite com o e-mail de outra pessoa no cartão é recusado', async () => {
  await admin([w.set(`${G}/invites/${invited.email}`, invite(invited.email))]);
  const entrar = (email) =>
    commit(invited.token, [
      w.update(G, { memberIds: [...baseGroup().memberIds, invited.uid], updatedAt: NOW }),
      w.set(`${G}/members/${invited.uid}`, { ...card('Convidado Silva'), email, joinedAt: NOW }),
      w.delete(`${G}/invites/${invited.email}`),
    ]);
  assert.ok(!(await entrar('falso@teste.com')));
  assert.ok(await entrar(invited.email));
});

// ---------- Dev (e-mail em isDev(), acima de todos) ----------
test('Dev: lê e grava tudo, inclusive escala individual e dados pessoais dos outros', async () => {
  const P = 'groups/p1';
  await admin([
    w.set(P, baseGroup({ type: 'personal', unit: null, ownerId: medico.uid, memberIds: [medico.uid], coordinatorIds: [] })),
    w.set(`users/${medico.uid}/private/data`, { email: medico.email, phone: null, cpf: null, state: 'CE', updatedAt: new Date() }),
  ]);
  // Só o Dev lê config/dev (é assim que o app descobre o cargo)
  assert.ok(await canRead(dev.token, 'config/dev'));
  assert.ok(!(await canRead(platformAdmin.token, 'config/dev')));
  assert.ok(!(await canRead(gestor.token, 'config/dev')));
  // Lê o que nenhum outro cargo lê
  assert.ok(await canRead(dev.token, P));
  assert.ok(await canRead(dev.token, `users/${medico.uid}/private/data`));
  assert.ok(await canQuery(dev.token, 'groups', [['type', 'EQUAL', 'personal']]));
  assert.ok(!(await canQuery(gestor.token, 'groups', [['type', 'EQUAL', 'personal']])));
  assert.ok(await canQueryGroup(dev.token, 'invites', 'email', 'qualquer@teste.com'));
  // Altera e apaga qualquer coisa
  assert.ok(await commit(dev.token, [w.update(P, { name: 'Escala revisada', updatedAt: NOW })]));
  assert.ok(await commit(dev.token, [w.update(`users/${medico.uid}`, { name: 'Nome Corrigido' })]));
  assert.ok(await commit(dev.token, [w.set(`access/${dev.uid}`, decision('gestor'))]));
  assert.ok(await commit(dev.token, [w.set('config/admins', { uids: [platformAdmin.uid, dev.uid] })]));
  assert.ok(await commit(dev.token, [w.delete(G2)]));
  // Os outros continuam sem esse acesso
  assert.ok(!(await canRead(platformAdmin.token, P)));
  assert.ok(!(await commit(platformAdmin.token, [w.set('config/admins', { uids: [platformAdmin.uid, gestor.uid] })])));
});
