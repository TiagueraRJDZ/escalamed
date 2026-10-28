// Teste completo do serviço de contas: roda o código do Worker no Node, com um D1
// de mentira (SQLite do Node), o emulador de Authentication do Firebase e uma
// leitura de grupo e de config/admins simulada (sem o emulador do Firestore, que usa Java).
// Uso:
//   firebase emulators:exec --only auth --config firebase.test.json --project demo-escalamed-test "node --no-warnings --test tests/worker/auth-service.test.mjs"
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../../worker/src/index.js';

const PROJETO = process.env.GCLOUD_PROJECT || 'demo-escalamed-test';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9199';
const ORIGEM = 'http://localhost:5000';
const AUTH_URL = `http://${AUTH}/identitytoolkit.googleapis.com/v1`;

// D1 de mentira: mesma interface (prepare → bind → first/run/all) sobre o SQLite do Node
class D1Falso {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.db.exec(readFileSync(new URL('../../worker/migrations/0001_contas.sql', import.meta.url), 'utf8'));
  }
  prepare(sql) {
    const comando = this.db.prepare(sql);
    let valores = [];
    return {
      bind(...v) {
        valores = v;
        return this;
      },
      first: async () => comando.get(...valores) ?? null,
      run: async () => (comando.run(...valores), { success: true }),
      all: async () => ({ results: comando.all(...valores) }),
    };
  }
}

const D1 = new D1Falso();
const env = { PROJETO, ORIGENS: ORIGEM, DB: D1, EMULADOR: '1', EMULADOR_AUTH: AUTH, EMULADOR_FIRESTORE: 'firestore.falso' };

// Grupo e administradores simulados: as leituras do Firestore feitas pelo Worker caem aqui
let grupo = null;
let admins = [];
const fetchReal = globalThis.fetch;
globalThis.fetch = async (url, opcoes) => {
  if (String(url).startsWith('http://firestore.falso/')) {
    const lista = (ids) => ({ arrayValue: { values: ids.map((id) => ({ stringValue: id })) } });
    if (String(url).endsWith('/documents/config/admins')) {
      return new Response(JSON.stringify({ fields: { uids: lista(admins) } }));
    }
    if (!grupo) return new Response('{}', { status: 404 });
    return new Response(
      JSON.stringify({
        fields: {
          type: { stringValue: 'team' },
          memberIds: lista(grupo.memberIds),
          managerIds: lista(grupo.managerIds),
          assistantIds: lista(grupo.assistantIds),
        },
      }),
    );
  }
  return fetchReal(url, opcoes);
};

async function chamar(rota, corpo, { token, origem = ORIGEM, ip } = {}) {
  const resposta = await worker.fetch(
    new Request(`https://escalamed-auth.test${rota}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origem,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(ip ? { 'CF-Connecting-IP': ip } : {}),
      },
      body: JSON.stringify(corpo),
    }),
    env,
  );
  return { status: resposta.status, ...(await resposta.json()) };
}

async function authCall(rota, corpo) {
  const resposta = await fetchReal(`${AUTH_URL}/${rota}?key=x`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...corpo, returnSecureToken: true }),
  });
  return resposta.json();
}

const claimsDe = (idToken) => JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString());

// O que o app faz: cadastro e login por e-mail direto no Firebase
const cadastrar = (email, password) => authCall('accounts:signUp', { email, password });
const entrarEmail = (email, password) => authCall('accounts:signInWithPassword', { email, password });

const SENHA = 'Plantao@2026';
let gestor;
let plantonista;

before(async () => {
  await fetchReal(`http://${AUTH}/emulator/v1/projects/${PROJETO}/accounts`, { method: 'DELETE' });
  gestor = await cadastrar('gestor@teste.com', SENHA);
  plantonista = await cadastrar('ana@teste.com', SENHA);
  grupo = {
    memberIds: [gestor.localId, plantonista.localId],
    managerIds: [gestor.localId],
    assistantIds: [],
  };
});

test('origem fora da lista é recusada', async () => {
  const r = await chamar('/entrar-usuario', { usuario: 'ana', senha: SENHA }, { origem: 'https://site-estranho.com' });
  assert.equal(r.status, 403);
});

test('nome de usuário: escolhe, entra com ele e cai no mesmo uid', async () => {
  assert.equal((await chamar('/trocar-usuario', { usuario: 'Ana Maria' }, { token: plantonista.idToken })).status, 400);
  const r = await chamar('/trocar-usuario', { usuario: 'Ana.Maria' }, { token: plantonista.idToken });
  assert.equal(r.status, 200, r.erro);
  assert.equal(r.usuario, 'ana.maria');

  const login = await chamar('/entrar-usuario', { usuario: 'ana.maria', senha: SENHA });
  assert.equal(login.status, 200, login.erro);
  const sessao = await authCall('accounts:signInWithCustomToken', { token: login.token });
  assert.equal(claimsDe(sessao.idToken).sub, plantonista.localId);
  // A resposta não revela o e-mail
  assert.ok(!JSON.stringify(login).includes('ana@teste.com'));
});

test('nome de usuário já usado por outra pessoa é recusado', async () => {
  const r = await chamar('/trocar-usuario', { usuario: 'ana.maria' }, { token: gestor.idToken });
  assert.equal(r.status, 409);
});

test('login por usuário: senha errada ou usuário inexistente recusam igual', async () => {
  const errada = await chamar('/entrar-usuario', { usuario: 'ana.maria', senha: 'Errada@2026' });
  const inexistente = await chamar('/entrar-usuario', { usuario: 'ninguem', senha: SENHA });
  assert.equal(errada.status, 401);
  assert.equal(inexistente.status, 401);
  assert.equal(errada.erro, inexistente.erro);
});

test('rota de logado sem token é recusada', async () => {
  assert.equal((await chamar('/trocar-usuario', { usuario: 'x.y.z' })).status, 401);
});

test('senha provisória: só gestor/auxiliar; marca e exige a troca', async () => {
  // Plantonista não gera
  const negada = await chamar('/senha-provisoria', { uid: gestor.localId, grupo: 'g1' }, { token: plantonista.idToken });
  assert.equal(negada.status, 403);

  const r = await chamar('/senha-provisoria', { uid: plantonista.localId, grupo: 'g1' }, { token: gestor.idToken });
  assert.equal(r.status, 200, r.erro);

  // A senha antiga não vale mais; a provisória entra, com a marca trocarSenha
  assert.ok((await entrarEmail('ana@teste.com', SENHA)).error);
  const provisoria = await entrarEmail('ana@teste.com', r.senha);
  assert.equal(claimsDe(provisoria.idToken).trocarSenha, true);

  // Tirar a marca sem trocar a senha: recusado
  const cedo = await chamar('/senha-definida', {}, { token: provisoria.idToken });
  assert.equal(cedo.status, 400);

  // Troca a senha (o app usa updatePassword) e tira a marca
  await new Promise((resolve) => setTimeout(resolve, 5)); // garante horário depois da provisória
  await authCall('accounts:update', { idToken: provisoria.idToken, password: 'Nova@2026x' });
  const nova = await entrarEmail('ana@teste.com', 'Nova@2026x');
  const ok = await chamar('/senha-definida', {}, { token: nova.idToken });
  assert.equal(ok.status, 200, ok.erro);
  const depois = await entrarEmail('ana@teste.com', 'Nova@2026x');
  assert.equal(claimsDe(depois.idToken).trocarSenha, undefined);
});

test('trocar e-mail sem link: o login passa a ser pelo e-mail novo', async () => {
  const sessao = await entrarEmail('ana@teste.com', 'Nova@2026x');
  const ocupado = await chamar('/trocar-email', { novoEmail: 'gestor@teste.com' }, { token: sessao.idToken });
  assert.equal(ocupado.status, 409);

  const r = await chamar('/trocar-email', { novoEmail: 'Ana.Nova@teste.com' }, { token: sessao.idToken });
  assert.equal(r.status, 200, r.erro);
  assert.ok((await entrarEmail('ana@teste.com', 'Nova@2026x')).error);
  const nova = await entrarEmail('ana.nova@teste.com', 'Nova@2026x');
  assert.equal(claimsDe(nova.idToken).email, 'ana.nova@teste.com');
  // O login por usuário continua funcionando (o D1 guarda o uid, não o e-mail)
  assert.equal((await chamar('/entrar-usuario', { usuario: 'ana.maria', senha: 'Nova@2026x' })).status, 200);
});

test('limite por IP: muitos logins por usuário no mesmo minuto', async () => {
  let ultimo;
  for (let i = 0; i < 11; i++) {
    ultimo = await chamar('/entrar-usuario', { usuario: 'ninguem', senha: 'Errada@1' }, { ip: '10.0.0.9' });
  }
  assert.equal(ultimo.status, 429);
});

test('histórico registra senha provisória (com quem gerou), e-mail e usuário', () => {
  const eventos = D1.db.prepare('SELECT tipo, por_uid FROM eventos ORDER BY id').all();
  const tipos = eventos.map((e) => e.tipo);
  assert.ok(tipos.includes('usuario') && tipos.includes('senha-provisoria') && tipos.includes('email'));
  assert.equal(eventos.find((e) => e.tipo === 'senha-provisoria').por_uid, gestor.localId);
});

// ---------- Administrador da plataforma ----------
test('rotas de administrador: só quem está em config/admins', async () => {
  admins = [];
  const negada = await chamar('/admin/contas', {}, { token: gestor.idToken });
  assert.equal(negada.status, 403);
});

test('administrador lista as contas, com usuário e sem a própria senha', async () => {
  admins = [gestor.localId];
  const r = await chamar('/admin/contas', {}, { token: gestor.idToken });
  assert.equal(r.status, 200, r.erro);
  const ana = r.contas.find((c) => c.uid === plantonista.localId);
  assert.equal(ana.email, 'ana.nova@teste.com');
  assert.equal(ana.usuario, 'ana.maria');
  assert.equal(ana.inativa, false);
  assert.ok(!JSON.stringify(r).includes('passwordHash'));
});

test('administrador gera senha provisória sem grupo; nunca para si', async () => {
  admins = [gestor.localId];
  const propria = await chamar('/admin/senha-provisoria', { uid: gestor.localId }, { token: gestor.idToken });
  assert.equal(propria.status, 400);
  const r = await chamar('/admin/senha-provisoria', { uid: plantonista.localId }, { token: gestor.idToken });
  assert.equal(r.status, 200, r.erro);
  const sessao = await entrarEmail('ana.nova@teste.com', r.senha);
  assert.equal(claimsDe(sessao.idToken).trocarSenha, true);
});

test('inativar barra o login (e-mail e usuário); reativar libera', async () => {
  admins = [gestor.localId];
  const off = await chamar('/admin/acesso', { uid: plantonista.localId, ativo: false }, { token: gestor.idToken });
  assert.equal(off.status, 200, off.erro);
  const provisoria = await chamar('/admin/senha-provisoria', { uid: plantonista.localId }, { token: gestor.idToken });
  assert.match((await entrarEmail('ana.nova@teste.com', provisoria.senha)).error.message, /USER_DISABLED/);
  assert.equal((await chamar('/entrar-usuario', { usuario: 'ana.maria', senha: provisoria.senha })).status, 401);
  const lista = await chamar('/admin/contas', {}, { token: gestor.idToken });
  assert.equal(lista.contas.find((c) => c.uid === plantonista.localId).inativa, true);

  const on = await chamar('/admin/acesso', { uid: plantonista.localId, ativo: true }, { token: gestor.idToken });
  assert.equal(on.status, 200, on.erro);
  assert.ok((await entrarEmail('ana.nova@teste.com', provisoria.senha)).idToken);
});

test('excluir apaga o login e libera o nome de usuário', async () => {
  admins = [gestor.localId];
  assert.equal((await chamar('/admin/excluir', { uid: gestor.localId }, { token: gestor.idToken })).status, 400);
  const r = await chamar('/admin/excluir', { uid: plantonista.localId }, { token: gestor.idToken });
  assert.equal(r.status, 200, r.erro);
  const lista = await chamar('/admin/contas', {}, { token: gestor.idToken });
  assert.ok(!lista.contas.some((c) => c.uid === plantonista.localId));
  assert.equal(D1.db.prepare('SELECT COUNT(*) AS n FROM usuarios WHERE uid = ?').get(plantonista.localId).n, 0);
  const eventos = D1.db.prepare('SELECT tipo FROM eventos').all().map((e) => e.tipo);
  assert.ok(['inativar', 'reativar', 'excluir'].every((t) => eventos.includes(t)));
});
