// Testes das regras do Firestore (cargos, convites, perfis).
// Rodam em emuladores próprios (portas 8180 e 9199, firebase.test.json), então
// podem rodar com os emuladores de desenvolvimento ligados. Na pasta do projeto:
//   firebase emulators:exec --config firebase.test.json --project demo-escalamed-test "node --test tests/rules/rules.test.mjs"
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { w, NOW, commit, admin, canRead, canQueryGroup, clearFirestore, clearAuth, createUser } from './emulator.mjs';

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
test('membros leem o grupo; estranhos e e-mail não confirmado não', async () => {
  assert.ok(await canRead(staff.token, G));
  assert.ok(await canRead(observer.token, `${G}/members/${manager.uid}`));
  assert.ok(!(await canRead(outsider.token, G)));
  assert.ok(!(await canRead(outsider.token, `${G}/members/${manager.uid}`)));

  await admin([w.update(G, { memberIds: [...baseGroup().memberIds, unverified.uid] })]);
  assert.ok(!(await canRead(unverified.token, G)));
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
test('criar grupo: dono vira gestor; e-mail não confirmado não cria', async () => {
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
  assert.ok(!(await create(unverified, 'groups/novo2')));
});

test('perfil: cadastro sem e-mail confirmado funciona; profissão inválida não', async () => {
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
