/* =====================================================================
 * EscalaMed - notificações push no celular (Web Push), as mesmas do sininho
 *
 * O aparelho (navegador ou o app adicionado à Tela de Início, no iPhone) se inscreve
 * no serviço de push dele (Google, Apple, Mozilla, Microsoft) e manda a inscrição para
 * cá. Quando acontece algo que aparece no sininho, o app avisa este Worker, que CONFERE
 * no Firestore (com o token de quem pediu: valem as regras) antes de mandar o push.
 * Assim ninguém consegue disparar notificação falsa para outra pessoa.
 *
 * Avisos de hoje (os do sininho):
 *   convite  alguém foi convidado para um grupo     → para a pessoa convidada
 *   recusa   o convidado recusou                    → para quem convidou
 *
 * Rotas (POST, com "Authorization: Bearer <token do Firebase>"):
 *   /push/inscrever  { inscricao: { endpoint, keys: { p256dh, auth } }, aparelho }
 *   /push/cancelar   { endpoint }          este aparelho para de receber (ex.: ao sair da conta)
 *   /push/estado     { endpoint }          { inscrito } este aparelho recebe as notificações desta conta?
 *   /push/teste      {}                    manda uma notificação de teste para os aparelhos da conta
 *   /push/teste-geral { depois? }          só Dev: teste para TODOS os aparelhos ativos da plataforma,
 *                                          em lotes (devolve "proximo" enquanto faltar aparelho)
 *   /push/avisar     { tipo, grupo, chave } manda o aviso (conferido no Firestore)
 *
 * Padrões usados (sem bibliotecas, só WebCrypto):
 *   RFC 8291 (criptografia da mensagem, aes128gcm) e RFC 8292 (VAPID: o servidor se identifica)
 *
 * Configuração:
 *   VAPID_PUBLICA  (wrangler.toml) chave pública P-256, 65 bytes em base64url (a mesma do app)
 *   VAPID_PRIVADA  (segredo) o "d" da chave privada, em base64url
 *   APP            endereço do app: contato do VAPID e links das notificações
 * ===================================================================== */

const MAX_APARELHOS = 10; // por conta: os mais antigos saem
const AVISO_RECENTE_MS = 10 * 60 * 1000; // só avisa o que aconteceu nos últimos 10 minutos
const GUARDA_AVISOS_MS = 30 * 24 * 60 * 60 * 1000; // lembra os avisos enviados por 30 dias
const VALIDADE_MENSAGEM_S = 7 * 24 * 60 * 60; // celular desligado: o serviço guarda por até 7 dias
const TAMANHO_REGISTRO = 4096;
// Teste geral: aparelhos por chamada (o plano gratuito do Cloudflare deixa 50 requisições por chamada)
const LOTE_GERAL = 40;

// Serviços de push aceitos (o Worker só faz POST para eles)
const SERVICOS = ['fcm.googleapis.com', 'android.googleapis.com', 'push.apple.com', 'push.services.mozilla.com', 'notify.windows.com'];

let apoio = null; // { Falha, quemChamou, lerDocumento, authAdmin, limitar, ehDev }
const guardado = { chave: null, chaveDe: '', jwts: new Map() };

export function rotasDoPush(dependencias) {
  apoio = dependencias;
  return {
    rotas: {
      '/push/inscrever': inscrever,
      '/push/cancelar': cancelar,
      '/push/estado': estado,
      '/push/teste': teste,
      '/push/teste-geral': testeGeral,
      '/push/avisar': avisar,
    },
    cron: limparAvisos,
  };
}

/* ----- Rotas ----- */

async function inscrever(contexto) {
  const { env, corpo } = contexto;
  const { uid } = await apoio.quemChamou(contexto);
  const inscricao = validarInscricao(corpo.inscricao);
  const aparelho = String(corpo.aparelho || '').slice(0, 60) || null;
  const agora = Date.now();
  // Mesmo aparelho com outra conta: passa a receber só as notificações da conta nova
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO push_inscricoes (endpoint, uid, p256dh, auth, aparelho, criado_em, usado_em)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
       ON CONFLICT (endpoint) DO UPDATE SET uid = ?2, p256dh = ?3, auth = ?4, aparelho = ?5, usado_em = ?6`,
    ).bind(inscricao.endpoint, uid, inscricao.p256dh, inscricao.auth, aparelho, agora),
    env.DB.prepare(
      `DELETE FROM push_inscricoes WHERE uid = ?1 AND endpoint NOT IN
         (SELECT endpoint FROM push_inscricoes WHERE uid = ?1 ORDER BY usado_em DESC LIMIT ?2)`,
    ).bind(uid, MAX_APARELHOS),
  ]);
  return { inscrito: true };
}

async function cancelar(contexto) {
  const { env, corpo } = contexto;
  const { uid } = await apoio.quemChamou(contexto);
  const endpoint = String(corpo.endpoint || '');
  if (endpoint) await env.DB.prepare('DELETE FROM push_inscricoes WHERE endpoint = ?1 AND uid = ?2').bind(endpoint, uid).run();
  return { inscrito: false };
}

async function estado(contexto) {
  const { env, corpo } = contexto;
  const { uid } = await apoio.quemChamou(contexto);
  const endpoint = String(corpo.endpoint || '');
  const linha = endpoint ? await env.DB.prepare('SELECT uid FROM push_inscricoes WHERE endpoint = ?1').bind(endpoint).first() : null;
  return { inscrito: linha?.uid === uid };
}

async function teste(contexto) {
  const { env } = contexto;
  const { uid } = await apoio.quemChamou(contexto);
  await apoio.limitar(env, 'push-teste', uid);
  const enviados = await enviarParaConta(env, uid, {
    titulo: 'Notificações ativadas',
    corpo: 'Tudo certo! Os avisos do sininho do EscalaMed vão chegar neste aparelho.',
    url: '/schedules.html',
    tag: 'teste',
  });
  if (!enviados) throw new apoio.Falha(404, 'Nenhum aparelho desta conta está recebendo notificações. Ative de novo e tente outra vez.');
  return { enviados };
}

// Só Dev: manda um teste para todos os aparelhos ativos (todas as contas, celular e computador).
// Vai em lotes, na ordem do endpoint: o app chama de novo com "depois" até "proximo" vir vazio.
const MENSAGEM_GERAL = {
  titulo: 'Teste de notificações',
  corpo: 'Teste enviado pela equipe do EscalaMed. Se você recebeu, as notificações estão funcionando neste aparelho.',
  url: '/schedules.html',
  tag: 'teste-geral',
};

async function testeGeral(contexto) {
  const { env, corpo, local } = contexto;
  const quem = await apoio.quemChamou(contexto);
  if (!(await apoio.ehDev(env, quem.token, local))) throw new apoio.Falha(403, 'Só o Dev pode enviar o teste para todos os aparelhos.');
  const depois = String(corpo.depois || '');
  const resposta = {};
  if (!depois) {
    // Primeiro lote: limite de pedidos e o total (para o resumo no app)
    await apoio.limitar(env, 'push-teste-geral', quem.uid);
    const total = await env.DB.prepare('SELECT COUNT(*) AS aparelhos, COUNT(DISTINCT uid) AS contas FROM push_inscricoes').first();
    Object.assign(resposta, { totalAparelhos: total.aparelhos, totalContas: total.contas });
  }
  const { results = [] } = await env.DB.prepare(
    'SELECT endpoint, p256dh, auth FROM push_inscricoes WHERE endpoint > ?1 ORDER BY endpoint LIMIT ?2',
  )
    .bind(depois, LOTE_GERAL + 1)
    .all();
  const lote = results.slice(0, LOTE_GERAL);
  resposta.enviados = await enviarParaInscricoes(env, lote, MENSAGEM_GERAL);
  resposta.proximo = results.length > LOTE_GERAL ? lote.at(-1).endpoint : null;
  return resposta;
}

// O app avisa logo depois de gravar no Firestore. Aqui o aviso é conferido no próprio
// Firestore com o token de quem pediu: o documento precisa existir, ser recente e
// combinar com quem pediu. Cada aviso sai uma vez só.
async function avisar(contexto) {
  const { env, corpo, local } = contexto;
  const quem = await apoio.quemChamou(contexto);
  const tipo = String(corpo.tipo || '');
  const grupo = String(corpo.grupo || '');
  const chave = String(corpo.chave || '');
  if (!AVISOS[tipo]) throw new apoio.Falha(400, 'Aviso desconhecido.');
  if (!grupo || !chave || grupo.length > 200 || chave.length > 254 || /[/]/.test(grupo + chave)) {
    throw new apoio.Falha(400, 'Aviso incompleto.');
  }

  const caminho = `groups/${encodeURIComponent(grupo)}/invites/${encodeURIComponent(chave)}`;
  const campos = await apoio.lerDocumento(env, quem.token, caminho, local);
  if (!campos) throw new apoio.Falha(404, 'Convite não encontrado.');
  const convite = valoresDe(campos);

  const aviso = await AVISOS[tipo]({ env, local, quem, grupo, chave, convite });
  if (!aviso) return { enviados: 0 };
  if (!aviso.momento || Date.now() - aviso.momento > AVISO_RECENTE_MS) throw new apoio.Falha(400, 'Aviso antigo.');

  // Uma vez só (o app pode repetir o pedido)
  const novo = await env.DB.prepare('INSERT INTO push_avisos (chave, em) VALUES (?1, ?2) ON CONFLICT (chave) DO NOTHING RETURNING chave')
    .bind(`${tipo}:${grupo}:${chave}:${aviso.momento}`, Date.now())
    .first();
  if (!novo || !aviso.destino || aviso.destino === quem.uid) return { enviados: 0 };
  return { enviados: await enviarParaConta(env, aviso.destino, aviso.mensagem) };
}

// Cada tipo de aviso: confere o documento e monta a notificação (null = nada a avisar)
const AVISOS = {
  // Convite novo: quem pediu precisa ser quem convidou. Convite por e-mail só chega
  // se a pessoa já tem conta (o e-mail vira o uid pelo Authentication).
  async convite({ env, local, quem, grupo, convite }) {
    if (convite.invitedBy !== quem.uid || convite.status === 'declined') return null;
    const destino = convite.uid || (convite.email ? await uidDoEmail(env, local, convite.email) : null);
    const unidade = convite.unitName ? ` · ${convite.unitName}` : '';
    return {
      momento: Date.parse(convite.createdAt || ''),
      destino,
      mensagem: {
        titulo: `Convite para ${convite.groupName || 'um grupo'}`,
        corpo: `${convite.invitedByName || 'Alguém'} convidou você para o grupo${unidade}. Toque para aceitar ou recusar.`,
        url: `/invite.html?g=${encodeURIComponent(grupo)}`,
        tag: `convite:${grupo}`,
      },
    };
  },
  // Convite recusado: avisa quem convidou
  async recusa({ grupo, convite }) {
    if (convite.status !== 'declined') return null;
    return {
      momento: Date.parse(convite.respondedAt || ''),
      destino: convite.invitedBy,
      mensagem: {
        titulo: 'Convite recusado',
        corpo: `${convite.respondedByName || convite.name || convite.email || 'Alguém'} recusou o convite para ${convite.groupName || 'o grupo'}.`,
        url: `/group.html?id=${encodeURIComponent(grupo)}#membros`,
        tag: `recusa:${grupo}`,
      },
    };
  },
};

async function uidDoEmail(env, local, email) {
  const contas = await apoio.authAdmin(env, local);
  const conta = (await contas(':lookup', { email: [String(email).toLowerCase()] })).users?.[0];
  return conta && !conta.disabled ? conta.localId : null;
}

// Cron: esquece os avisos antigos
async function limparAvisos(env) {
  await env.DB.prepare('DELETE FROM push_avisos WHERE em < ?1').bind(Date.now() - GUARDA_AVISOS_MS).run();
}

/* ----- Envio ----- */

// Manda para todos os aparelhos da conta. Devolve quantos aceitaram.
export async function enviarParaConta(env, uid, mensagem) {
  const { results = [] } = await env.DB.prepare('SELECT endpoint, p256dh, auth FROM push_inscricoes WHERE uid = ?1').bind(uid).all();
  return enviarParaInscricoes(env, results, mensagem);
}

// Manda para uma lista de aparelhos (endpoint, p256dh, auth). Devolve quantos aceitaram;
// os que saíram do serviço (404/410) são esquecidos.
async function enviarParaInscricoes(env, results, mensagem) {
  if (!results.length) return 0;
  const texto = JSON.stringify(mensagem);
  const situacoes = await Promise.all(results.map((inscricao) => enviar(env, inscricao, texto).catch((erro) => (console.error('push', erro), 0))));
  const agora = Date.now();
  const comandos = [];
  results.forEach((inscricao, i) => {
    const status = situacoes[i];
    if (status >= 200 && status < 300) {
      comandos.push(env.DB.prepare('UPDATE push_inscricoes SET usado_em = ?2 WHERE endpoint = ?1').bind(inscricao.endpoint, agora));
    } else if (status === 404 || status === 410) {
      // Inscrição vencida, cancelada no aparelho ou feita com outra chave VAPID: sai da lista
      comandos.push(env.DB.prepare('DELETE FROM push_inscricoes WHERE endpoint = ?1').bind(inscricao.endpoint));
    }
  });
  if (comandos.length) await env.DB.batch(comandos);
  return situacoes.filter((s) => s >= 200 && s < 300).length;
}

async function enviar(env, inscricao, texto) {
  const corpo = await criptografar(texto, inscricao.p256dh, inscricao.auth);
  const resposta = await fetch(inscricao.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await cabecalhoVapid(env, inscricao.endpoint),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(VALIDADE_MENSAGEM_S),
      Urgency: 'high',
    },
    body: corpo,
  });
  if (resposta.ok || [404, 410].includes(resposta.status)) return resposta.status;
  const detalhe = await resposta.text().catch(() => '');
  console.error(`push ${new URL(inscricao.endpoint).host}: ${resposta.status} ${detalhe}`);
  // Inscrição feita com outra chave VAPID: não vai funcionar nunca mais (vira "sumiu").
  // Outros 403 (ex.: Apple recusando o nosso JWT) são problema daqui: a inscrição fica.
  if (resposta.status === 403 && /mismatch/i.test(detalhe)) return 410;
  return resposta.status;
}

/* ----- Inscrição ----- */

function validarInscricao(inscricao) {
  const invalida = new apoio.Falha(400, 'Inscrição de notificações inválida. Tente ativar de novo.');
  const endpoint = String(inscricao?.endpoint || '');
  const p256dh = String(inscricao?.keys?.p256dh || '');
  const auth = String(inscricao?.keys?.auth || '');
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw invalida;
  }
  const servicoConhecido = SERVICOS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  if (url.protocol !== 'https:' || !servicoConhecido || endpoint.length > 1024) throw invalida;
  try {
    const chave = deBase64Url(p256dh);
    if (chave.length !== 65 || chave[0] !== 4 || deBase64Url(auth).length !== 16) throw invalida;
  } catch {
    throw invalida;
  }
  return { endpoint, p256dh, auth };
}

/* ----- Criptografia da mensagem (RFC 8291, aes128gcm) ----- */

const texto = new TextEncoder();

function juntar(...partes) {
  const total = partes.reduce((soma, p) => soma + p.length, 0);
  const saida = new Uint8Array(total);
  let posicao = 0;
  for (const parte of partes) {
    saida.set(parte, posicao);
    posicao += parte.length;
  }
  return saida;
}

async function hmac(chave, dados) {
  const k = await crypto.subtle.importKey('raw', chave, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, dados));
}

// Mensagem → corpo cifrado para o aparelho (só ele consegue abrir)
export async function criptografar(mensagem, p256dh, authSecreto) {
  const publicaDoAparelho = deBase64Url(p256dh);
  const segredo = deBase64Url(authSecreto);

  // Par de chaves de uso único: a chave pública vai no cabeçalho da mensagem
  const efemera = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicaDoServidor = new Uint8Array(await crypto.subtle.exportKey('raw', efemera.publicKey));
  const chaveDoAparelho = await crypto.subtle.importKey('raw', publicaDoAparelho, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const compartilhado = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: chaveDoAparelho }, efemera.privateKey, 256));

  // HKDF (extract + expand de um bloco), como na RFC 8291
  const prkChave = await hmac(segredo, compartilhado);
  const ikm = await hmac(prkChave, juntar(texto.encode('WebPush: info\0'), publicaDoAparelho, publicaDoServidor, [1]));
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(sal, ikm);
  const cek = (await hmac(prk, juntar(texto.encode('Content-Encoding: aes128gcm\0'), [1]))).slice(0, 16);
  const nonce = (await hmac(prk, juntar(texto.encode('Content-Encoding: nonce\0'), [1]))).slice(0, 12);

  const claro = juntar(texto.encode(mensagem), [2]); // 0x02 = último registro
  if (claro.length + 16 > TAMANHO_REGISTRO) throw new Error('Notificação grande demais.');
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, claro));

  // Cabeçalho: sal (16) | tamanho do registro (4) | tamanho da chave (1) | chave pública (65)
  const cabecalho = new Uint8Array(16 + 4 + 1 + publicaDoServidor.length);
  cabecalho.set(sal, 0);
  new DataView(cabecalho.buffer).setUint32(16, TAMANHO_REGISTRO);
  cabecalho[20] = publicaDoServidor.length;
  cabecalho.set(publicaDoServidor, 21);
  return juntar(cabecalho, cifrado);
}

/* ----- VAPID (RFC 8292): o servidor se identifica para o serviço de push ----- */

async function chaveVapid(env) {
  if (guardado.chave && guardado.chaveDe === env.VAPID_PUBLICA) return guardado.chave;
  if (!env.VAPID_PUBLICA || !env.VAPID_PRIVADA) throw new Error('VAPID_PUBLICA ou VAPID_PRIVADA não configurada.');
  const publica = deBase64Url(env.VAPID_PUBLICA);
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: paraBase64Url(publica.slice(1, 33)),
    y: paraBase64Url(publica.slice(33, 65)),
    d: env.VAPID_PRIVADA,
  };
  guardado.chave = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  guardado.chaveDe = env.VAPID_PUBLICA;
  guardado.jwts.clear();
  return guardado.chave;
}

// "vapid t=<JWT assinado>, k=<chave pública>" (um JWT por serviço, reaproveitado por 11 horas)
async function cabecalhoVapid(env, endpoint) {
  const publico = new URL(endpoint).origin;
  const agora = Math.floor(Date.now() / 1000);
  const chave = await chaveVapid(env);
  const pronto = guardado.jwts.get(publico);
  if (pronto && pronto.ate > agora + 3600) return pronto.cabecalho;
  const ate = agora + 12 * 3600;
  const contato = env.APP || 'https://escalamed-hapvida.web.app';
  const pedido = `${paraBase64Url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))}.${paraBase64Url(JSON.stringify({ aud: publico, exp: ate, sub: contato }))}`;
  const assinatura = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, chave, texto.encode(pedido));
  const cabecalho = `vapid t=${pedido}.${paraBase64Url(assinatura)}, k=${env.VAPID_PUBLICA}`;
  guardado.jwts.set(publico, { ate, cabecalho });
  return cabecalho;
}

/* ----- Apoio ----- */

// Campos do Firestore (REST) → valores simples
function valoresDe(campos) {
  const valor = (v) =>
    v?.stringValue ?? v?.timestampValue ?? v?.booleanValue ?? (v?.integerValue !== undefined ? Number(v.integerValue) : null);
  return Object.fromEntries(Object.entries(campos).map(([nome, v]) => [nome, valor(v)]));
}

export function deBase64Url(valor) {
  const base64 = String(valor).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

export function paraBase64Url(valor) {
  const bytes = typeof valor === 'string' ? texto.encode(valor) : new Uint8Array(valor);
  let binario = '';
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
