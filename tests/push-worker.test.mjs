// Teste das notificações push no serviço de contas (worker/src/push.js): roda o Worker no Node,
// com o SQLite do Node no lugar do D1, o Firestore, o Authentication e os serviços de push
// simulados. O "aparelho" de mentira tem chaves de verdade: o teste abre a mensagem cifrada
// (RFC 8291) e confere a assinatura VAPID (RFC 8292). Não precisa de emulador.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../worker/src/index.js';
import { criptografar, deBase64Url, paraBase64Url } from '../worker/src/push.js';

const PROJETO = 'demo-push';
const ORIGEM = 'http://localhost:5000';
const { subtle } = globalThis.crypto;

// ---------- D1 de mentira ----------
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
      for (const comando of comandos) await comando.run();
      this.db.exec('COMMIT');
    } catch (erro) {
      this.db.exec('ROLLBACK');
      throw erro;
    }
  }
  linhas(sql, ...v) {
    return this.db.prepare(sql).all(...v);
  }
}

// ---------- Chaves VAPID do servidor (geradas para o teste) ----------
const parVapid = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const VAPID_PUBLICA = paraBase64Url(await subtle.exportKey('raw', parVapid.publicKey));
const VAPID_PRIVADA = (await subtle.exportKey('jwk', parVapid.privateKey)).d;

// ---------- Aparelho de mentira: chaves reais e a caixa de entrada dele ----------
async function novoAparelho(nome) {
  const par = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const endpoint = `https://fcm.googleapis.com/fcm/send/${nome}`;
  return {
    endpoint,
    par,
    auth,
    inscricao: {
      endpoint,
      keys: { p256dh: paraBase64Url(await subtle.exportKey('raw', par.publicKey)), auth: paraBase64Url(auth) },
    },
  };
}

async function hmac(chave, dados) {
  const k = await subtle.importKey('raw', chave, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle.sign('HMAC', k, dados));
}
const junta = (...p) => Uint8Array.from(p.flatMap((x) => [...x]));
const txt = (s) => new TextEncoder().encode(s);

// Abre a mensagem como o navegador abriria (RFC 8291)
async function abrir(aparelho, corpo) {
  const sal = corpo.slice(0, 16);
  const tamanhoChave = corpo[20];
  const publicaServidor = corpo.slice(21, 21 + tamanhoChave);
  const cifrado = corpo.slice(21 + tamanhoChave);
  const publicaAparelho = new Uint8Array(await subtle.exportKey('raw', aparelho.par.publicKey));
  const chaveServidor = await subtle.importKey('raw', publicaServidor, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const compartilhado = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: chaveServidor }, aparelho.par.privateKey, 256));
  const prkChave = await hmac(aparelho.auth, compartilhado);
  const ikm = await hmac(prkChave, junta(txt('WebPush: info\0'), publicaAparelho, publicaServidor, [1]));
  const prk = await hmac(sal, ikm);
  const cek = (await hmac(prk, junta(txt('Content-Encoding: aes128gcm\0'), [1]))).slice(0, 16);
  const nonce = (await hmac(prk, junta(txt('Content-Encoding: nonce\0'), [1]))).slice(0, 12);
  const aes = await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const claro = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aes, cifrado));
  assert.equal(claro.at(-1), 2, 'último registro termina com 0x02');
  return JSON.parse(new TextDecoder().decode(claro.slice(0, -1)));
}

// Confere o cabeçalho "vapid t=<jwt>, k=<chave>"
async function conferirVapid(cabecalho, endpoint) {
  const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(cabecalho);
  assert.equal(k, VAPID_PUBLICA);
  const [h, p, s] = jwt.split('.');
  const dados = JSON.parse(Buffer.from(p, 'base64url'));
  assert.equal(dados.aud, new URL(endpoint).origin);
  assert.equal(dados.sub, 'https://escalamed.test');
  assert.ok(dados.exp > Date.now() / 1000 && dados.exp <= Date.now() / 1000 + 24 * 3600);
  const chave = await subtle.importKey('raw', deBase64Url(VAPID_PUBLICA), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.ok(await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, chave, Buffer.from(s, 'base64url'), txt(`${h}.${p}`)));
}

// ---------- Firestore, Authentication e serviço de push simulados ----------
let D1;
let env;
let convites; // 'grupo/chave' → campos (como o REST do Firestore devolve)
let leitores; // 'grupo/chave' → uids que as regras deixam ler
let contasPorEmail; // e-mail → uid
let entregues; // [{ endpoint, corpo, headers }]
let respostaDoServico; // endpoint → status

globalThis.fetch = async (url, opcoes = {}) => {
  const endereco = String(url);
  if (endereco.startsWith('http://firestore.falso/')) {
    const caminho = decodeURIComponent(endereco.split('/documents/')[1]);
    const uid = JSON.parse(Buffer.from(String(opcoes.headers.Authorization).split('.')[1], 'base64url')).sub;
    // Dev: as regras só deixam o Dev ler config/dev (404 = Dev, 403 = não é)
    if (caminho === 'config/dev') return new Response('{}', { status: uid === 'dev' ? 404 : 403 });
    const [, grupo, , chave] = caminho.split('/');
    // Documento do grupo ("groups/g1") fica no mapa pelo caminho inteiro
    const id = chave === undefined ? caminho : `${grupo}/${chave}`;
    if (!convites[id]) return new Response('{}', { status: 404 });
    if (!leitores[id]?.includes(uid)) return new Response('{}', { status: 403 });
    return new Response(JSON.stringify({ fields: convites[id] }), { status: 200 });
  }
  if (endereco.includes('/accounts:lookup')) {
    const { email } = JSON.parse(opcoes.body);
    const uid = contasPorEmail[email[0]];
    return new Response(JSON.stringify(uid ? { users: [{ localId: uid, email: email[0] }] } : {}), { status: 200 });
  }
  if (endereco.startsWith('https://fcm.googleapis.com/')) {
    entregues.push({ endpoint: endereco, corpo: new Uint8Array(opcoes.body), headers: opcoes.headers });
    return new Response('', { status: respostaDoServico[endereco] ?? 201 });
  }
  throw new Error(`fetch inesperado: ${endereco}`);
};

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

const texto = (v) => ({ stringValue: v });
const momento = (msAtras = 0) => ({ timestampValue: new Date(Date.now() - msAtras).toISOString() });

function conviteFirestore({ uid, email, invitedBy = 'gestora', criadoHa = 0, recusado = false, recusadoHa = 0, aceito = false }) {
  return {
    ...(uid ? { uid: texto(uid), name: texto('Bruno') } : { email: texto(email) }),
    groupName: texto('UTI Adulto'),
    unitName: texto('Hospital Central'),
    invitedBy: texto(invitedBy),
    invitedByName: texto('Ana Gestora'),
    createdAt: momento(criadoHa),
    ...(recusado ? { status: texto('declined'), respondedAt: momento(recusadoHa), respondedByName: texto('Bruno Plantonista') } : {}),
    ...(aceito ? { status: texto('accepted'), respondedAt: momento(), respondedByName: texto('Bruno Plantonista') } : {}),
  };
}

beforeEach(() => {
  D1 = new D1Falso();
  env = {
    PROJETO,
    ORIGENS: ORIGEM,
    DB: D1,
    EMULADOR: '1',
    EMULADOR_FIRESTORE: 'firestore.falso',
    EMULADOR_AUTH: 'auth.falso',
    APP: 'https://escalamed.test',
    VAPID_PUBLICA,
    VAPID_PRIVADA,
  };
  convites = {};
  leitores = {};
  contasPorEmail = {};
  entregues = [];
  respostaDoServico = {};
});

// ---------- Criptografia ----------
test('a mensagem cifrada abre no aparelho (RFC 8291)', async () => {
  const aparelho = await novoAparelho('a1');
  const mensagem = { titulo: 'Olá', corpo: 'Plantão às 19h — açúcar' };
  const corpo = await criptografar(JSON.stringify(mensagem), aparelho.inscricao.keys.p256dh, aparelho.inscricao.keys.auth);
  assert.equal(new DataView(corpo.buffer).getUint32(16), 4096);
  assert.deepEqual(await abrir(aparelho, corpo), mensagem);
});

// ---------- Inscrição ----------
test('inscrever, conferir o estado e cancelar', async () => {
  const aparelho = await novoAparelho('a1');
  assert.equal((await chamar('/push/inscrever', { inscricao: aparelho.inscricao, aparelho: 'Android · Chrome' }, 'bruno')).status, 200);
  assert.equal((await chamar('/push/estado', { endpoint: aparelho.endpoint }, 'bruno')).inscrito, true);
  // Outra conta não vê a inscrição como dela e não consegue cancelar a do Bruno
  assert.equal((await chamar('/push/estado', { endpoint: aparelho.endpoint }, 'ana')).inscrito, false);
  await chamar('/push/cancelar', { endpoint: aparelho.endpoint }, 'ana');
  assert.equal(D1.linhas('SELECT * FROM push_inscricoes').length, 1);
  await chamar('/push/cancelar', { endpoint: aparelho.endpoint }, 'bruno');
  assert.equal(D1.linhas('SELECT * FROM push_inscricoes').length, 0);
});

test('o mesmo aparelho com outra conta passa a ser só da conta nova', async () => {
  const aparelho = await novoAparelho('a1');
  await chamar('/push/inscrever', { inscricao: aparelho.inscricao }, 'bruno');
  await chamar('/push/inscrever', { inscricao: aparelho.inscricao }, 'ana');
  assert.deepEqual(D1.linhas('SELECT uid FROM push_inscricoes').map((l) => l.uid), ['ana']);
});

test('recusa inscrição de serviço desconhecido ou com chaves inválidas', async () => {
  const aparelho = await novoAparelho('a1');
  const fora = { ...aparelho.inscricao, endpoint: 'https://exemplo.com/push/1' };
  assert.equal((await chamar('/push/inscrever', { inscricao: fora }, 'bruno')).status, 400);
  const semHttps = { ...aparelho.inscricao, endpoint: 'http://fcm.googleapis.com/fcm/send/x' };
  assert.equal((await chamar('/push/inscrever', { inscricao: semHttps }, 'bruno')).status, 400);
  const chaveRuim = { ...aparelho.inscricao, keys: { p256dh: 'abc', auth: aparelho.inscricao.keys.auth } };
  assert.equal((await chamar('/push/inscrever', { inscricao: chaveRuim }, 'bruno')).status, 400);
  // Apple e Microsoft são aceitas
  for (const endpoint of ['https://web.push.apple.com/QAbc', 'https://wns2-bl2p.notify.windows.com/w/?token=1']) {
    assert.equal((await chamar('/push/inscrever', { inscricao: { ...aparelho.inscricao, endpoint } }, 'bruno')).status, 200);
  }
});

test('guarda no máximo 10 aparelhos por conta (sai o mais antigo)', async () => {
  for (let i = 0; i < 12; i += 1) {
    await chamar('/push/inscrever', { inscricao: (await novoAparelho(`a${i}`)).inscricao }, 'bruno');
    D1.db.prepare('UPDATE push_inscricoes SET usado_em = ? WHERE endpoint = ?').run(i, `https://fcm.googleapis.com/fcm/send/a${i}`);
  }
  const endpoints = D1.linhas('SELECT endpoint FROM push_inscricoes').map((l) => l.endpoint.split('/').pop());
  assert.equal(endpoints.length, 10);
  assert.ok(!endpoints.includes('a0'));
});

// ---------- Envio ----------
test('teste: chega cifrado e assinado em todos os aparelhos da conta', async () => {
  const celular = await novoAparelho('celular');
  const tablet = await novoAparelho('tablet');
  await chamar('/push/inscrever', { inscricao: celular.inscricao }, 'bruno');
  await chamar('/push/inscrever', { inscricao: tablet.inscricao }, 'bruno');
  const resposta = await chamar('/push/teste', {}, 'bruno');
  assert.equal(resposta.enviados, 2);
  for (const entrega of entregues) {
    assert.equal(entrega.headers['Content-Encoding'], 'aes128gcm');
    assert.equal(entrega.headers.Urgency, 'high');
    await conferirVapid(entrega.headers.Authorization, entrega.endpoint);
    const aparelho = entrega.endpoint.endsWith('celular') ? celular : tablet;
    assert.equal((await abrir(aparelho, entrega.corpo)).titulo, 'Notificações ativadas');
  }
});

test('teste sem aparelho inscrito avisa', async () => {
  assert.equal((await chamar('/push/teste', {}, 'bruno')).status, 404);
});

test('aparelho que saiu do serviço (410) é esquecido; erro passageiro mantém', async () => {
  const velho = await novoAparelho('velho');
  const lento = await novoAparelho('lento');
  await chamar('/push/inscrever', { inscricao: velho.inscricao }, 'bruno');
  await chamar('/push/inscrever', { inscricao: lento.inscricao }, 'bruno');
  respostaDoServico[velho.endpoint] = 410;
  respostaDoServico[lento.endpoint] = 503;
  await chamar('/push/teste', {}, 'bruno');
  assert.deepEqual(D1.linhas('SELECT endpoint FROM push_inscricoes').map((l) => l.endpoint), [lento.endpoint]);
});

// ---------- Avisos do sininho ----------
test('convite para pessoa: o convidado recebe, uma vez só', async () => {
  const aparelho = await novoAparelho('bruno');
  await chamar('/push/inscrever', { inscricao: aparelho.inscricao }, 'bruno');
  convites['g1/bruno'] = conviteFirestore({ uid: 'bruno' });
  leitores['g1/bruno'] = ['gestora', 'bruno'];

  const resposta = await chamar('/push/avisar', { tipo: 'convite', grupo: 'g1', chave: 'bruno' }, 'gestora');
  assert.equal(resposta.enviados, 1);
  const mensagem = await abrir(aparelho, entregues[0].corpo);
  assert.equal(mensagem.titulo, 'Convite para UTI Adulto');
  assert.match(mensagem.corpo, /^Ana Gestora convidou você para o grupo · Hospital Central\./);
  assert.equal(mensagem.url, '/invite.html?g=g1');

  // Pedido repetido não manda de novo
  assert.equal((await chamar('/push/avisar', { tipo: 'convite', grupo: 'g1', chave: 'bruno' }, 'gestora')).enviados, 0);
  assert.equal(entregues.length, 1);
});

test('convite por e-mail chega a quem já tem conta com esse e-mail', async () => {
  const aparelho = await novoAparelho('otavio');
  await chamar('/push/inscrever', { inscricao: aparelho.inscricao }, 'otavio');
  contasPorEmail['novo@teste.com'] = 'otavio';
  convites['g1/novo@teste.com'] = conviteFirestore({ email: 'novo@teste.com' });
  leitores['g1/novo@teste.com'] = ['gestora'];
  assert.equal((await chamar('/push/avisar', { tipo: 'convite', grupo: 'g1', chave: 'novo@teste.com' }, 'gestora')).enviados, 1);

  // E-mail sem conta: nada a enviar (sem erro)
  convites['g1/fora@teste.com'] = conviteFirestore({ email: 'fora@teste.com' });
  leitores['g1/fora@teste.com'] = ['gestora'];
  assert.equal((await chamar('/push/avisar', { tipo: 'convite', grupo: 'g1', chave: 'fora@teste.com' }, 'gestora')).enviados, 0);
});

test('não dá para disparar convite falso', async () => {
  const aparelho = await novoAparelho('bruno');
  await chamar('/push/inscrever', { inscricao: aparelho.inscricao }, 'bruno');
  convites['g1/bruno'] = conviteFirestore({ uid: 'bruno' });
  leitores['g1/bruno'] = ['gestora', 'bruno', 'intruso'];
  // Quem pediu não é quem convidou
  assert.equal((await chamar('/push/avisar', { tipo: 'convite', grupo: 'g1', chave: 'bruno' }, 'intruso')).enviados, 0);
  // Convite que não existe / que as regras não deixam ler
  assert.equal((await chamar('/push/avisar', { tipo: 'convite', grupo: 'g1', chave: 'outro' }, 'gestora')).status, 404);
  leitores['g1/bruno'] = ['bruno'];
  assert.equal((await chamar('/push/avisar', { tipo: 'convite', grupo: 'g1', chave: 'bruno' }, 'gestora')).status, 404);
  // Convite antigo (mais de 10 minutos)
  convites['g1/bruno'] = conviteFirestore({ uid: 'bruno', criadoHa: 11 * 60 * 1000 });
  leitores['g1/bruno'] = ['gestora'];
  assert.equal((await chamar('/push/avisar', { tipo: 'convite', grupo: 'g1', chave: 'bruno' }, 'gestora')).status, 400);
  // Tipo desconhecido e caminho com barra
  assert.equal((await chamar('/push/avisar', { tipo: 'outro', grupo: 'g1', chave: 'bruno' }, 'gestora')).status, 400);
  assert.equal((await chamar('/push/avisar', { tipo: 'convite', grupo: 'g1/x', chave: 'bruno' }, 'gestora')).status, 400);
  assert.equal(entregues.length, 0);
});

test('recusa: quem convidou recebe', async () => {
  const aparelho = await novoAparelho('gestora');
  await chamar('/push/inscrever', { inscricao: aparelho.inscricao }, 'gestora');
  convites['g1/bruno'] = conviteFirestore({ uid: 'bruno', criadoHa: 60 * 60 * 1000, recusado: true });
  leitores['g1/bruno'] = ['gestora', 'bruno'];
  assert.equal((await chamar('/push/avisar', { tipo: 'recusa', grupo: 'g1', chave: 'bruno' }, 'bruno')).enviados, 1);
  const mensagem = await abrir(aparelho, entregues[0].corpo);
  assert.equal(mensagem.titulo, 'Convite recusado');
  assert.equal(mensagem.corpo, 'Bruno Plantonista recusou o convite para UTI Adulto.');
  assert.equal(mensagem.url, '/group.html?id=g1#membros');

  // Convite ainda pendente: não é recusa
  convites['g1/carla'] = conviteFirestore({ uid: 'carla' });
  leitores['g1/carla'] = ['carla'];
  assert.equal((await chamar('/push/avisar', { tipo: 'recusa', grupo: 'g1', chave: 'carla' }, 'carla')).enviados, 0);
});

test('aceite: quem convidou recebe; convite pendente ou recusado não vira aceite', async () => {
  const aparelho = await novoAparelho('gestora');
  await chamar('/push/inscrever', { inscricao: aparelho.inscricao }, 'gestora');
  convites['g1/bruno'] = conviteFirestore({ uid: 'bruno', criadoHa: 60 * 60 * 1000, aceito: true });
  leitores['g1/bruno'] = ['gestora', 'bruno'];
  assert.equal((await chamar('/push/avisar', { tipo: 'aceite', grupo: 'g1', chave: 'bruno' }, 'bruno')).enviados, 1);
  const mensagem = await abrir(aparelho, entregues[0].corpo);
  assert.equal(mensagem.titulo, 'Convite aceito');
  assert.equal(mensagem.corpo, 'Bruno Plantonista aceitou o convite para UTI Adulto.');
  assert.equal(mensagem.url, '/group.html?id=g1#membros');
  // Pedido repetido não manda de novo
  assert.equal((await chamar('/push/avisar', { tipo: 'aceite', grupo: 'g1', chave: 'bruno' }, 'bruno')).enviados, 0);

  convites['g1/carla'] = conviteFirestore({ uid: 'carla' });
  leitores['g1/carla'] = ['carla'];
  assert.equal((await chamar('/push/avisar', { tipo: 'aceite', grupo: 'g1', chave: 'carla' }, 'carla')).enviados, 0);
  convites['g1/dani'] = conviteFirestore({ uid: 'dani', recusado: true });
  leitores['g1/dani'] = ['dani'];
  assert.equal((await chamar('/push/avisar', { tipo: 'aceite', grupo: 'g1', chave: 'dani' }, 'dani')).enviados, 0);
  // Convite já aceito não é reenviado como convite novo
  leitores['g1/bruno'] = ['gestora'];
  assert.equal((await chamar('/push/avisar', { tipo: 'convite', grupo: 'g1', chave: 'bruno' }, 'gestora')).enviados, 0);
  assert.equal(entregues.length, 1);
});

test('cargo alterado: a pessoa recebe; só quem alterou consegue pedir', async () => {
  const aparelho = await novoAparelho('bruno');
  await chamar('/push/inscrever', { inscricao: aparelho.inscricao }, 'bruno');
  // users/bruno/notices/a1 (o mapa usa "uid/aviso")
  convites['bruno/a1'] = {
    type: texto('role'),
    categoryId: texto('administrativo'),
    categoryName: texto('Administrativo'),
    by: texto('gestora'),
    byName: texto('Ana Gestora'),
    createdAt: momento(),
  };
  leitores['bruno/a1'] = ['bruno', 'gestora', 'intruso'];
  // Quem pede não é quem alterou
  assert.equal((await chamar('/push/avisar', { tipo: 'cargo', grupo: 'bruno', chave: 'a1' }, 'intruso')).enviados, 0);
  assert.equal((await chamar('/push/avisar', { tipo: 'cargo', grupo: 'bruno', chave: 'a1' }, 'gestora')).enviados, 1);
  const mensagem = await abrir(aparelho, entregues[0].corpo);
  assert.equal(mensagem.titulo, 'Seu cargo foi alterado');
  assert.equal(mensagem.corpo, 'Ana Gestora alterou seu cargo para Administrativo.');
  assert.equal(mensagem.url, '/settings.html#profissional');
  // Uma vez só; aviso que não existe
  assert.equal((await chamar('/push/avisar', { tipo: 'cargo', grupo: 'bruno', chave: 'a1' }, 'gestora')).enviados, 0);
  assert.equal((await chamar('/push/avisar', { tipo: 'cargo', grupo: 'bruno', chave: 'a2' }, 'gestora')).status, 404);
  assert.equal(entregues.length, 1);
});

// ---------- Pedidos de plantão vago ----------
function pedidoFirestore({ status = 'pending', criadoHa = 0, decidedBy, reason } = {}) {
  return {
    uid: texto('bruno'),
    name: texto('Bruno Plantonista'),
    groupName: texto('UTI Adulto'),
    month: texto('2026-11'),
    cell: texto('07_n'),
    shiftId: texto('n'),
    shiftTitle: texto('Noturno'),
    shiftDate: texto('2026-11-07'),
    shiftStart: texto('19:00'),
    shiftEnd: texto('01:00'),
    status: texto(status),
    createdAt: momento(criadoHa),
    ...(decidedBy ? { decidedBy: texto(decidedBy), decidedByName: texto('Carla Coordenadora'), decidedAt: momento() } : {}),
    ...(reason ? { reason: texto(reason) } : {}),
  };
}

const lista = (...uids) => ({ arrayValue: { values: uids.map(texto) } });

test('pedido de plantão vago: os coordenadores do grupo recebem; só quem pediu consegue avisar', async () => {
  const carla = await novoAparelho('carla');
  const davi = await novoAparelho('davi');
  const ana = await novoAparelho('ana');
  await chamar('/push/inscrever', { inscricao: carla.inscricao }, 'carla');
  await chamar('/push/inscrever', { inscricao: davi.inscricao }, 'davi');
  await chamar('/push/inscrever', { inscricao: ana.inscricao }, 'ana');
  convites['g1/2026-11_07_n_bruno'] = pedidoFirestore();
  leitores['g1/2026-11_07_n_bruno'] = ['bruno', 'carla', 'intruso'];
  convites['groups/g1'] = { ownerId: texto('ana'), coordinatorIds: lista('carla', 'davi') };
  leitores['groups/g1'] = ['bruno', 'carla', 'intruso'];
  const avisar = (uid) => chamar('/push/avisar', { tipo: 'vaga-pedido', grupo: 'g1', chave: '2026-11_07_n_bruno' }, uid);
  assert.equal((await avisar('intruso')).enviados, 0); // não foi quem pediu
  assert.equal((await avisar('bruno')).enviados, 2); // os dois coordenadores (a Gestora, não)
  const mensagem = await abrir(carla, entregues[0].corpo);
  assert.equal(mensagem.titulo, 'Pedido de plantão vago');
  assert.equal(mensagem.corpo, 'Bruno Plantonista pediu o plantão Noturno de 07/11 (19h00 às 01h00) em UTI Adulto. Toque para aceitar ou recusar.');
  assert.equal(mensagem.url, '/group.html?id=g1&dia=2026-11-07');
  assert.equal((await avisar('bruno')).enviados, 0); // uma vez só
  assert.equal(entregues.length, 2);
});

test('pedido de plantão vago: grupo sem coordenador avisa o Gestor que criou; pedido antigo não', async () => {
  const ana = await novoAparelho('ana');
  await chamar('/push/inscrever', { inscricao: ana.inscricao }, 'ana');
  convites['g1/2026-11_07_n_bruno'] = pedidoFirestore();
  leitores['g1/2026-11_07_n_bruno'] = ['bruno'];
  convites['groups/g1'] = { ownerId: texto('ana'), coordinatorIds: lista() };
  leitores['groups/g1'] = ['bruno'];
  assert.equal((await chamar('/push/avisar', { tipo: 'vaga-pedido', grupo: 'g1', chave: '2026-11_07_n_bruno' }, 'bruno')).enviados, 1);
  convites['g1/2026-11_08_n_bruno'] = pedidoFirestore({ criadoHa: 11 * 60 * 1000 });
  leitores['g1/2026-11_08_n_bruno'] = ['bruno'];
  assert.equal((await chamar('/push/avisar', { tipo: 'vaga-pedido', grupo: 'g1', chave: '2026-11_08_n_bruno' }, 'bruno')).status, 400);
});

test('resposta ao pedido: quem pediu recebe (aceito, recusado ou vagas preenchidas)', async () => {
  const bruno = await novoAparelho('bruno');
  await chamar('/push/inscrever', { inscricao: bruno.inscricao }, 'bruno');
  const responder = (chave, uid) => chamar('/push/avisar', { tipo: 'vaga-resposta', grupo: 'g1', chave }, uid);
  // Pendente ainda não é resposta
  convites['g1/p0'] = pedidoFirestore();
  leitores['g1/p0'] = ['bruno', 'carla'];
  assert.equal((await responder('p0', 'carla')).enviados, 0);
  convites['g1/p1'] = pedidoFirestore({ status: 'approved', decidedBy: 'carla' });
  convites['g1/p2'] = pedidoFirestore({ status: 'declined', decidedBy: 'carla' });
  convites['g1/p3'] = pedidoFirestore({ status: 'declined', decidedBy: 'carla', reason: 'filled' });
  for (const id of ['p1', 'p2', 'p3']) leitores[`g1/${id}`] = ['bruno', 'carla', 'intruso'];
  assert.equal((await responder('p1', 'intruso')).enviados, 0); // não foi quem respondeu
  assert.equal((await responder('p1', 'carla')).enviados, 1);
  assert.equal((await responder('p2', 'carla')).enviados, 1);
  assert.equal((await responder('p3', 'carla')).enviados, 1);
  const [aceito, recusado, preenchido] = await Promise.all(entregues.map((e) => abrir(bruno, e.corpo)));
  assert.equal(aceito.titulo, 'Pedido de plantão aceito');
  assert.equal(aceito.corpo, 'Carla Coordenadora aceitou: você está no plantão Noturno de 07/11 (19h00 às 01h00) em UTI Adulto.');
  assert.equal(recusado.titulo, 'Pedido de plantão recusado');
  assert.equal(preenchido.corpo, 'As vagas do plantão Noturno de 07/11 (19h00 às 01h00) em UTI Adulto foram preenchidas.');
});

// ---------- Cessão direcionada ----------
function cessaoFirestore({ status = 'pending', decidedBy } = {}) {
  return {
    ...pedidoFirestore({ status, decidedBy }),
    toUid: texto('eva'),
    toName: texto('Eva Plantonista'),
  };
}

test('cessão pedida: o colega e os coordenadores recebem, cada um com a sua mensagem', async () => {
  const eva = await novoAparelho('eva');
  const carla = await novoAparelho('carla');
  await chamar('/push/inscrever', { inscricao: eva.inscricao }, 'eva');
  await chamar('/push/inscrever', { inscricao: carla.inscricao }, 'carla');
  convites['g1/c1'] = cessaoFirestore();
  leitores['g1/c1'] = ['bruno', 'eva', 'carla'];
  convites['groups/g1'] = { ownerId: texto('ana'), coordinatorIds: lista('carla') };
  leitores['groups/g1'] = ['bruno', 'eva', 'carla'];
  const avisar = (uid) => chamar('/push/avisar', { tipo: 'cessao-pedido', grupo: 'g1', chave: 'c1' }, uid);
  assert.equal((await avisar('eva')).enviados, 0); // só quem cede avisa
  assert.equal((await avisar('bruno')).enviados, 2);
  const paraEva = await abrir(eva, entregues.find((e) => e.endpoint === eva.inscricao.endpoint).corpo);
  const paraCarla = await abrir(carla, entregues.find((e) => e.endpoint === carla.inscricao.endpoint).corpo);
  assert.equal(paraEva.titulo, 'Cessão de plantão para você');
  assert.equal(paraEva.corpo, 'Bruno Plantonista quer ceder para você o plantão Noturno de 07/11 (19h00 às 01h00) em UTI Adulto. A coordenação vai aprovar ou recusar.');
  assert.equal(paraCarla.titulo, 'Cessão de plantão para aprovar');
  assert.equal(paraCarla.corpo, 'Bruno Plantonista quer ceder o plantão Noturno de 07/11 (19h00 às 01h00) para Eva Plantonista em UTI Adulto. Toque para aprovar ou recusar.');
});

test('cessão respondida: aprovada avisa quem cedeu e o colega; recusada, só quem cedeu', async () => {
  const bruno = await novoAparelho('bruno');
  const eva = await novoAparelho('eva');
  await chamar('/push/inscrever', { inscricao: bruno.inscricao }, 'bruno');
  await chamar('/push/inscrever', { inscricao: eva.inscricao }, 'eva');
  convites['g1/c1'] = cessaoFirestore({ status: 'approved', decidedBy: 'carla' });
  convites['g1/c2'] = cessaoFirestore({ status: 'declined', decidedBy: 'carla' });
  for (const id of ['c1', 'c2']) leitores[`g1/${id}`] = ['bruno', 'eva', 'carla'];
  const responder = (chave, uid) => chamar('/push/avisar', { tipo: 'cessao-resposta', grupo: 'g1', chave }, uid);
  assert.equal((await responder('c1', 'bruno')).enviados, 0); // só quem respondeu avisa
  assert.equal((await responder('c1', 'carla')).enviados, 2);
  const aprovadaBruno = await abrir(bruno, entregues[0].corpo);
  const aprovadaEva = await abrir(eva, entregues[1].corpo);
  assert.equal(aprovadaBruno.corpo, 'Carla Coordenadora aprovou: Eva Plantonista ficou com o seu plantão Noturno de 07/11 (19h00 às 01h00) em UTI Adulto.');
  assert.equal(aprovadaEva.titulo, 'Plantão cedido para você');
  assert.equal((await responder('c2', 'carla')).enviados, 1);
  assert.equal((await abrir(bruno, entregues[2].corpo)).titulo, 'Cessão recusada');
});

// ---------- Teste geral (só Dev) ----------
test('Dev: teste para todos os aparelhos ativos, de todas as contas', async () => {
  const aparelhos = {};
  for (const [nome, uid] of [['iphone', 'bruno'], ['pc', 'bruno'], ['android', 'ana'], ['edge', 'carla']]) {
    aparelhos[nome] = await novoAparelho(nome);
    await chamar('/push/inscrever', { inscricao: aparelhos[nome].inscricao }, uid);
  }
  const resposta = await chamar('/push/teste-geral', {}, 'dev');
  assert.equal(resposta.status, 200);
  assert.equal(resposta.totalAparelhos, 4);
  assert.equal(resposta.totalContas, 3);
  assert.equal(resposta.enviados, 4);
  assert.equal(resposta.proximo, null);
  for (const entrega of entregues) {
    const aparelho = aparelhos[entrega.endpoint.split('/').pop()];
    assert.equal((await abrir(aparelho, entrega.corpo)).titulo, 'Teste de notificações');
  }
});

test('teste geral: quem não é Dev não consegue', async () => {
  await chamar('/push/inscrever', { inscricao: (await novoAparelho('a1')).inscricao }, 'bruno');
  assert.equal((await chamar('/push/teste-geral', {}, 'bruno')).status, 403);
  assert.equal(entregues.length, 0);
});

test('teste geral: muitos aparelhos vão em lotes de 40', async () => {
  for (let i = 0; i < 95; i += 1) {
    await chamar('/push/inscrever', { inscricao: (await novoAparelho(`a${String(i).padStart(3, '0')}`)).inscricao }, `conta${i}`);
  }
  let resposta = await chamar('/push/teste-geral', {}, 'dev');
  assert.equal(resposta.totalAparelhos, 95);
  const lotes = [resposta.enviados];
  while (resposta.proximo) {
    resposta = await chamar('/push/teste-geral', { depois: resposta.proximo }, 'dev');
    lotes.push(resposta.enviados);
  }
  assert.deepEqual(lotes, [40, 40, 15]);
  assert.equal(new Set(entregues.map((e) => e.endpoint)).size, 95);
});

test('o Cron esquece os avisos com mais de 30 dias', async () => {
  D1.db.prepare('INSERT INTO push_avisos (chave, em) VALUES (?, ?), (?, ?)').run('velho', Date.now() - 31 * 86400000, 'novo', Date.now());
  const pendentes = [];
  await worker.scheduled({}, { ...env, GOOGLE_CLIENTE: '', GOOGLE_SEGREDO: '' }, { waitUntil: (p) => pendentes.push(p) });
  await Promise.allSettled(pendentes);
  assert.deepEqual(D1.linhas('SELECT chave FROM push_avisos').map((l) => l.chave), ['novo']);
});
