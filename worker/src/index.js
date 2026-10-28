/* =====================================================================
 * EscalaMed - serviço de contas (Cloudflare Worker)
 *
 * O login e as senhas são do Firebase Authentication (e-mail e senha). Este
 * Worker faz só o que o navegador não consegue sozinho:
 *   - login por NOME DE USUÁRIO: acha a conta sem expor o e-mail, confere a
 *     senha no próprio Firebase e devolve um token personalizado para o app
 *     entrar (signInWithCustomToken);
 *   - SENHA PROVISÓRIA: só o administrador da plataforma gera, para quem
 *     esqueceu a senha. A conta fica marcada (trocarSenha) até a pessoa criar
 *     uma senha nova;
 *   - TROCA DE E-MAIL sem link de confirmação (o app confere a senha antes);
 *   - ADMINISTRAÇÃO da plataforma (Configurações > Usuários): listar as contas,
 *     senha provisória, inativar/reativar e excluir o acesso. Administradores são
 *     os uids do documento config/admins (campo "uids") no Firestore, editado só
 *     pelo console do Firebase. As regras do Firestore leem o mesmo documento.
 *
 * Rotas (todas POST, corpo JSON):
 *   /entrar-usuario    { usuario, senha }
 *   Com "Authorization: Bearer <token do Firebase>" de quem está logado:
 *   /trocar-usuario    { usuario }        vazio = remove
 *   /trocar-email      { novoEmail }      exige login recente (até 5 min)
 *   /senha-definida    {}                 tira a marca depois que a pessoa troca a senha
 *   Só administradores:
 *   /admin/contas            {}               todas as contas (uid, e-mail, situação, último acesso)
 *   /admin/senha-provisoria  { uid }
 *   /admin/acesso            { uid, ativo }   ativo=false inativa (e derruba as sessões)
 *   /admin/excluir           { uid }          apaga o login e libera o nome de usuário
 * Falhas respondem { erro } com a mensagem pronta para mostrar.
 *
 * Configuração (wrangler.toml e segredo):
 *   PROJETO        id do projeto no Firebase
 *   CHAVE_API      apiKey do app web (pública; usada para conferir a senha no Firebase)
 *   ORIGENS        endereços do app que podem chamar, separados por vírgula
 *   DB             banco D1 (escalamed-contas): nomes de usuário, limites e histórico
 *   CONTA_SERVICO  (segredo) JSON da chave de serviço, com o papel
 *                  "Administrador do Firebase Authentication"
 *   EMULADOR       "1" só em teste local: usa os emuladores do Firebase
 *   EMULADOR_AUTH / EMULADOR_FIRESTORE  endereços dos emuladores (padrão 127.0.0.1:9099 / :8080)
 * ===================================================================== */

import { gerarSenhaProvisoria, emailValido, motivoUsuarioInvalido } from './senhas.js';

const LIMITE_POR_MINUTO = 10; // logins por nome de usuário, por endereço IP
const LOGIN_RECENTE_S = 5 * 60; // troca de e-mail: login (ou senha conferida) há até 5 min

const CHAVES_GOOGLE = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const TOKEN_GOOGLE = 'https://oauth2.googleapis.com/token';
const ESCOPO = 'https://www.googleapis.com/auth/cloud-platform';
const PUBLICO_TOKEN = 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';

// Guardados enquanto o Worker estiver em memória, para não pedir de novo a cada chamada
const guardado = { chaves: null, chavesAte: 0, token: '', tokenAte: 0, chavePrivada: null };

// Erro com mensagem que pode ser mostrada a quem chamou
class Falha extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

const LOGIN_INVALIDO = 'Usuário, e-mail ou senha inválidos.';

const ROTAS = {
  '/entrar-usuario': entrarComUsuario,
  '/trocar-usuario': trocarUsuario,
  '/trocar-email': trocarEmail,
  '/senha-definida': senhaDefinida,
  '/admin/contas': adminContas,
  '/admin/senha-provisoria': adminSenhaProvisoria,
  '/admin/acesso': adminAcesso,
  '/admin/excluir': adminExcluir,
};

export default {
  async fetch(request, env) {
    const cors = cabecalhosCors(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      if (request.method !== 'POST') throw new Falha(405, 'Método não permitido.');
      if (!cors['Access-Control-Allow-Origin']) throw new Falha(403, 'Origem não permitida.');
      const rota = ROTAS[new URL(request.url).pathname];
      if (!rota) throw new Falha(404, 'Serviço não encontrado.');
      const corpo = await request.json().catch(() => ({}));
      const ip = request.headers.get('CF-Connecting-IP') || '';
      return responder(await rota({ env, request, corpo, ip, local: env.EMULADOR === '1' }), 200, cors);
    } catch (erro) {
      if (erro instanceof Falha) return responder({ erro: erro.message }, erro.status, cors);
      console.error(erro);
      return responder({ erro: 'Não foi possível concluir. Tente de novo.' }, 500, cors);
    }
  },
};

function responder(corpo, status, cors) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// Só os endereços do app recebem a liberação de CORS
function cabecalhosCors(request, env) {
  const origem = request.headers.get('Origin') || '';
  const permitidas = String(env.ORIGENS || '').split(',').map((o) => o.trim()).filter(Boolean);
  if (!permitidas.includes(origem)) return {};
  return {
    'Access-Control-Allow-Origin': origem,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/* ----- Login por nome de usuário ----- */

async function entrarComUsuario({ env, corpo, ip, local }) {
  await limitar(env, 'entrar-usuario', ip);
  const usuario = String(corpo.usuario || '').trim().toLowerCase();
  const senha = String(corpo.senha || '');
  if (!usuario || !senha) throw new Falha(400, 'Informe o usuário e a senha.');

  const linha = await env.DB.prepare('SELECT uid FROM usuarios WHERE usuario = ?1').bind(usuario).first();
  if (!linha) throw new Falha(401, LOGIN_INVALIDO);

  const contas = await authAdmin(env, local);
  const conta = (await contas(':lookup', { localId: [linha.uid] })).users?.[0];
  if (!conta?.email || conta.disabled) throw new Falha(401, LOGIN_INVALIDO);

  // A senha é conferida pelo próprio Firebase (com a mesma proteção contra tentativas)
  await conferirSenhaNoFirebase(env, conta.email, senha, local);
  return { token: await tokenPersonalizado(env, linha.uid, local) };
}

async function conferirSenhaNoFirebase(env, email, senha, local) {
  const base = local
    ? `http://${env.EMULADOR_AUTH || '127.0.0.1:9099'}/identitytoolkit.googleapis.com`
    : 'https://identitytoolkit.googleapis.com';
  const resposta = await fetch(`${base}/v1/accounts:signInWithPassword?key=${encodeURIComponent(env.CHAVE_API || 'local')}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: senha, returnSecureToken: false }),
  });
  if (resposta.ok) return;
  const motivo = (await resposta.json().catch(() => ({}))).error?.message || '';
  if (motivo.startsWith('TOO_MANY_ATTEMPTS')) {
    throw new Falha(429, 'Acesso bloqueado por muitas tentativas com senha errada. Peça uma senha provisória ao administrador do EscalaMed.');
  }
  if (motivo.startsWith('USER_DISABLED')) throw new Falha(403, 'Esta conta foi desativada.');
  if (/INVALID|EMAIL_NOT_FOUND|MISSING_PASSWORD/.test(motivo)) throw new Falha(401, LOGIN_INVALIDO);
  throw new Error(`signInWithPassword: ${resposta.status} ${motivo}`);
}

/* ----- Rotas de quem está logado ----- */

async function quemChamou({ env, request, local }) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new Falha(401, 'Entre de novo para continuar.');
  return { ...(await verificarToken(token, env, local)), token };
}

async function trocarUsuario(contexto) {
  const { env, corpo, ip } = contexto;
  const { uid } = await quemChamou(contexto);
  const usuario = String(corpo.usuario || '').trim().toLowerCase() || null;
  if (usuario) {
    const motivo = motivoUsuarioInvalido(usuario);
    if (motivo) throw new Falha(400, motivo);
    const dono = await env.DB.prepare('SELECT uid FROM usuarios WHERE usuario = ?1').bind(usuario).first();
    if (dono && dono.uid !== uid) throw new Falha(409, 'Este nome de usuário já está em uso.');
  }
  await env.DB.prepare('DELETE FROM usuarios WHERE uid = ?1').bind(uid).run();
  if (usuario) {
    try {
      await env.DB.prepare('INSERT INTO usuarios (usuario, uid, criado_em) VALUES (?1, ?2, ?3)').bind(usuario, uid, Date.now()).run();
    } catch (erro) {
      // Duas pessoas pegando o mesmo nome ao mesmo tempo: o banco recusa a segunda
      if (String(erro.message).includes('UNIQUE')) throw new Falha(409, 'Este nome de usuário já está em uso.');
      throw erro;
    }
  }
  await registrar(env, uid, 'usuario', uid, ip);
  return { usuario };
}

// O app confere a senha (reautenticação) logo antes: o token precisa ser recente
async function trocarEmail(contexto) {
  const { env, corpo, ip, local } = contexto;
  const { uid, authTime } = await quemChamou(contexto);
  if (Math.floor(Date.now() / 1000) - authTime > LOGIN_RECENTE_S) {
    throw new Falha(401, 'Por segurança, confirme sua senha e tente de novo.');
  }
  const email = String(corpo.novoEmail || '').trim().toLowerCase();
  if (!emailValido(email)) throw new Falha(400, 'Informe um e-mail válido.');
  const contas = await authAdmin(env, local);
  await contas(':update', { localId: uid, email });
  await registrar(env, uid, 'email', uid, ip);
  return { email };
}

// Troca a senha pela provisória. Devolve a senha (não fica guardada em lugar nenhum).
async function aplicarSenhaProvisoria(env, local, alvo, autor, ip) {
  const contas = await authAdmin(env, local);
  const existe = (await contas(':lookup', { localId: [alvo] })).users?.[0];
  if (!existe) throw new Falha(404, 'Conta não encontrada.');

  const senha = gerarSenhaProvisoria();
  // validSince encerra as sessões abertas; a marca trocarSenha pede a senha nova no login
  await contas(':update', {
    localId: alvo,
    password: senha,
    validSince: String(Math.floor(Date.now() / 1000)),
    customAttributes: JSON.stringify({ trocarSenha: true }),
  });
  await registrar(env, alvo, 'senha-provisoria', autor, ip);
  return senha;
}

// Tira a marca de senha provisória, mas só se a senha mudou depois dela
async function senhaDefinida(contexto) {
  const { env, local } = contexto;
  const { uid } = await quemChamou(contexto);
  const contas = await authAdmin(env, local);
  const conta = (await contas(':lookup', { localId: [uid] })).users?.[0];
  const ultima = await env.DB.prepare(
    "SELECT MAX(em) AS em FROM eventos WHERE uid = ?1 AND tipo = 'senha-provisoria'",
  )
    .bind(uid)
    .first();
  const trocadaEm = Number(conta?.passwordUpdatedAt || 0);
  if (ultima?.em && trocadaEm <= ultima.em) throw new Falha(400, 'Crie a senha nova antes de continuar.');
  await contas(':update', { localId: uid, customAttributes: '{}' });
  return { ok: true };
}

/* ----- Administração da plataforma ----- */

// Confere se quem chamou está em config/admins. Devolve { uid, token }.
async function exigirAdmin(contexto) {
  const quem = await quemChamou(contexto);
  const admins = await lerAdmins(contexto.env, quem.token, contexto.local);
  if (!admins.includes(quem.uid)) throw new Falha(403, 'Só administradores da plataforma podem fazer isso.');
  return quem;
}

// uid alvo do pedido (nunca o próprio administrador)
function alvoDoPedido(corpo, autor, mensagemPropria) {
  const alvo = String(corpo.uid || '');
  if (!alvo) throw new Falha(400, 'Informe a conta.');
  if (alvo === autor) throw new Falha(400, mensagemPropria);
  return alvo;
}

// Todas as contas do Authentication (o perfil, com nome e profissão, o app lê no Firestore)
async function adminContas(contexto) {
  const { env, local } = contexto;
  await exigirAdmin(contexto);
  const contas = await authAdmin(env, local);
  const lista = [];
  let proxima = '';
  do {
    const pagina = proxima ? `&nextPageToken=${encodeURIComponent(proxima)}` : '';
    const resposta = await contas(`:batchGet?maxResults=1000${pagina}`); // sem corpo = GET
    lista.push(...(resposta.users || []));
    proxima = resposta.nextPageToken || '';
  } while (proxima && lista.length < 10000);
  const nomes = await env.DB.prepare('SELECT usuario, uid FROM usuarios').all();
  const usuarioDe = new Map((nomes.results || []).map((linha) => [linha.uid, linha.usuario]));
  return {
    contas: lista.map((c) => ({
      uid: c.localId,
      email: c.email || null,
      usuario: usuarioDe.get(c.localId) || null,
      inativa: c.disabled === true,
      provedores: (c.providerUserInfo || []).map((p) => p.providerId),
      criadaEm: Number(c.createdAt || 0) || null,
      ultimoAcesso: Number(c.lastLoginAt || 0) || null,
    })),
  };
}

async function adminSenhaProvisoria(contexto) {
  const { env, corpo, ip, local } = contexto;
  const { uid: autor } = await exigirAdmin(contexto);
  const alvo = alvoDoPedido(corpo, autor, 'Para a sua própria senha, use Configurações > Alterar senha.');
  return { senha: await aplicarSenhaProvisoria(env, local, alvo, autor, ip) };
}

// Inativar: a pessoa não entra mais (nem por usuário) e as sessões abertas caem
async function adminAcesso(contexto) {
  const { env, corpo, ip, local } = contexto;
  const { uid: autor } = await exigirAdmin(contexto);
  const alvo = alvoDoPedido(corpo, autor, 'Você não pode inativar a sua própria conta.');
  const ativo = corpo.ativo === true;
  const contas = await authAdmin(env, local);
  const mudanca = { localId: alvo, disableUser: !ativo };
  if (!ativo) mudanca.validSince = String(Math.floor(Date.now() / 1000));
  await contas(':update', mudanca);
  await registrar(env, alvo, ativo ? 'reativar' : 'inativar', autor, ip);
  return { ativo };
}

// Apaga o login e libera o nome de usuário. O app apaga o perfil no Firestore antes.
async function adminExcluir(contexto) {
  const { env, corpo, ip, local } = contexto;
  const { uid: autor } = await exigirAdmin(contexto);
  const alvo = alvoDoPedido(corpo, autor, 'Para excluir a sua própria conta, use Configurações > Excluir minha conta.');
  const contas = await authAdmin(env, local);
  await contas(':delete', { localId: alvo });
  await env.DB.prepare('DELETE FROM usuarios WHERE uid = ?1').bind(alvo).run();
  await registrar(env, alvo, 'excluir', autor, ip);
  return { ok: true };
}

/* ----- Apoio ----- */

async function registrar(env, uid, tipo, porUid, ip) {
  await env.DB.prepare('INSERT INTO eventos (uid, tipo, por_uid, ip, em) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(uid, tipo, porUid, ip || null, Date.now())
    .run();
}

// Limite de pedidos por IP e por minuto (contra robôs tentando senhas)
async function limitar(env, rota, ip) {
  if (!ip) return;
  const janela = Math.floor(Date.now() / 60000);
  const linha = await env.DB.prepare(
    `INSERT INTO limites (chave, janela, total) VALUES (?1, ?2, 1)
     ON CONFLICT (chave) DO UPDATE SET total = CASE WHEN janela = ?2 THEN total + 1 ELSE 1 END, janela = ?2
     RETURNING total`,
  )
    .bind(`${rota}:${ip}`, janela)
    .first();
  if (linha.total > LIMITE_POR_MINUTO) throw new Falha(429, 'Muitas tentativas. Aguarde um minuto e tente de novo.');
}

/* ----- Tokens ----- */

function deBase64Url(texto) {
  const base64 = texto.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

function paraBase64Url(valor) {
  const bytes = typeof valor === 'string' ? new TextEncoder().encode(valor) : new Uint8Array(valor);
  let binario = '';
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const contaDeServico = (env) => {
  if (!env.CONTA_SERVICO) throw new Error('Segredo CONTA_SERVICO não configurado.');
  return JSON.parse(env.CONTA_SERVICO);
};

async function chavePrivada(env) {
  if (guardado.chavePrivada) return guardado.chavePrivada;
  const pem = contaDeServico(env).private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  guardado.chavePrivada = await crypto.subtle.importKey(
    'pkcs8',
    Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return guardado.chavePrivada;
}

async function assinar(env, dados) {
  const pedido = `${paraBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${paraBase64Url(JSON.stringify(dados))}`;
  const assinatura = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await chavePrivada(env), new TextEncoder().encode(pedido));
  return `${pedido}.${paraBase64Url(assinatura)}`;
}

// Token personalizado do Firebase (vale 1 hora só para entrar; a sessão se renova sozinha)
async function tokenPersonalizado(env, uid, local) {
  const agora = Math.floor(Date.now() / 1000);
  const dados = { aud: PUBLICO_TOKEN, iat: agora, exp: agora + 3600, uid };
  if (local) {
    // O emulador aceita token sem assinatura
    const emissor = 'emulador@escalamed.local';
    const corpo = { ...dados, iss: emissor, sub: emissor };
    return `${paraBase64Url(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${paraBase64Url(JSON.stringify(corpo))}.`;
  }
  const { client_email } = contaDeServico(env);
  return assinar(env, { ...dados, iss: client_email, sub: client_email });
}

// Confere o token do Firebase de quem chamou. Nos emuladores os tokens não são
// assinados, então só os dados são conferidos.
async function verificarToken(token, env, local) {
  const expirado = new Falha(401, 'Sua sessão expirou. Entre de novo e repita a ação.');
  const partes = token.split('.');
  if (partes.length !== 3) throw expirado;

  let cabecalho;
  let dados;
  try {
    cabecalho = JSON.parse(new TextDecoder().decode(deBase64Url(partes[0])));
    dados = JSON.parse(new TextDecoder().decode(deBase64Url(partes[1])));
  } catch {
    throw expirado;
  }

  const agora = Math.floor(Date.now() / 1000);
  const valido =
    dados.aud === env.PROJETO &&
    dados.iss === `https://securetoken.google.com/${env.PROJETO}` &&
    typeof dados.sub === 'string' &&
    dados.sub &&
    dados.exp > agora;
  if (!valido) throw expirado;

  if (!local) {
    if (cabecalho.alg !== 'RS256') throw expirado;
    const jwk = (await chavesDoGoogle()).find((chave) => chave.kid === cabecalho.kid);
    if (!jwk) throw expirado;
    const chave = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const assinado = new TextEncoder().encode(`${partes[0]}.${partes[1]}`);
    if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', chave, deBase64Url(partes[2]), assinado))) throw expirado;
  }
  return { uid: dados.sub, authTime: Number(dados.auth_time || 0) };
}

// Chaves públicas com que o Google assina os tokens (trocam de tempos em tempos)
async function chavesDoGoogle() {
  if (guardado.chaves && guardado.chavesAte > Date.now()) return guardado.chaves;
  const resposta = await fetch(CHAVES_GOOGLE);
  if (!resposta.ok) throw new Error(`Chaves do Google: ${resposta.status}`);
  const validade = Number((resposta.headers.get('Cache-Control') || '').match(/max-age=(\d+)/)?.[1] || 3600);
  guardado.chaves = (await resposta.json()).keys || [];
  guardado.chavesAte = Date.now() + validade * 1000;
  return guardado.chaves;
}

/* ----- Firestore (com o token de quem pediu: valem as regras) ----- */

// Campos de um documento, ou null se não existe ou as regras não deixam ler
async function lerDocumento(env, token, caminho, local) {
  const base = local ? `http://${env.EMULADOR_FIRESTORE || '127.0.0.1:8080'}` : 'https://firestore.googleapis.com';
  const resposta = await fetch(`${base}/v1/projects/${env.PROJETO}/databases/(default)/documents/${caminho}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (resposta.status === 403 || resposta.status === 404) return null;
  if (!resposta.ok) throw new Error(`Firestore: ${resposta.status} ${await resposta.text()}`);
  return (await resposta.json()).fields || {};
}

const listaDeTextos = (campo) => (campo?.arrayValue?.values || []).map((v) => v.stringValue).filter(Boolean);

// uids dos administradores da plataforma (config/admins, campo "uids")
async function lerAdmins(env, token, local) {
  const campos = await lerDocumento(env, token, 'config/admins', local);
  return listaDeTextos(campos?.uids);
}

/* ----- Contas do Firebase Authentication, com a chave de serviço ----- */

async function authAdmin(env, local) {
  const base = local
    ? `http://${env.EMULADOR_AUTH || '127.0.0.1:9099'}/identitytoolkit.googleapis.com`
    : 'https://identitytoolkit.googleapis.com';
  const acesso = local ? 'owner' : await tokenDeServico(env);

  // Sem corpo, faz GET (ex.: :batchGet, a listagem de contas)
  return async (acao, corpo) => {
    const resposta = await fetch(`${base}/v1/projects/${env.PROJETO}/accounts${acao}`, {
      method: corpo === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${acesso}`, 'Content-Type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    if (!resposta.ok) {
      const texto = await resposta.text();
      if (texto.includes('EMAIL_EXISTS')) throw new Falha(409, 'Este e-mail já é usado por outra conta.');
      throw new Error(`Authentication${acao}: ${resposta.status} ${texto}`);
    }
    return resposta.json();
  };
}

// Troca a chave de serviço por um token de acesso do Google (vale 1 hora)
async function tokenDeServico(env) {
  if (guardado.token && guardado.tokenAte > Date.now() + 60000) return guardado.token;
  const conta = contaDeServico(env);
  const agora = Math.floor(Date.now() / 1000);
  const assertion = await assinar(env, { iss: conta.client_email, scope: ESCOPO, aud: TOKEN_GOOGLE, iat: agora, exp: agora + 3600 });
  const resposta = await fetch(TOKEN_GOOGLE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!resposta.ok) throw new Error(`Token de serviço: ${resposta.status} ${await resposta.text()}`);
  const dados = await resposta.json();
  guardado.token = dados.access_token;
  guardado.tokenAte = Date.now() + (dados.expires_in || 3600) * 1000;
  return guardado.token;
}
