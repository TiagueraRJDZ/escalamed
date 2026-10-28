// Testes das regras do Firestore (cargos, convites, perfis).
// Rodam em emuladores próprios (portas 8180 e 9199, firebase.test.json), então
// podem rodar com os emuladores de desenvolvimento ligados. Na pasta do projeto:
//   firebase emulators:exec --config firebase.test.json --project demo-escalamed-test "node --test tests/rules/rules.test.mjs"
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { w, NOW, commit, admin, canRead, canQueryGroup, clearFirestore, clearAuth, createUser, PROJECT } from './emulator.mjs';

let manager, assistant, analyst, observer, staff, outsider, invited, unverified;
const G = 'groups/g1';
const DAYS = 24 * 60 * 60 * 1000;

before(async () => {
  await clearAuth();
  manager = await createUser('gestor@teste.com');
  assistant = await createUser('auxiliar@teste.com');
  analyst = await createUser('analista@teste.com');
  observer = await createUser('observador@teste.com');
  staff = await createUser('plantonista@teste.com');
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
    ownerId: manager.uid,
    memberIds: [manager.uid, assistant.uid, analyst.uid, observer.uid, staff.uid],
    managerIds: [manager.uid],
    assistantIds: [assistant.uid],
    analystIds: [analyst.uid],
    observerIds: [observer.uid],
    setupStep: 'done',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...extra,
  };
}

const card = (role, name = 'Fulano de Tal') => ({ role, name, photoURL: null, joinedAt: new Date() });

function invite(email, role = 'staff', extra = {}) {
  return {
    email,
    role,
    groupName: 'TELEAUDITORIA HAPVIDA',
    unitName: 'HAPVIDA ANTONIO PRUDENTE',
    invitedBy: manager.uid,
    invitedByName: 'Gestor',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 7 * DAYS),
    ...extra,
  };
}

beforeEach(async () => {
  await clearFirestore();
  await admin([
    w.set(G, baseGroup()),
    w.set(`${G}/members/${manager.uid}`, card('manager')),
    w.set(`${G}/members/${assistant.uid}`, card('assistant')),
    w.set(`${G}/members/${analyst.uid}`, card('analyst')),
    w.set(`${G}/members/${observer.uid}`, card('observer')),
    w.set(`${G}/members/${staff.uid}`, card('staff')),
  ]);
});

// Muda o cargo de alguém do jeito que o app faz: arrays do grupo + cartão, no mesmo lote
const roleChange = (actor, target, fields, role) =>
  commit(actor.token, [
    w.update(G, { ...fields, updatedAt: NOW }),
    w.update(`${G}/members/${target.uid}`, { role }),
  ]);

// ---------- Leitura ----------
test('membros leem o grupo; estranhos não', async () => {
  assert.ok(await canRead(staff.token, G));
  assert.ok(await canRead(observer.token, `${G}/members/${manager.uid}`));
  assert.ok(!(await canRead(outsider.token, G)));
  assert.ok(!(await canRead(outsider.token, `${G}/members/${manager.uid}`)));
});

test('ninguém lê os dados pessoais de outra pessoa', async () => {
  await admin([w.set(`users/${staff.uid}/private/data`, { email: staff.email, phone: null, cpf: null, state: 'CE', updatedAt: new Date() })]);
  assert.ok(await canRead(staff.token, `users/${staff.uid}/private/data`));
  assert.ok(!(await canRead(manager.token, `users/${staff.uid}/private/data`)));
});

// ---------- Cargos ----------
test('gestor promove auxiliares até 3; o 4º falha', async () => {
  const extra = await createUser(`extra${Date.now()}@teste.com`);
  await admin([
    w.update(G, { memberIds: [...baseGroup().memberIds, extra.uid] }),
    w.set(`${G}/members/${extra.uid}`, card('staff')),
  ]);

  // 2º e 3º auxiliares
  assert.ok(await roleChange(manager, staff, { assistantIds: [assistant.uid, staff.uid] }, 'assistant'));
  assert.ok(
    await roleChange(
      manager,
      analyst,
      { assistantIds: [assistant.uid, staff.uid, analyst.uid], analystIds: [] },
      'assistant',
    ),
  );
  // 4º: recusado
  assert.ok(
    !(await roleChange(
      manager,
      extra,
      { assistantIds: [assistant.uid, staff.uid, analyst.uid, extra.uid] },
      'assistant',
    )),
  );
});

test('auxiliar muda cargos, mas não mexe no gestor', async () => {
  assert.ok(await roleChange(assistant, staff, { observerIds: [observer.uid, staff.uid] }, 'observer'));
  assert.ok(
    !(await roleChange(
      assistant,
      staff,
      { managerIds: [staff.uid], observerIds: [observer.uid] },
      'manager',
    )),
  );
});

test('analista, observador e plantonista não mudam cargos', async () => {
  for (const actor of [analyst, observer, staff]) {
    assert.ok(!(await roleChange(actor, staff, { analystIds: [analyst.uid, staff.uid] }, 'analyst')));
  }
});

test('gestor transfere a gestão', async () => {
  const ok = await roleChange(
    manager,
    staff,
    { managerIds: [staff.uid], assistantIds: [assistant.uid, manager.uid] },
    'manager',
  );
  assert.ok(ok);
});

test('cartão com cargo diferente dos arrays é recusado', async () => {
  assert.ok(!(await roleChange(manager, staff, { analystIds: [analyst.uid, staff.uid] }, 'assistant')));
  // Cargo no cartão sem mudar os arrays
  assert.ok(!(await commit(manager.token, [w.update(`${G}/members/${staff.uid}`, { role: 'assistant' })])));
});

test('gestor não adiciona ninguém direto (só por convite)', async () => {
  const ok = await commit(manager.token, [
    w.update(G, { memberIds: [...baseGroup().memberIds, outsider.uid], updatedAt: NOW }),
  ]);
  assert.ok(!ok);
});

test('gestor remove um membro (arrays + cartão)', async () => {
  const ok = await commit(manager.token, [
    w.update(G, { memberIds: baseGroup().memberIds.filter((id) => id !== staff.uid), updatedAt: NOW }),
    w.delete(`${G}/members/${staff.uid}`),
  ]);
  assert.ok(ok);
});

test('auxiliar não remove o gestor', async () => {
  const ok = await commit(assistant.token, [
    w.update(G, {
      memberIds: baseGroup().memberIds.filter((id) => id !== manager.uid),
      managerIds: [],
      updatedAt: NOW,
    }),
  ]);
  assert.ok(!ok);
});

// ---------- Sair do grupo ----------
test('membro sai sozinho; não leva ninguém junto', async () => {
  const leave = (actor, fields) =>
    commit(actor.token, [w.update(G, { ...fields, updatedAt: NOW }), w.delete(`${G}/members/${actor.uid}`)]);

  // Tentando tirar outra pessoa junto
  assert.ok(
    !(await leave(analyst, {
      memberIds: baseGroup().memberIds.filter((id) => id !== analyst.uid && id !== assistant.uid),
      analystIds: [],
      assistantIds: [],
    })),
  );
  assert.ok(await leave(analyst, { memberIds: baseGroup().memberIds.filter((id) => id !== analyst.uid), analystIds: [] }));
});

test('gestor não sai sem transferir a gestão', async () => {
  const ok = await commit(manager.token, [
    w.update(G, {
      memberIds: baseGroup().memberIds.filter((id) => id !== manager.uid),
      managerIds: [],
      updatedAt: NOW,
    }),
  ]);
  assert.ok(!ok);
});

// ---------- Convites ----------
const join = (user, arrays, role) =>
  commit(user.token, [
    w.update(G, { memberIds: [...baseGroup().memberIds, user.uid], ...arrays, updatedAt: NOW }),
    w.set(`${G}/members/${user.uid}`, { ...card(role, 'Convidado Silva'), joinedAt: NOW }),
    w.delete(`${G}/invites/${user.email}`),
  ]);

test('sem convite, ninguém entra', async () => {
  assert.ok(!(await join(invited, {}, 'staff')));
});

test('com convite, entra só a si mesmo e só no cargo do convite', async () => {
  await admin([w.set(`${G}/invites/${invited.email}`, invite(invited.email, 'staff'))]);
  // Tentando entrar como auxiliar com convite de plantonista
  assert.ok(!(await join(invited, { assistantIds: [assistant.uid, invited.uid] }, 'assistant')));
  // Tentando colocar outra pessoa junto
  const withOther = await commit(invited.token, [
    w.update(G, { memberIds: [...baseGroup().memberIds, invited.uid, outsider.uid], updatedAt: NOW }),
    w.set(`${G}/members/${invited.uid}`, { ...card('staff'), joinedAt: NOW }),
  ]);
  assert.ok(!withOther);
  // Do jeito certo
  assert.ok(await join(invited, {}, 'staff'));
});

test('convite de analista coloca a pessoa em analystIds', async () => {
  await admin([w.set(`${G}/invites/${invited.email}`, invite(invited.email, 'analyst'))]);
  assert.ok(!(await join(invited, {}, 'staff')));
  assert.ok(await join(invited, { analystIds: [analyst.uid, invited.uid] }, 'analyst'));
});

test('convite vencido não vale', async () => {
  await admin([
    w.set(`${G}/invites/${invited.email}`, invite(invited.email, 'staff', { expiresAt: new Date(Date.now() - DAYS) })),
  ]);
  assert.ok(!(await join(invited, {}, 'staff')));
});

test('gestor e auxiliar convidam; plantonista não', async () => {
  const create = (actor, role = 'staff') =>
    commit(actor.token, [
      w.set(`${G}/invites/novo@teste.com`, {
        ...invite('novo@teste.com', role),
        invitedBy: actor.uid,
        createdAt: NOW,
      }),
    ]);
  assert.ok(await create(manager));
  assert.ok(await create(assistant, 'observer'));
  assert.ok(!(await create(staff)));
  assert.ok(!(await create(manager, 'manager')));
});

test('cada um vê só os próprios convites', async () => {
  await admin([w.set(`${G}/invites/${invited.email}`, invite(invited.email))]);
  assert.ok(await canRead(invited.token, `${G}/invites/${invited.email}`));
  assert.ok(!(await canRead(outsider.token, `${G}/invites/${invited.email}`)));
  assert.ok(await canQueryGroup(invited.token, 'invites', 'email', invited.email));
  assert.ok(!(await canQueryGroup(outsider.token, 'invites', 'email', invited.email)));
});

// ---------- Criação de grupo e perfil ----------
test('criar grupo: quem cria vira gestor; não dá para criar no nome de outra pessoa', async () => {
  const create = (actor, path) =>
    commit(actor.token, [
      w.set(path, {
        ...baseGroup({
          ownerId: actor.uid,
          memberIds: [actor.uid],
          managerIds: [actor.uid],
          assistantIds: [],
          analystIds: [],
          observerIds: [],
          setupStep: 'shifts',
        }),
        createdAt: NOW,
        updatedAt: NOW,
      }),
      w.set(`${path}/members/${actor.uid}`, { ...card('manager'), joinedAt: NOW }),
    ]);
  assert.ok(await create(outsider, 'groups/novo1'));
  const forOther = await commit(outsider.token, [
    w.set('groups/novo2', { ...baseGroup({ setupStep: 'shifts', assistantIds: [], analystIds: [], observerIds: [], memberIds: [manager.uid] }), createdAt: NOW, updatedAt: NOW }),
  ]);
  assert.ok(!forOther);
});

test('perfil: a própria pessoa cria; profissão inválida e perfil alheio não', async () => {
  const profile = (categoryId) => ({
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
  assert.ok(!(await commit(unverified.token, [w.set(`users/${unverified.uid}`, profile('astronauta'))])));
  assert.ok(await commit(unverified.token, [w.set(`users/${unverified.uid}`, profile(null))]));
  assert.ok(!(await commit(outsider.token, [w.set(`users/${unverified.uid}`, profile(null))])));
});

// ---------- Administrador da plataforma (config/admins) ----------
test('config/admins: todos os logados leem; ninguém grava pelo app', async () => {
  await admin([w.set('config/admins', { uids: [manager.uid] })]);
  assert.ok(await canRead(staff.token, 'config/admins'));
  assert.ok(!(await commit(manager.token, [w.set('config/admins', { uids: [manager.uid, staff.uid] })])));
  assert.ok(!(await commit(staff.token, [w.set('config/admins', { uids: [staff.uid] })])));
});

test('administrador apaga o perfil de outra pessoa; os demais não', async () => {
  const profile = { name: 'Plantonista', signupStep: 4 };
  const privateData = { email: staff.email, phone: null, cpf: null, state: 'CE', updatedAt: new Date() };
  await admin([
    w.set('config/admins', { uids: [analyst.uid] }),
    w.set(`users/${staff.uid}`, profile),
    w.set(`users/${staff.uid}/private/data`, privateData),
  ]);
  const removeProfile = (actor) =>
    commit(actor.token, [w.delete(`users/${staff.uid}/private/data`), w.delete(`users/${staff.uid}`)]);
  // Gestor de grupo não é administrador da plataforma
  assert.ok(!(await removeProfile(manager)));
  assert.ok(await removeProfile(analyst));
  // Administrador não lê os dados pessoais de ninguém
  await admin([w.set(`users/${staff.uid}/private/data`, privateData)]);
  assert.ok(!(await canRead(analyst.token, `users/${staff.uid}/private/data`)));
});

test('sem config/admins, ninguém apaga perfil alheio', async () => {
  await admin([w.set(`users/${staff.uid}`, { name: 'Plantonista', signupStep: 4 })]);
  assert.ok(!(await commit(manager.token, [w.delete(`users/${staff.uid}`)])));
});

// ---------- E-mail no cartão de membro (busca da aba Membros) ----------
test('cartão: cada um grava só o próprio e-mail', async () => {
  const path = `${G}/members/${staff.uid}`;
  assert.ok(await commit(staff.token, [w.update(path, { email: staff.email })]));
  assert.ok(!(await commit(staff.token, [w.update(path, { email: 'outro@teste.com' })])));
  // Ninguém grava o e-mail no cartão de outra pessoa
  assert.ok(!(await commit(manager.token, [w.update(path, { email: manager.email })])));
});

test('entrar por convite com o e-mail de outra pessoa no cartão é recusado', async () => {
  await admin([w.set(`${G}/invites/${invited.email}`, invite(invited.email, 'staff'))]);
  const entrar = (email) =>
    commit(invited.token, [
      w.update(G, { memberIds: [...baseGroup().memberIds, invited.uid], updatedAt: NOW }),
      w.set(`${G}/members/${invited.uid}`, { ...card('staff', 'Convidado Silva'), email, joinedAt: NOW }),
      w.delete(`${G}/invites/${invited.email}`),
    ]);
  assert.ok(!(await entrar('falso@teste.com')));
  assert.ok(await entrar(invited.email));
});

// ---------- Convite por pessoa (busca da plataforma; id = uid, sem e-mail) ----------
function personInvite(person, role = 'staff', extra = {}) {
  const { email, ...rest } = invite('x@teste.com', role, extra);
  return { ...rest, uid: person.uid, name: 'Convidado Silva' };
}

const createPersonInvite = (actor, person, role = 'staff') =>
  commit(actor.token, [
    w.set(`${G}/invites/${person.uid}`, { ...personInvite(person, role), invitedBy: actor.uid, createdAt: NOW }),
  ]);

test('convite por pessoa: gestor cria para quem tem perfil; não para membro nem sem perfil', async () => {
  await admin([w.set(`users/${invited.uid}`, { name: 'Convidado Silva', signupStep: 4 })]);
  assert.ok(!(await createPersonInvite(manager, outsider))); // sem perfil na plataforma
  assert.ok(!(await createPersonInvite(manager, staff))); // já é membro
  assert.ok(!(await createPersonInvite(staff, invited))); // plantonista não convida
  assert.ok(await createPersonInvite(manager, invited));
  // O id precisa ser o uid da pessoa
  const wrongId = await commit(manager.token, [
    w.set(`${G}/invites/${outsider.uid}`, { ...personInvite(invited), invitedBy: manager.uid, createdAt: NOW }),
  ]);
  assert.ok(!wrongId);
});

test('convite por pessoa: só ela vê, acha na lista e entra no cargo do convite', async () => {
  await admin([w.set(`${G}/invites/${invited.uid}`, personInvite(invited, 'observer'))]);
  assert.ok(await canRead(invited.token, `${G}/invites/${invited.uid}`));
  assert.ok(!(await canRead(outsider.token, `${G}/invites/${invited.uid}`)));
  assert.ok(await canQueryGroup(invited.token, 'invites', 'uid', invited.uid));
  assert.ok(!(await canQueryGroup(outsider.token, 'invites', 'uid', invited.uid)));

  const joinByPerson = (arrays, role) =>
    commit(invited.token, [
      w.update(G, { memberIds: [...baseGroup().memberIds, invited.uid], ...arrays, updatedAt: NOW }),
      w.set(`${G}/members/${invited.uid}`, { ...card(role, 'Convidado Silva'), joinedAt: NOW }),
      w.delete(`${G}/invites/${invited.uid}`),
    ]);
  assert.ok(!(await joinByPerson({}, 'staff')));
  assert.ok(await joinByPerson({ observerIds: [observer.uid, invited.uid] }, 'observer'));
});

test('convite por pessoa de outra pessoa não deixa ninguém entrar', async () => {
  await admin([w.set(`${G}/invites/${invited.uid}`, personInvite(invited))]);
  assert.ok(!(await join(outsider, {}, 'staff')));
});

// ---------- Escala mensal (groups/{g}/schedules/{YYYY-MM}) ----------
const S = `${G}/schedules/2026-10`;

function schedule(actor, extra = {}) {
  return {
    status: 'draft',
    assignments: { '05_m': [staff.uid] },
    vacancies: { '05_n': 2 },
    createdAt: NOW,
    updatedAt: NOW,
    updatedBy: actor.uid,
    ...extra,
  };
}

test('escala: gestor e auxiliar criam e editam; os demais não', async () => {
  assert.ok(!(await commit(staff.token, [w.set(S, schedule(staff))])));
  assert.ok(!(await commit(analyst.token, [w.set(S, schedule(analyst))])));
  assert.ok(!(await commit(outsider.token, [w.set(S, schedule(outsider))])));
  assert.ok(await commit(assistant.token, [w.set(S, schedule(assistant))]));
  // Alocar como o app faz: arrayUnion no campo da célula + quem e quando
  const allocate = (actor) =>
    commit(actor.token, [
      {
        update: { name: `projects/${PROJECT}/databases/(default)/documents/${S}`, fields: { updatedBy: { stringValue: actor.uid } } },
        updateMask: { fieldPaths: ['updatedBy'] },
        updateTransforms: [
          { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
          { fieldPath: 'assignments.`05_t`', appendMissingElements: { values: [{ stringValue: staff.uid }] } },
        ],
        currentDocument: { exists: true },
      },
    ]);
  assert.ok(await allocate(manager));
  assert.ok(!(await allocate(staff)));
  assert.ok(await commit(manager.token, [w.update(S, { status: 'published', updatedAt: NOW, updatedBy: manager.uid })]));
  // updatedBy precisa ser quem grava
  assert.ok(!(await commit(manager.token, [w.update(S, { status: 'draft', updatedAt: NOW, updatedBy: staff.uid })])));
  assert.ok(!(await commit(staff.token, [w.update(S, { status: 'draft', updatedAt: NOW, updatedBy: staff.uid })])));
});

test('escala: id precisa ser um mês válido e campos estranhos são recusados', async () => {
  assert.ok(!(await commit(manager.token, [w.set(`${G}/schedules/2026-13`, schedule(manager))])));
  assert.ok(!(await commit(manager.token, [w.set(`${G}/schedules/outubro`, schedule(manager))])));
  assert.ok(!(await commit(manager.token, [w.set(S, schedule(manager, { extra: 1 }))])));
  assert.ok(!(await commit(manager.token, [w.set(S, schedule(manager, { status: 'final' }))])));
});

test('escala: rascunho só gestor, auxiliar e analista leem; publicada todos os membros', async () => {
  await admin([w.set(S, { ...schedule(manager), createdAt: new Date(), updatedAt: new Date() })]);
  assert.ok(await canRead(manager.token, S));
  assert.ok(await canRead(assistant.token, S));
  assert.ok(await canRead(analyst.token, S));
  assert.ok(!(await canRead(observer.token, S)));
  assert.ok(!(await canRead(staff.token, S)));
  assert.ok(!(await canRead(outsider.token, S)));
  await admin([w.update(S, { status: 'published' })]);
  assert.ok(await canRead(observer.token, S));
  assert.ok(await canRead(staff.token, S));
  assert.ok(!(await canRead(outsider.token, S)));
  // Mês sem escala: membro consegue perguntar (e recebe "não existe")
  assert.ok(await canRead(staff.token, `${G}/schedules/2026-11`));
});
