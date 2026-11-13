// Teste da Agenda Google no serviço de contas (worker/src/agenda.js): roda o Worker no Node,
// com o SQLite do Node no lugar do D1 e o Google (token, agendas e lotes) e o Firestore
// simulados. Não precisa de emulador.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../worker/src/index.js';
import { ESCOPO_AGENDA, lerLote } from '../worker/src/agenda.js';

const PROJETO = 'demo-agenda';
const ORIGEM = 'http://localhost:5000';

// ---------- D1 de mentira (prepare → bind → first/run/all, e batch numa transação) ----------
class D1Falso {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    for (const arquivo of ['0001_contas.sql', '0002_agenda.sql', '0003_push.sql']) {
      this.db.exec(readFileSync(new URL(`../worker/migrations/${arquivo}`, import.meta.url), 'utf8'));
    }
  }
  prepare(sql) {
    const comando = this.db.prepare(sql);
    const preparado = {
      valores: [],
      bind(...v) {
        preparado.valores = v;
        return preparado;
      },
      first: async () => comando.get(...preparado.valores) ?? null,
      run: async () => (comando.run(...preparado.valores), { success: true }),
      all: async () => ({ results: comando.all(...preparado.valores) }),
    };
    return preparado;
  }
  async batch(comandos) {
    this.db.exec('BEGIN');
    try {
      const resultados = [];
      for (const comando of comandos) resultados.push(await comando.run());
      this.db.exec('COMMIT');
      return resultados;
    } catch (erro) {
      this.db.exec('ROLLBACK');
      throw erro;
    }
  }
  linhas(sql, ...v) {
    return this.db.prepare(sql).all(...v);
  }
}

let D1;
let env;

// ---------- Google simulado ----------
const google = {
  agendas: new Map(), // id → Map(evento → corpo)
  tokensRevogados: new Set(),
  lotes: 0,
  proximaAgenda: 1,
};
let grupos = {}; // Firestore simulado: groups/{id}
let acessos = {}; // access/{uid}: cargo aprovado
let admins = []; // config/admins
let devs = []; // uids que as regras tratam como Dev (só eles leem config/dev)

function respostaJson(dados, status = 200) {
  return new Response(JSON.stringify(dados), { status, headers: { 'Content-Type': 'application/json' } });
}

function loteGoogle(corpo, tipo) {
  google.lotes += 1;
  const fronteira = /boundary=([^;]+)/.exec(tipo)[1];
  const partes = corpo.split(`--${fronteira}`).slice(1, -1);
  let resposta = '';
  for (const parte of partes) {
    const id = /Content-ID: <(.+?)>/.exec(parte)[1];
    const secoes = parte.split('\r\n\r\n');
    const [metodo, caminho] = secoes[1].split('\r\n')[0].split(' ');
    const json = secoes.slice(2).join('\r\n\r\n').trim();
    const [, agendaId, eventoId] = /\/calendars\/([^/]+)\/events(?:\/(.+))?$/.exec(caminho);
    const agenda = google.agendas.get(decodeURIComponent(agendaId));
    let status;
    if (!agenda) status = 404;
    else if (metodo === 'POST') {
      const evento = JSON.parse(json);
      status = agenda.has(evento.id) ? 409 : 200;
      if (status === 200) agenda.set(evento.id, evento);
    } else if (metodo === 'PUT') {
      status = agenda.has(eventoId) ? 200 : 404;
      if (status === 200) agenda.set(eventoId, JSON.parse(json));
    } else {
      status = agenda.delete(eventoId) ? 204 : 410;
    }
    resposta += `--resp\r\nContent-Type: application/http\r\nContent-ID: <response-${id}>\r\n\r\nHTTP/1.1 ${status} X\r\n\r\n{}\r\n`;
  }
  resposta += '--resp--\r\n';
  return new Response(resposta, { headers: { 'Content-Type': 'multipart/mixed; boundary=resp' } });
}

globalThis.fetch = async (url, opcoes = {}) => {
  const endereco = String(url);
  const corpo = opcoes.body instanceof URLSearchParams ? Object.fromEntries(opcoes.body) : opcoes.body;

  if (endereco.startsWith('http://firestore.falso/')) {
    const caminho = endereco.split('/documents/')[1];
    if (caminho === 'config/admins') return respostaJson({ fields: { uids: lista(admins) } });
    if (caminho === 'config/dev') {
      const token = String(opcoes.headers?.Authorization ?? '').replace('Bearer ', '');
      const uid = JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).sub;
      return new Response('{}', { status: devs.includes(uid) ? 404 : 403 });
    }
    if (caminho.startsWith('access/')) {
      const cargo = acessos[caminho.slice(7)];
      return cargo ? respostaJson({ fields: { categoryId: { stringValue: cargo }, approved: { booleanValue: true } } }) : new Response('{}', { status: 404 });
    }
    const id = caminho.split('groups/')[1];
    return grupos[id] ? respostaJson({ fields: grupos[id] }) : new Response('{}', { status: 404 });
  }
  if (endereco === 'https://oauth2.googleapis.com/token') {
    if (corpo.grant_type === 'authorization_code') {
      if (corpo.code === 'sem-escopo') return respostaJson({ access_token: 'acesso', refresh_token: 'r', scope: 'email', expires_in: 3600 });
      return respostaJson({ access_token: `acesso-${corpo.code}`, refresh_token: `renova-${corpo.code}`, scope: ESCOPO_AGENDA, expires_in: 3600 });
    }
    if (google.tokensRevogados.has(corpo.refresh_token)) return respostaJson({ error: 'invalid_grant' }, 400);
    return respostaJson({ access_token: `novo-${corpo.refresh_token}`, expires_in: 3600 });
  }
  if (endereco === 'https://oauth2.googleapis.com/revoke') {
    google.tokensRevogados.add(corpo.token);
    return new Response('', { status: 200 });
  }
  if (endereco === 'https://www.googleapis.com/calendar/v3/calendars' && opcoes.method === 'POST') {
    const id = `agenda${google.proximaAgenda++}@group.calendar.google.com`;
    google.agendas.set(id, new Map());
    return respostaJson({ id, summary: JSON.parse(corpo).summary });
  }
  if (endereco.startsWith('https://www.googleapis.com/calendar/v3/calendars/') && opcoes.method === 'DELETE') {
    google.agendas.delete(decodeURIComponent(endereco.split('/calendars/')[1]));
    return new Response(null, { status: 204 });
  }
  if (endereco === 'https://www.googleapis.com/batch/calendar/v3') return loteGoogle(corpo, opcoes.headers['Content-Type']);
  throw new Error(`fetch inesperado: ${endereco}`);
};

// ---------- Apoio ----------
// Token do Firebase sem assinatura (o Worker em modo EMULADOR só confere os dados)
function tokenDe(uid) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const agora = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'none' })}.${b64({ aud: PROJETO, iss: `https://securetoken.google.com/${PROJETO}`, sub: uid, exp: agora + 3600, auth_time: agora })}.`;
}

async function chamar(rota, corpo, uid) {
  const resposta = await worker.fetch(
    new Request(`https://escalamed-auth.test${rota}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGEM, Authorization: `Bearer ${tokenDe(uid)}` },
      body: JSON.stringify(corpo),
    }),
    env,
  );
  return { status: resposta.status, ...(await resposta.json()) };
}

const contaDe = (uid) => D1.linhas('SELECT * FROM agenda_contas WHERE uid = ?', uid)[0];
const eventosDe = (uid) => google.agendas.get(contaDe(uid)?.calendario) ?? new Map();

const lista = (valores) => ({ arrayValue: { values: valores.map((v) => ({ stringValue: v })) } });
function grupoFirestore({ coordenadores = [], membros }) {
  return {
    name: { stringValue: 'UTI Adulto' },
    type: { stringValue: 'team' },
    timezone: { stringValue: 'America/Fortaleza' },
    unit: { mapValue: { fields: { name: { stringValue: 'HAP' }, city: { stringValue: 'Fortaleza' }, state: { stringValue: 'CE' } } } },
    coordinatorIds: lista(coordenadores),
    memberIds: lista(membros),
  };
}

const TURNOS = {
  d: { titulo: 'Diurno', inicio: 420, fim: 1140 },
  n: { titulo: 'Noturno', inicio: 1140, fim: 420 },
};

const escala = (celulas, mes = '2026-11') => ({
  grupoId: 'g1',
  mes,
  nome: 'UTI Adulto',
  local: 'HAP, Fortaleza/CE',
  fuso: 'America/Fortaleza',
  turnos: TURNOS,
  celulas,
});

beforeEach(() => {
  D1 = new D1Falso();
  env = {
    PROJETO,
    ORIGENS: ORIGEM,
    DB: D1,
    EMULADOR: '1',
    EMULADOR_FIRESTORE: 'firestore.falso',
    GOOGLE_CLIENTE: 'cliente.apps.googleusercontent.com',
    GOOGLE_SEGREDO: 'segredo-de-teste',
    APP: 'https://escalamed.test',
  };
  google.agendas.clear();
  google.tokensRevogados.clear();
  google.lotes = 0;
  grupos = {};
  acessos = { gestor: 'gestor', coord: 'coordenador-escala', coordSemGrupo: 'coordenador-escala', adm: 'administrativo' };
  admins = [];
  devs = [];
});

// ---------- Testes ----------
test('sem conectar: estado desconectado e meus-plantoes não grava nada', async () => {
  assert.deepEqual(await chamar('/agenda/estado', {}, 'ana'), { status: 200, conectado: false });
  const r = await chamar('/agenda/meus-plantoes', { meses: ['2026-11'], escalas: [escala({ '01_d': ['ana'] })] }, 'ana');
  assert.equal(r.conectado, false);
  assert.equal(D1.linhas('SELECT * FROM agenda_desejados').length, 0);
});

test('conectar cria a agenda EscalaMed e guarda os tokens criptografados', async () => {
  const r = await chamar('/agenda/conectar', { codigo: 'c1', fuso: 'America/Fortaleza' }, 'ana');
  assert.equal(r.status, 200);
  assert.equal(r.conectado, true);
  assert.equal(r.lembrete, 60);
  const conta = contaDe('ana');
  assert.ok(google.agendas.has(conta.calendario));
  assert.equal(conta.fuso, 'America/Fortaleza');
  assert.ok(!conta.renovacao.includes('renova-c1'), 'token de renovação não fica em texto puro');
});

test('conectar sem a permissão da agenda é recusado', async () => {
  const r = await chamar('/agenda/conectar', { codigo: 'sem-escopo' }, 'ana');
  assert.equal(r.status, 400);
  assert.match(r.erro, /permissão/);
  assert.equal(contaDe('ana'), undefined);
});

test('meus plantões viram eventos com horário, fuso, local e lembrete; repetir não reenvia', async () => {
  await chamar('/agenda/conectar', { codigo: 'c1' }, 'ana');
  const celulas = { '07_d': ['ana'], '30_n': ['ana'], '08_d': ['bia'] }; // bia é ignorada
  const r = await chamar('/agenda/meus-plantoes', { meses: ['2026-11'], escalas: [escala(celulas)] }, 'ana');
  assert.equal(r.pendente, false);
  assert.ok(r.sincronizadoEm);

  const eventos = [...eventosDe('ana').values()];
  assert.equal(eventos.length, 2);
  const noturno = eventos.find((e) => e.summary === 'Plantão Noturno · UTI Adulto');
  assert.deepEqual(noturno.start, { dateTime: '2026-11-30T19:00:00', timeZone: 'America/Fortaleza' });
  assert.deepEqual(noturno.end, { dateTime: '2026-12-01T07:00:00', timeZone: 'America/Fortaleza' }); // vira o mês
  assert.equal(noturno.location, 'HAP, Fortaleza/CE');
  assert.deepEqual(noturno.reminders, { useDefault: false, overrides: [{ method: 'popup', minutes: 60 }] });
  assert.match(noturno.description, /19h00 às 07h00 \(12h\)/);
  assert.equal(noturno.source.url, 'https://escalamed.test/group.html?id=g1&dia=2026-11-30');

  const lotes = google.lotes;
  await chamar('/agenda/meus-plantoes', { meses: ['2026-11'], escalas: [escala(celulas)] }, 'ana');
  assert.equal(google.lotes, lotes, 'nada mudou: nenhum lote novo');
});

test('plantão que sai da escala sai da agenda; meses fora da lista ficam como estão', async () => {
  await chamar('/agenda/conectar', { codigo: 'c1' }, 'ana');
  await chamar(
    '/agenda/meus-plantoes',
    { meses: ['2026-11', '2026-12'], escalas: [escala({ '07_d': ['ana'], '08_d': ['ana'] }), escala({ '01_d': ['ana'] }, '2026-12')] },
    'ana',
  );
  assert.equal(eventosDe('ana').size, 3);
  // Novembro perdeu o dia 8; dezembro não veio na lista de meses (fica)
  await chamar('/agenda/meus-plantoes', { meses: ['2026-11'], escalas: [escala({ '07_d': ['ana'] })] }, 'ana');
  const titulos = [...eventosDe('ana').values()].map((e) => e.start.dateTime).sort();
  assert.deepEqual(titulos, ['2026-11-07T07:00:00', '2026-12-01T07:00:00']);
});

test('trocar o lembrete regrava os eventos; 0 = sem lembrete', async () => {
  await chamar('/agenda/conectar', { codigo: 'c1' }, 'ana');
  await chamar('/agenda/meus-plantoes', { meses: ['2026-11'], escalas: [escala({ '07_d': ['ana'] })] }, 'ana');
  const r = await chamar('/agenda/lembrete', { minutos: 0 }, 'ana');
  assert.equal(r.lembrete, 0);
  assert.deepEqual([...eventosDe('ana').values()][0].reminders.overrides, []);
  assert.equal((await chamar('/agenda/lembrete', { minutos: 45 }, 'ana')).status, 400);
});

test('escala do grupo: só Gestor/coordenador, só membros conectados; rascunho tira da agenda', async () => {
  grupos.g1 = grupoFirestore({ coordenadores: ['coord'], membros: ['coord', 'ana', 'bia', 'caio'] });
  await chamar('/agenda/conectar', { codigo: 'c1' }, 'ana');
  await chamar('/agenda/conectar', { codigo: 'c2' }, 'bia');
  await chamar('/agenda/conectar', { codigo: 'c3' }, 'intruso'); // conectado, mas fora do grupo
  const pedido = {
    grupoId: 'g1',
    mes: '2026-11',
    publicada: true,
    turnos: TURNOS,
    celulas: { '01_d': ['ana', 'caio'], '02_n': ['bia', 'intruso'] },
  };

  assert.equal((await chamar('/agenda/grupo', pedido, 'ana')).status, 403); // membro não pode
  assert.equal((await chamar('/agenda/grupo', pedido, 'adm')).status, 403); // Administrativo só vê
  assert.equal((await chamar('/agenda/grupo', pedido, 'coordSemGrupo')).status, 403); // coordena outro grupo
  const r = await chamar('/agenda/grupo', pedido, 'coord');
  assert.equal(r.status, 200);
  assert.deepEqual({ pessoas: r.pessoas, emDia: r.emDia }, { pessoas: 2, emDia: 2 });
  assert.equal(eventosDe('ana').size, 1);
  assert.equal(eventosDe('bia').size, 1);
  assert.equal(eventosDe('intruso').size, 0);
  // Nome, local e fuso vêm do Firestore
  assert.equal([...eventosDe('bia').values()][0].start.timeZone, 'America/Fortaleza');

  // Dev atualiza a agenda de qualquer grupo, mesmo sem estar nele
  devs = ['dev'];
  assert.equal((await chamar('/agenda/grupo', pedido, 'dev')).status, 200);

  // Escala volta para rascunho: some de todas as agendas
  const rascunho = await chamar('/agenda/grupo', { ...pedido, publicada: false }, 'gestor');
  assert.equal(rascunho.pessoas, 2);
  assert.equal(eventosDe('ana').size, 0);
  assert.equal(eventosDe('bia').size, 0);
});

test('muitos plantões: lotes de até 50 e o Cron termina o que não coube', async () => {
  const pessoas = Array.from({ length: 8 }, (_, i) => `p${i}`);
  grupos.g1 = grupoFirestore({ membros: ['gestor', ...pessoas] }); // Gestor: altera qualquer grupo
  for (const [i, uid] of pessoas.entries()) await chamar('/agenda/conectar', { codigo: `c${i}` }, uid);
  // Todo mundo em todos os dias, nos dois turnos: 60 eventos por pessoa
  const celulas = {};
  for (let dia = 1; dia <= 30; dia += 1) {
    celulas[`${String(dia).padStart(2, '0')}_d`] = pessoas;
    celulas[`${String(dia).padStart(2, '0')}_n`] = pessoas;
  }
  const r = await chamar('/agenda/grupo', { grupoId: 'g1', mes: '2026-11', publicada: true, turnos: TURNOS, celulas }, 'gestor');
  assert.equal(r.pessoas, 8);
  assert.ok(r.emDia < 8, 'não cabe tudo numa chamada');
  assert.ok(D1.linhas('SELECT uid FROM agenda_contas WHERE pendente = 1').length > 0);

  for (let i = 0; i < 10 && D1.linhas('SELECT uid FROM agenda_contas WHERE pendente = 1').length; i += 1) {
    const esperas = [];
    await worker.scheduled({}, env, { waitUntil: (p) => esperas.push(p) });
    await Promise.all(esperas);
  }
  assert.equal(D1.linhas('SELECT uid FROM agenda_contas WHERE pendente = 1').length, 0);
  for (const uid of pessoas) assert.equal(eventosDe(uid).size, 60, uid);
});

test('agenda apagada no Google: cria outra e manda os plantões de novo', async () => {
  await chamar('/agenda/conectar', { codigo: 'c1' }, 'ana');
  await chamar('/agenda/meus-plantoes', { meses: ['2026-11'], escalas: [escala({ '07_d': ['ana'] })] }, 'ana');
  const antiga = contaDe('ana').calendario;
  google.agendas.delete(antiga);
  await chamar('/agenda/meus-plantoes', { meses: ['2026-11'], escalas: [escala({ '07_d': ['ana'], '08_d': ['ana'] })] }, 'ana');
  assert.notEqual(contaDe('ana').calendario, antiga);
  assert.equal(eventosDe('ana').size, 2);
});

test('acesso tirado na conta Google: fica desconectada', async () => {
  await chamar('/agenda/conectar', { codigo: 'c1' }, 'ana');
  D1.db.prepare('UPDATE agenda_contas SET acesso_ate = 0').run(); // força renovar o token
  google.tokensRevogados.add('renova-c1');
  const r = await chamar('/agenda/meus-plantoes', { meses: ['2026-11'], escalas: [escala({ '07_d': ['ana'] })] }, 'ana');
  assert.equal(r.conectado, false);
  assert.equal(contaDe('ana'), undefined);
});

test('Dev apaga os dados: plantões saem de todas as agendas (o Cron termina), contas continuam', async () => {
  await chamar('/agenda/conectar', { codigo: 'c1' }, 'ana');
  await chamar('/agenda/conectar', { codigo: 'c2' }, 'bia');
  await chamar('/agenda/meus-plantoes', { meses: ['2026-11'], escalas: [escala({ '07_d': ['ana'] })] }, 'ana');
  await chamar('/agenda/meus-plantoes', { meses: ['2026-11'], escalas: [escala({ '08_d': ['bia'] })] }, 'bia');
  assert.equal(eventosDe('ana').size, 1);

  assert.equal((await chamar('/agenda/limpar-tudo', {}, 'gestor')).status, 403); // só Dev
  devs = ['dev'];
  const r = await chamar('/agenda/limpar-tudo', {}, 'dev');
  assert.equal(r.status, 200);
  assert.equal(r.pessoas, 2);
  assert.equal(D1.linhas('SELECT * FROM agenda_desejados').length, 0);

  const esperas = [];
  await worker.scheduled({}, env, { waitUntil: (p) => esperas.push(p) });
  await Promise.all(esperas);
  assert.equal(eventosDe('ana').size, 0);
  assert.equal(eventosDe('bia').size, 0);
  assert.ok(contaDe('ana'), 'continua conectada');
});

test('desconectar apaga a agenda do Google, revoga o acesso e limpa o banco', async () => {
  await chamar('/agenda/conectar', { codigo: 'c1' }, 'ana');
  await chamar('/agenda/meus-plantoes', { meses: ['2026-11'], escalas: [escala({ '07_d': ['ana'] })] }, 'ana');
  const agenda = contaDe('ana').calendario;
  const r = await chamar('/agenda/desconectar', {}, 'ana');
  assert.equal(r.conectado, false);
  assert.ok(!google.agendas.has(agenda));
  assert.ok(google.tokensRevogados.has('renova-c1'));
  for (const tabela of ['agenda_contas', 'agenda_desejados', 'agenda_enviados']) {
    assert.equal(D1.linhas(`SELECT * FROM ${tabela}`).length, 0, tabela);
  }
});

test('dados inválidos são recusados', async () => {
  await chamar('/agenda/conectar', { codigo: 'c1' }, 'ana');
  const ruim = (celulas) => chamar('/agenda/meus-plantoes', { meses: ['2026-11'], escalas: [escala(celulas)] }, 'ana');
  assert.equal((await ruim({ '7_d': ['ana'] })).status, 400);
  assert.equal((await ruim({ '07_d': 'ana' })).status, 400);
  assert.equal((await chamar('/agenda/meus-plantoes', { meses: ['novembro'] }, 'ana')).status, 400);
});

test('resposta do lote: status de cada operação, na ordem', () => {
  const texto = [
    '--b\r\nContent-ID: <response-op1>\r\n\r\nHTTP/1.1 404 Not Found\r\n\r\n{}',
    '--b\r\nContent-ID: <response-op0>\r\n\r\nHTTP/1.1 200 OK\r\n\r\n{}',
    '--b--',
  ].join('\r\n');
  assert.deepEqual(lerLote('multipart/mixed; boundary=b', texto, 3), [200, 404, 0]);
  assert.deepEqual(lerLote('multipart/mixed; boundary="b"', texto, 2), [200, 404]);
});
