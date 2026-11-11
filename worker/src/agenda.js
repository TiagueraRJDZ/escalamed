/* =====================================================================
 * EscalaMed - Agenda Google (parte do serviço de contas)
 *
 * Os plantões publicados de cada pessoa ficam numa agenda "EscalaMed" no Google
 * dela, com lembrete. O app nunca recebe o token do Google: ele fica aqui.
 *
 *   1. Conectar: o app abre a janela do Google (Google Identity Services, modo
 *      "código") e manda o código para /agenda/conectar. O Worker troca o código
 *      pelo token de renovação (guardado criptografado no D1) e cria a agenda.
 *   2. O app manda os plantões (o Worker não lê escalas no Firestore):
 *        /agenda/meus-plantoes  plantões publicados da própria pessoa, de alguns
 *                               meses (ao abrir o app e em "Atualizar agora");
 *        /agenda/grupo          quando gestor ou auxiliar altera uma escala: as
 *                               células do mês, de todo o grupo. O Worker confere
 *                               no Firestore se quem chamou administra o grupo e
 *                               só usa membros dele.
 *   3. agenda_desejados guarda o que deveria estar em cada agenda e
 *      agenda_enviados o que já está. A diferença vai ao Google em lotes de até
 *      50 eventos (uma chamada por lote). O que não couber numa execução fica
 *      pendente e o Cron (a cada 5 minutos) termina.
 *
 * Rotas (POST, com "Authorization: Bearer <token do Firebase>"):
 *   /agenda/estado          {}                          { conectado, lembrete, pendente, sincronizadoEm }
 *   /agenda/conectar        { codigo, fuso }
 *   /agenda/lembrete        { minutos }                 0 = sem lembrete
 *   /agenda/meus-plantoes   { meses, escalas }
 *   /agenda/grupo           { grupoId, mes, publicada, turnos, celulas }
 *   /agenda/desconectar     {}                          apaga a agenda EscalaMed do Google
 *   /agenda/limpar-tudo     {}                          só Dev: tira todos os plantões de todas as agendas
 *
 * Configuração (wrangler.toml e segredo):
 *   GOOGLE_CLIENTE  ID do cliente OAuth (o mesmo de googleClientId em public/js/config.js)
 *   GOOGLE_SEGREDO  (segredo) chave secreta do cliente OAuth. Também gera a chave que
 *                   criptografa os tokens: trocar o segredo desconecta todo mundo.
 *   APP             endereço do app (link "Ver no EscalaMed" nos eventos)
 * ===================================================================== */

const TOKEN_GOOGLE = 'https://oauth2.googleapis.com/token';
const REVOGAR_GOOGLE = 'https://oauth2.googleapis.com/revoke';
const API_AGENDA = 'https://www.googleapis.com/calendar/v3';
const LOTE_AGENDA = 'https://www.googleapis.com/batch/calendar/v3';
export const ESCOPO_AGENDA = 'https://www.googleapis.com/auth/calendar.app.created';

const APP_PADRAO = 'https://escalamed-hapvida.web.app';
const FUSO_PADRAO = 'America/Sao_Paulo';
const POR_LOTE = 50; // limite do Google por lote
// Chamadas externas e consultas ao D1 por execução (o plano gratuito permite 50 de cada)
const ORCAMENTO = 40;
export const LEMBRETES = [0, 30, 60, 120, 360, 720, 1440];

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const ID = /^[A-Za-z0-9_-]{1,128}$/; // grupos, turnos e uids
const CELULA = /^(\d{2})_([A-Za-z0-9_-]{1,128})$/;
const FORMULARIO = { 'Content-Type': 'application/x-www-form-urlencoded' };

// Falha, quemChamou e lerDocumento vêm de index.js (ver rotasDaAgenda)
let apoio;

class SemOrcamento extends Error {}
class AcessoRevogado extends Error {}

export function rotasDaAgenda(dependencias) {
  apoio = dependencias;
  return {
    rotas: {
      '/agenda/estado': estado,
      '/agenda/conectar': conectar,
      '/agenda/lembrete': lembrete,
      '/agenda/meus-plantoes': meusPlantoes,
      '/agenda/grupo': grupo,
      '/agenda/desconectar': desconectar,
      '/agenda/limpar-tudo': limparTudo,
    },
    cron,
  };
}

/* ----- Rotas ----- */

async function estado(contexto) {
  const { uid } = await apoio.quemChamou(contexto);
  return estadoAtual(contexto.env, uid);
}

async function conectar(contexto) {
  const { env, corpo } = contexto;
  const { uid } = await apoio.quemChamou(contexto);
  const cliente = clienteGoogle(env);
  const codigo = String(corpo.codigo || '');
  if (!codigo || codigo.length > 2048) throw new apoio.Falha(400, 'Autorização do Google não recebida. Tente de novo.');

  const orc = novoOrcamento();
  const bd = banco(env, orc);
  const resposta = await google(orc, TOKEN_GOOGLE, {
    method: 'POST',
    headers: FORMULARIO,
    body: new URLSearchParams({
      code: codigo,
      client_id: cliente.id,
      client_secret: cliente.segredo,
      redirect_uri: 'postmessage', // janela do Google Identity Services (modo popup)
      grant_type: 'authorization_code',
    }),
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok || !dados.access_token) {
    console.error('agenda/conectar', resposta.status, dados.error, dados.error_description);
    throw new apoio.Falha(400, 'O Google não confirmou a autorização. Tente conectar de novo.');
  }
  if (!String(dados.scope || '').split(' ').includes(ESCOPO_AGENDA)) {
    await revogar(orc, dados.refresh_token || dados.access_token).catch(() => {});
    throw new apoio.Falha(400, 'Para conectar, deixe marcada a permissão de criar a agenda do EscalaMed e gerenciar os eventos dela.');
  }

  const atual = await bd.um('SELECT renovacao FROM agenda_contas WHERE uid = ?1', uid);
  if (!dados.refresh_token && !atual) {
    // O Google só manda o token de renovação na primeira autorização
    await revogar(orc, dados.access_token).catch(() => {});
    throw new apoio.Falha(400, 'O Google não liberou o acesso contínuo à agenda. Tente conectar de novo.');
  }
  const renovacao = dados.refresh_token ? await cifrar(env, dados.refresh_token) : atual.renovacao;
  await bd.rodar(
    `INSERT INTO agenda_contas (uid, renovacao, acesso, acesso_ate, fuso, pendente, conectado_em)
     VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)
     ON CONFLICT (uid) DO UPDATE SET renovacao = ?2, acesso = ?3, acesso_ate = ?4, fuso = ?5, pendente = 1`,
    uid,
    renovacao,
    await cifrar(env, dados.access_token),
    Date.now() + (Number(dados.expires_in) || 3600) * 1000,
    fusoValido(corpo.fuso) || FUSO_PADRAO,
    Date.now(),
  );

  // Cria a agenda agora: se o Google recusar, a conexão não fica pela metade
  try {
    await enviar(env, uid, orc);
  } catch (erro) {
    console.error('agenda/conectar: criar a agenda', erro);
    await apagarConta(env, uid);
    throw new apoio.Falha(502, 'O Google não deixou criar a agenda do EscalaMed. Tente de novo em instantes.');
  }
  return estadoAtual(env, uid);
}

async function lembrete(contexto) {
  const { env, corpo } = contexto;
  const { uid } = await apoio.quemChamou(contexto);
  const minutos = Number(corpo.minutos);
  if (!LEMBRETES.includes(minutos)) throw new apoio.Falha(400, 'Escolha um dos lembretes da lista.');
  const orc = novoOrcamento();
  const bd = banco(env, orc);
  if (!(await bd.um('SELECT uid FROM agenda_contas WHERE uid = ?1', uid))) {
    throw new apoio.Falha(409, 'Conecte a Agenda Google primeiro.');
  }
  await bd.rodar('UPDATE agenda_contas SET lembrete = ?2, pendente = 1 WHERE uid = ?1', uid, minutos);
  await enviarSemFalhar(env, uid, orc);
  return estadoAtual(env, uid);
}

// Plantões publicados da própria pessoa nos meses informados (troca tudo desses meses)
async function meusPlantoes(contexto) {
  const { env, corpo } = contexto;
  const { uid } = await apoio.quemChamou(contexto);
  const orc = novoOrcamento();
  const bd = banco(env, orc);
  if (!(await bd.um('SELECT uid FROM agenda_contas WHERE uid = ?1', uid))) return { conectado: false };

  const meses = lerMeses(corpo.meses);
  const escalas = lerLista(corpo.escalas, 100)
    .map(lerEscala)
    .filter((escala) => meses.includes(escala.mes));
  const eventos = [];
  for (const escala of escalas) eventos.push(...(await eventosDaEscala(escala, new Set([uid]), app(env))));

  await bd.lote([
    ['DELETE FROM agenda_desejados WHERE uid = ?1 AND mes IN (SELECT value FROM json_each(?2))', uid, JSON.stringify(meses)],
    ...(eventos.length ? [inserirDesejados(eventos)] : []),
    ['UPDATE agenda_contas SET pendente = 1 WHERE uid = ?1', uid],
  ]);
  await enviarSemFalhar(env, uid, orc);
  return estadoAtual(env, uid);
}

// Cargo aprovado de quem chamou: 'dev' | 'gestor' | 'coordenador' | 'administrativo' | null.
// Mesma regra do firestore.rules: Dev acima de todos; administrador da plataforma vale como
// Gestor; os outros cargos só valem aprovados em access/{uid}.
const CARGO_DE_ACESSO = { gestor: 'gestor', 'coordenador-escala': 'coordenador', administrativo: 'administrativo' };

async function cargoDe(contexto, quem) {
  const { env, local } = contexto;
  if (await apoio.ehDev(env, quem.token, local)) return 'dev';
  if ((await apoio.lerAdmins(env, quem.token, local)).includes(quem.uid)) return 'gestor';
  const acesso = await apoio.lerDocumento(env, quem.token, `access/${quem.uid}`, local);
  if (acesso?.approved?.booleanValue !== true) return null;
  return CARGO_DE_ACESSO[acesso.categoryId?.stringValue] ?? null;
}

// Pode alterar a escala do grupo: Dev (qualquer grupo), Gestor (equipe), coordenador do grupo
// ou dono da escala individual
async function editaEscala(contexto, quem, campos) {
  if (campos.type?.stringValue === 'personal' && campos.ownerId?.stringValue === quem.uid) return true;
  const cargo = await cargoDe(contexto, quem);
  if (cargo === 'dev') return true;
  if (campos.type?.stringValue === 'personal') return false;
  return cargo === 'gestor' || (cargo === 'coordenador' && textos(campos.coordinatorIds).includes(quem.uid));
}

// Escala de um mês alterada pelo Gestor ou por um coordenador: atualiza a agenda de todos os escalados
async function grupo(contexto) {
  const { env, corpo, local } = contexto;
  const quem = await apoio.quemChamou(contexto);
  const grupoId = String(corpo.grupoId || '');
  const mes = String(corpo.mes || '');
  if (!ID.test(grupoId) || !MES.test(mes)) throw escalaInvalida();

  // Lido com o token de quem chamou: valem as regras do Firestore
  const campos = await apoio.lerDocumento(env, quem.token, `groups/${grupoId}`, local);
  if (!campos) throw new apoio.Falha(403, 'Grupo não encontrado.');
  if (!(await editaEscala(contexto, quem, campos))) {
    throw new apoio.Falha(403, 'Só o Gestor e os coordenadores do grupo atualizam a agenda da equipe.');
  }
  const membros = new Set(textos(campos.memberIds));
  const escala = lerEscala({
    grupoId,
    mes,
    nome: campos.name?.stringValue,
    local: localDoGrupo(campos.unit?.mapValue?.fields),
    fuso: campos.timezone?.stringValue,
    turnos: corpo.turnos ?? {},
    celulas: corpo.publicada === true ? corpo.celulas : {}, // rascunho: some da agenda
  });

  const orc = novoOrcamento();
  const bd = banco(env, orc);
  const escalados = [...new Set(Object.values(escala.celulas).flat())].filter((uid) => membros.has(uid));
  const conectados = escalados.length
    ? new Set(
        (await bd.todos('SELECT uid FROM agenda_contas WHERE uid IN (SELECT value FROM json_each(?1))', JSON.stringify(escalados))).map(
          (linha) => linha.uid,
        ),
      )
    : new Set();
  const antes = (await bd.todos('SELECT DISTINCT uid FROM agenda_desejados WHERE grupo = ?1 AND mes = ?2', grupoId, mes)).map(
    (linha) => linha.uid,
  );
  const afetados = [...new Set([...antes, ...conectados])];
  if (!afetados.length) return { pessoas: 0, emDia: 0 };

  const eventos = await eventosDaEscala(escala, conectados, app(env));
  await bd.lote([
    ['DELETE FROM agenda_desejados WHERE grupo = ?1 AND mes = ?2', grupoId, mes],
    ...(eventos.length ? [inserirDesejados(eventos)] : []),
    ['UPDATE agenda_contas SET pendente = 1 WHERE uid IN (SELECT value FROM json_each(?1))', JSON.stringify(afetados)],
  ]);

  // Envia agora o que der; o resto fica com o Cron
  let emDia = 0;
  for (const uid of afetados) {
    if (orc.restante < 8) break;
    if (await enviarSemFalhar(env, uid, orc)) emDia += 1;
  }
  return { pessoas: afetados.length, emDia };
}

async function desconectar(contexto) {
  const { env } = contexto;
  const { uid } = await apoio.quemChamou(contexto);
  const orc = novoOrcamento();
  const bd = banco(env, orc);
  const conta = await bd.um('SELECT * FROM agenda_contas WHERE uid = ?1', uid);
  if (conta) {
    try {
      const token = await tokenDeAcesso(env, bd, orc, conta);
      if (conta.calendario) {
        await google(orc, `${API_AGENDA}/calendars/${encodeURIComponent(conta.calendario)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
      }
      await revogar(orc, await decifrar(env, conta.renovacao));
    } catch (erro) {
      if (!(erro instanceof AcessoRevogado)) console.error('agenda/desconectar', erro);
    }
    await apagarConta(env, uid);
  }
  return { conectado: false };
}

// Dev apagou os dados da plataforma (Configurações > Apagar dados): nenhum plantão deve ficar
// nas agendas. Esvazia o que deveria estar e marca todo mundo como pendente; o Cron apaga os
// eventos no Google aos poucos. As contas conectadas continuam conectadas.
async function limparTudo(contexto) {
  const { env, local } = contexto;
  const quem = await apoio.quemChamou(contexto);
  if (!(await apoio.ehDev(env, quem.token, local))) throw new apoio.Falha(403, 'Só o Dev pode fazer isso.');
  const bd = banco(env, novoOrcamento());
  await bd.lote([['DELETE FROM agenda_desejados'], ['UPDATE agenda_contas SET pendente = 1']]);
  const { pessoas } = await bd.um('SELECT COUNT(*) AS pessoas FROM agenda_contas');
  return { pessoas };
}

// Cron: termina os envios pendentes, começando por quem esperou mais
async function cron(env) {
  const orc = novoOrcamento(45);
  const bd = banco(env, orc);
  const pendentes = await bd.todos('SELECT uid FROM agenda_contas WHERE pendente = 1 ORDER BY tentado_em LIMIT 20');
  for (const { uid } of pendentes) {
    if (orc.restante < 8) break;
    await enviarSemFalhar(env, uid, orc);
  }
}

/* ----- Envio ao Google ----- */

// Envia ao Google a diferença entre o que deveria estar na agenda e o que já está.
// Devolve true quando a agenda ficou em dia.
async function enviar(env, uid, orc) {
  const bd = banco(env, orc);
  try {
    const conta = await bd.um('SELECT * FROM agenda_contas WHERE uid = ?1', uid);
    if (!conta) return true;
    await bd.rodar('UPDATE agenda_contas SET tentado_em = ?2 WHERE uid = ?1', uid, Date.now());
    let token = await tokenDeAcesso(env, bd, orc, conta);
    if (!conta.calendario) await criarCalendario(bd, orc, conta, token);

    for (let rodada = 0; rodada < 10; rodada += 1) {
      const operacoes = await diferenca(bd, conta);
      if (!operacoes.length) {
        await bd.rodar('UPDATE agenda_contas SET pendente = 0, sincronizado_em = ?2 WHERE uid = ?1', uid, Date.now());
        return true;
      }
      if (orc.restante < 4) break; // lote + gravações
      const lote = operacoes.slice(0, POR_LOTE);
      const status = await enviarLote(orc, token, conta, lote);
      if (!status) {
        // Token recusado: pede outro
        conta.acesso_ate = 0;
        token = await tokenDeAcesso(env, bd, orc, conta);
        continue;
      }
      // Criar evento só dá 404 quando a agenda não existe mais (a pessoa apagou no Google)
      if (lote.some((op, i) => op.tipo === 'criar' && status[i] === 404)) {
        await criarCalendario(bd, orc, conta, token);
        continue;
      }
      if (!(await registrarLote(bd, uid, lote, status))) break; // nada passou: tenta no próximo Cron
    }
  } catch (erro) {
    if (erro instanceof AcessoRevogado) {
      // A pessoa tirou o acesso do EscalaMed na conta Google: fica desconectada
      await apagarConta(env, uid);
      return true;
    }
    if (!(erro instanceof SemOrcamento)) throw erro;
  }
  return false;
}

async function enviarSemFalhar(env, uid, orc) {
  try {
    return await enviar(env, uid, orc);
  } catch (erro) {
    console.error(`agenda: envio de ${uid}`, erro);
    return false;
  }
}

// Operações para deixar a agenda igual ao desejado: criar, atualizar e apagar
async function diferenca(bd, conta) {
  const desejados = await bd.todos('SELECT evento, dados FROM agenda_desejados WHERE uid = ?1', conta.uid);
  const enviados = new Map(
    (await bd.todos('SELECT evento, assinatura FROM agenda_enviados WHERE uid = ?1', conta.uid)).map((linha) => [linha.evento, linha.assinatura]),
  );
  const operacoes = [];
  for (const { evento, dados } of desejados) {
    const assinatura = resumo(`${conta.lembrete}|${dados}`);
    const atual = enviados.get(evento);
    enviados.delete(evento);
    if (atual === assinatura) continue;
    operacoes.push({ tipo: atual === undefined ? 'criar' : 'atualizar', evento, dados, assinatura });
  }
  for (const evento of enviados.keys()) operacoes.push({ tipo: 'apagar', evento });
  return operacoes;
}

// Um lote multipart da API do Google Agenda. Devolve o status HTTP de cada operação,
// ou null se o token foi recusado.
async function enviarLote(orc, token, conta, lote) {
  const fronteira = `escalamed${crypto.randomUUID().replace(/-/g, '')}`;
  const base = `/calendar/v3/calendars/${encodeURIComponent(conta.calendario)}/events`;
  let corpo = '';
  lote.forEach((op, i) => {
    corpo += `--${fronteira}\r\nContent-Type: application/http\r\nContent-ID: <op${i}>\r\n\r\n`;
    if (op.tipo === 'apagar') {
      corpo += `DELETE ${base}/${op.evento} HTTP/1.1\r\n\r\n`;
    } else {
      const linha = op.tipo === 'criar' ? `POST ${base}` : `PUT ${base}/${op.evento}`;
      const evento = JSON.stringify(corpoDoEvento(op.evento, op.dados, conta.lembrete));
      corpo += `${linha} HTTP/1.1\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${evento}\r\n`;
    }
  });
  corpo += `--${fronteira}--\r\n`;

  const resposta = await google(orc, LOTE_AGENDA, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/mixed; boundary=${fronteira}` },
    body: corpo,
  });
  if (resposta.status === 401) return null;
  if (!resposta.ok) throw new Error(`Lote da agenda: ${resposta.status} ${await resposta.text()}`);
  const status = lerLote(resposta.headers.get('Content-Type'), await resposta.text(), lote.length);
  return status.every((s) => s === 401) ? null : status;
}

// Resposta multipart do lote: status de cada operação, na ordem do pedido (0 = sem resposta)
export function lerLote(tipo, texto, total) {
  const status = new Array(total).fill(0);
  const fronteira = /boundary="?([^";]+)"?/i.exec(tipo || '')?.[1];
  if (!fronteira) return status;
  for (const parte of texto.split(`--${fronteira}`)) {
    const id = /Content-ID:\s*<response-op(\d+)>/i.exec(parte);
    const http = /HTTP\/[\d.]+\s+(\d{3})/.exec(parte);
    if (id && http && Number(id[1]) < total) status[Number(id[1])] = Number(http[1]);
  }
  return status;
}

// Grava o resultado do lote em agenda_enviados. Devolve false se nada passou.
async function registrarLote(bd, uid, lote, status) {
  const gravar = [];
  const tirar = [];
  lote.forEach((op, i) => {
    const s = status[i];
    if (op.tipo === 'criar') {
      if (s === 200 || s === 201) gravar.push([op.evento, op.assinatura]);
      else if (s === 409) gravar.push([op.evento, '']); // já existia (talvez apagado): regrava na próxima rodada
    } else if (op.tipo === 'atualizar') {
      if (s === 200) gravar.push([op.evento, op.assinatura]);
      else if (s === 404 || s === 410) tirar.push(op.evento); // sumiu: cria de novo
    } else if ([200, 204, 404, 410].includes(s)) {
      tirar.push(op.evento);
    }
  });
  const falhas = lote.length - gravar.length - tirar.length;
  if (falhas) console.error(`agenda: ${falhas} de ${lote.length} operações recusadas (${[...new Set(status)].join(', ')})`);
  const comandos = [];
  if (gravar.length) {
    comandos.push([
      `INSERT INTO agenda_enviados (uid, evento, assinatura)
       SELECT ?1, json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?2) WHERE true
       ON CONFLICT (uid, evento) DO UPDATE SET assinatura = excluded.assinatura`,
      uid,
      JSON.stringify(gravar),
    ]);
  }
  if (tirar.length) {
    comandos.push(['DELETE FROM agenda_enviados WHERE uid = ?1 AND evento IN (SELECT value FROM json_each(?2))', uid, JSON.stringify(tirar)]);
  }
  if (comandos.length) await bd.lote(comandos);
  return comandos.length > 0;
}

async function criarCalendario(bd, orc, conta, token) {
  const resposta = await google(orc, `${API_AGENDA}/calendars`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: 'EscalaMed',
      description: 'Seus plantões no EscalaMed. O app atualiza esta agenda sozinho: mudanças feitas aqui podem ser desfeitas.',
      timeZone: conta.fuso || FUSO_PADRAO,
    }),
  });
  if (!resposta.ok) throw new Error(`Criar agenda: ${resposta.status} ${await resposta.text()}`);
  conta.calendario = (await resposta.json()).id;
  await bd.lote([
    ['UPDATE agenda_contas SET calendario = ?2 WHERE uid = ?1', conta.uid, conta.calendario],
    ['DELETE FROM agenda_enviados WHERE uid = ?1', conta.uid],
  ]);
}

// Token de acesso do Google (vale 1 hora), renovado com o token de renovação
async function tokenDeAcesso(env, bd, orc, conta) {
  if (conta.acesso && conta.acesso_ate > Date.now() + 60000) {
    const guardadoNoBanco = await decifrar(env, conta.acesso).catch(() => '');
    if (guardadoNoBanco) return guardadoNoBanco;
  }
  const cliente = clienteGoogle(env);
  const renovacao = await decifrar(env, conta.renovacao).catch(() => {
    throw new AcessoRevogado(); // segredo trocado: não dá mais para ler
  });
  const resposta = await google(orc, TOKEN_GOOGLE, {
    method: 'POST',
    headers: FORMULARIO,
    body: new URLSearchParams({
      client_id: cliente.id,
      client_secret: cliente.segredo,
      refresh_token: renovacao,
      grant_type: 'refresh_token',
    }),
  });
  const dados = await resposta.json().catch(() => ({}));
  if (dados.error === 'invalid_grant') throw new AcessoRevogado();
  if (!resposta.ok || !dados.access_token) throw new Error(`Token da agenda: ${resposta.status} ${dados.error || ''}`);
  conta.acesso = await cifrar(env, dados.access_token);
  conta.acesso_ate = Date.now() + (Number(dados.expires_in) || 3600) * 1000;
  await bd.rodar('UPDATE agenda_contas SET acesso = ?2, acesso_ate = ?3 WHERE uid = ?1', conta.uid, conta.acesso, conta.acesso_ate);
  return dados.access_token;
}

const revogar = (orc, token) => google(orc, REVOGAR_GOOGLE, { method: 'POST', headers: FORMULARIO, body: new URLSearchParams({ token }) });

async function apagarConta(env, uid) {
  await banco(env, novoOrcamento(3)).lote([
    ['DELETE FROM agenda_desejados WHERE uid = ?1', uid],
    ['DELETE FROM agenda_enviados WHERE uid = ?1', uid],
    ['DELETE FROM agenda_contas WHERE uid = ?1', uid],
  ]);
}

async function estadoAtual(env, uid) {
  const conta = await banco(env, novoOrcamento(1)).um(
    'SELECT lembrete, pendente, sincronizado_em FROM agenda_contas WHERE uid = ?1',
    uid,
  );
  if (!conta) return { conectado: false };
  return { conectado: true, lembrete: conta.lembrete, pendente: conta.pendente === 1, sincronizadoEm: conta.sincronizado_em };
}

/* ----- Eventos ----- */

// Eventos de uma escala para as pessoas de "uids" (Set): [{ uid, evento, grupo, mes, dados }]
export async function eventosDaEscala(escala, uids, enderecoApp = APP_PADRAO) {
  const { grupoId, mes, turnos, celulas } = escala;
  const [ano, numero] = mes.split('-').map(Number);
  const diasNoMes = new Date(Date.UTC(ano, numero, 0)).getUTCDate();
  const eventos = [];
  for (const [chave, pessoas] of Object.entries(celulas)) {
    const [, diaTexto, turnoId] = CELULA.exec(chave) || [];
    const dia = Number(diaTexto);
    const turno = turnos[turnoId];
    if (!turno || !(dia >= 1 && dia <= diasNoMes)) continue;
    for (const uid of new Set(pessoas)) {
      if (!uids.has(uid)) continue;
      eventos.push({
        uid,
        evento: await idDoEvento(uid, grupoId, mes, chave),
        grupo: grupoId,
        mes,
        dados: JSON.stringify(dadosDoEvento(escala, dia, turno, enderecoApp)),
      });
    }
  }
  return eventos;
}

// O plantão pertence ao dia em que começa; fim menor ou igual ao início = termina no dia seguinte
export function dadosDoEvento({ grupoId, mes, nome, local, fuso }, dia, turno, enderecoApp = APP_PADRAO) {
  const [ano, numero] = mes.split('-').map(Number);
  const duracao = turno.fim > turno.inicio ? turno.fim - turno.inicio : 1440 - turno.inicio + turno.fim;
  const data = `${mes}-${dois(dia)}`;
  const link = `${enderecoApp}/group.html?id=${encodeURIComponent(grupoId)}&dia=${data}`;
  return {
    titulo: `Plantão ${turno.titulo} · ${nome}`,
    local,
    descricao: `${turno.titulo}: ${relogio(turno.inicio)} às ${relogio(turno.fim)} (${horas(duracao)})\nEscala: ${nome}\n\nVer no EscalaMed: ${link}`,
    inicio: horaLocal(ano, numero, dia, turno.inicio),
    fim: horaLocal(ano, numero, dia, turno.inicio + duracao),
    fuso,
    link,
  };
}

// Corpo do evento na API do Google Agenda
export function corpoDoEvento(evento, dados, lembrete) {
  const d = JSON.parse(dados);
  return {
    id: evento,
    status: 'confirmed',
    summary: d.titulo,
    ...(d.local ? { location: d.local } : {}),
    description: d.descricao,
    start: { dateTime: d.inicio, timeZone: d.fuso },
    end: { dateTime: d.fim, timeZone: d.fuso },
    reminders: { useDefault: false, overrides: lembrete ? [{ method: 'popup', minutes: lembrete }] : [] },
    source: { title: 'EscalaMed', url: d.link },
  };
}

// Id fixo por pessoa, grupo, mês e célula (o Google aceita letras a-v e números)
async function idDoEvento(...partes) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(partes.join('|')));
  return [...new Uint8Array(hash).slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const dois = (n) => String(n).padStart(2, '0');
const relogio = (minutos) => `${dois(Math.floor(minutos / 60) % 24)}h${dois(minutos % 60)}`;
const horas = (minutos) => (minutos % 60 ? `${Math.floor(minutos / 60)}h${dois(minutos % 60)}` : `${minutos / 60}h`);

// Data e hora "de parede" (sem fuso): o Google aplica o fuso do grupo
function horaLocal(ano, mes, dia, minutos) {
  const d = new Date(Date.UTC(ano, mes - 1, dia, 0, minutos));
  return `${d.getUTCFullYear()}-${dois(d.getUTCMonth() + 1)}-${dois(d.getUTCDate())}T${dois(d.getUTCHours())}:${dois(d.getUTCMinutes())}:00`;
}

// Resumo curto de um texto (detecta mudança no evento sem guardar o conteúdo duas vezes)
function resumo(texto) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

/* ----- Leitura do que o app manda ----- */

const escalaInvalida = () => new apoio.Falha(400, 'Dados da escala inválidos.');

function lerLista(valor, maximo) {
  if (valor === undefined) return [];
  if (!Array.isArray(valor) || valor.length > maximo) throw escalaInvalida();
  return valor;
}

function lerMeses(valor) {
  const meses = lerLista(valor, 12);
  if (!meses.length || meses.some((mes) => typeof mes !== 'string' || !MES.test(mes))) throw escalaInvalida();
  return meses;
}

const textoCurto = (valor, maximo) => (typeof valor === 'string' ? valor.trim().slice(0, maximo) : '');
const minuto = (valor) => (Number.isInteger(valor) && valor >= 0 && valor < 1440 ? valor : null);
const objeto = (valor) => valor && typeof valor === 'object' && !Array.isArray(valor);

// { grupoId, mes, nome, local, fuso, turnos: { id: { titulo, inicio, fim } }, celulas: { "07_<turno>": [uid] } }
export function lerEscala(bruta) {
  if (!objeto(bruta)) throw escalaInvalida();
  const grupoId = String(bruta.grupoId || '');
  const mes = String(bruta.mes || '');
  if (!ID.test(grupoId) || !MES.test(mes)) throw escalaInvalida();

  if (!objeto(bruta.turnos) || Object.keys(bruta.turnos).length > 50) throw escalaInvalida();
  const turnos = {};
  for (const [id, turno] of Object.entries(bruta.turnos)) {
    const titulo = textoCurto(turno?.titulo, 60);
    const inicio = minuto(turno?.inicio);
    const fim = minuto(turno?.fim);
    if (!ID.test(id) || !titulo || inicio === null || fim === null) throw escalaInvalida();
    turnos[id] = { titulo, inicio, fim };
  }

  const celulasBrutas = bruta.celulas ?? {};
  if (!objeto(celulasBrutas) || Object.keys(celulasBrutas).length > 1500) throw escalaInvalida();
  const celulas = {};
  for (const [chave, uids] of Object.entries(celulasBrutas)) {
    if (!CELULA.test(chave) || !Array.isArray(uids) || uids.length > 300) throw escalaInvalida();
    if (uids.some((uid) => typeof uid !== 'string' || !ID.test(uid))) throw escalaInvalida();
    if (uids.length) celulas[chave] = uids;
  }

  return {
    grupoId,
    mes,
    nome: textoCurto(bruta.nome, 120) || 'Escala',
    local: textoCurto(bruta.local, 200),
    fuso: fusoValido(bruta.fuso) || FUSO_PADRAO,
    turnos,
    celulas,
  };
}

function fusoValido(fuso) {
  if (typeof fuso !== 'string' || !fuso || fuso.length > 60) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: fuso });
    return fuso;
  } catch {
    return null;
  }
}

const textos = (campo) => (campo?.arrayValue?.values || []).map((v) => v.stringValue).filter(Boolean);

// "Hospital Antonio Prudente, Fortaleza/CE" (mesmo formato do app, em gcal-data.js)
function localDoGrupo(unidade) {
  if (!unidade) return '';
  const nome = unidade.name?.stringValue || '';
  const cidade = unidade.city?.stringValue || '';
  const uf = unidade.state?.stringValue || '';
  return [nome, cidade && uf ? `${cidade}/${uf}` : cidade].filter(Boolean).join(', ');
}

const inserirDesejados = (eventos) => [
  `INSERT OR REPLACE INTO agenda_desejados (uid, evento, grupo, mes, dados)
   SELECT json_extract(value, '$.uid'), json_extract(value, '$.evento'), json_extract(value, '$.grupo'),
          json_extract(value, '$.mes'), json_extract(value, '$.dados')
   FROM json_each(?1)`,
  JSON.stringify(eventos),
];

/* ----- Apoio ----- */

const app = (env) => String(env.APP || APP_PADRAO).replace(/\/+$/, '');

function clienteGoogle(env) {
  if (!env.GOOGLE_CLIENTE || !env.GOOGLE_SEGREDO) {
    throw new apoio.Falha(503, 'A Agenda Google ainda não foi configurada no servidor.');
  }
  return { id: env.GOOGLE_CLIENTE, segredo: env.GOOGLE_SEGREDO };
}

const novoOrcamento = (total = ORCAMENTO) => ({ restante: total });

function gastar(orc, quanto = 1) {
  if (orc.restante < quanto) throw new SemOrcamento();
  orc.restante -= quanto;
}

function google(orc, url, opcoes) {
  gastar(orc);
  return fetch(url, opcoes);
}

// D1 contando as consultas no orçamento. lote: vários comandos numa transação.
function banco(env, orc) {
  const preparar = ([sql, ...valores]) => env.DB.prepare(sql).bind(...valores);
  return {
    um(sql, ...valores) {
      gastar(orc);
      return preparar([sql, ...valores]).first();
    },
    async todos(sql, ...valores) {
      gastar(orc);
      return (await preparar([sql, ...valores]).all()).results || [];
    },
    rodar(sql, ...valores) {
      gastar(orc);
      return preparar([sql, ...valores]).run();
    },
    lote(comandos) {
      gastar(orc, comandos.length);
      return env.DB.batch(comandos.map(preparar));
    },
  };
}

/* ----- Criptografia dos tokens (AES-GCM, chave derivada de GOOGLE_SEGREDO) ----- */

const guardado = { chave: null, segredo: '' };
const bytes = (texto) => new TextEncoder().encode(texto);

async function chaveDosTokens(env) {
  const { segredo } = clienteGoogle(env);
  if (guardado.chave && guardado.segredo === segredo) return guardado.chave;
  const base = await crypto.subtle.importKey('raw', bytes(segredo), 'HKDF', false, ['deriveKey']);
  guardado.chave = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: bytes('escalamed-agenda'), info: bytes('tokens') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  guardado.segredo = segredo;
  return guardado.chave;
}

async function cifrar(env, texto) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await chaveDosTokens(env), bytes(texto)));
  const junto = new Uint8Array(iv.length + cifrado.length);
  junto.set(iv);
  junto.set(cifrado, iv.length);
  let binario = '';
  for (const b of junto) binario += String.fromCharCode(b);
  return btoa(binario);
}

async function decifrar(env, valor) {
  const junto = Uint8Array.from(atob(valor), (c) => c.charCodeAt(0));
  const texto = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: junto.slice(0, 12) },
    await chaveDosTokens(env),
    junto.slice(12),
  );
  return new TextDecoder().decode(texto);
}
