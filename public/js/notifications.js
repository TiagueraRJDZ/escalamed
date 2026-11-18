// Notificações (sininho do topo), em tempo real em todas as páginas:
//  - convites para grupos que a pessoa recebeu (Aceitar / Recusar);
//  - convites que ela mandou e foram aceitos ou recusados (Dispensar);
//  - avisos dela (users/{uid}/notices), como o cargo alterado por um Gestor (Dispensar);
//  - pedidos de plantão vago esperando resposta, para o Gestor e o coordenador do grupo
//    (Aceitar / Recusar), e as respostas aos pedidos da própria pessoa (Dispensar);
//  - cessões direcionadas: para a coordenação aprovar (Aprovar / Recusar), a resposta para quem
//    cedeu e o aviso para o colega que recebe (Dispensar).
// O sininho mostra quantas há; o que chega com a página aberta também vira um aviso.
// A tela de Escalas usa a mesma lista de convites (onInvitesChange) para os cartões.
// No topo da gaveta: as notificações push neste aparelho (push.js), para os mesmos avisos
// chegarem no celular com o app fechado.
import { collection, deleteDoc, doc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db } from './firebase.js';
import { listenWithRetry } from './live.js';
import { icon } from './icons.js';
import { pushStatus, enablePush, disablePush, dismissPush, resetPushChoice, sendTestPush, sendTestPushToAll, setAppBadge } from './push.js';
import { escapeHtml, toast, setLoading, firebaseErrorMessage, confirmDialog } from './ui.js';
import {
  watchMyInvites,
  watchAnsweredInvites,
  acceptInvite,
  declineInvite,
  cancelInvite,
  inviteKey,
  isAccepted,
} from './members.js';
import { watchMyGroups } from './my-groups.js';
import { can } from './permissions.js';
import { watchMyRequests, watchGroupRequests, removeRequest, answerRequest, requestShiftText, requestDayLink } from './vacancy-requests.js';
import { watchMyCessions, watchGroupCessions, dismissCession, answerCession } from './cession-requests.js';

let invites = []; // recebidos, pendentes
let answered = []; // mandados e respondidos (aceitos ou recusados)
let notices = []; // avisos da própria pessoa (ex.: cargo alterado)
let vacancyAnswers = []; // respostas aos pedidos de plantão vago da própria pessoa
let vacancyPending = []; // pedidos esperando resposta nos grupos em que a pessoa altera a escala
const vacancyGroups = new Map(); // groupId → grupo (para saber se quem pediu ainda está nele)
let cessionNotes = []; // cessões que eu pedi (já respondidas) e as pedidas para mim
let cessionPending = []; // cessões esperando a coordenação nos grupos em que a pessoa altera a escala
// Avisos e respostas já vistos (clicados), guardados em notificationReads/{uid} para valer em
// todos os aparelhos. Convite recebido não entra: fica destacado até ser respondido.
let seen = new Set();
let ready = false;
let session = null; // { app, user, profile }
const listeners = new Set();

// cb(lista de convites recebidos) agora (se já carregou) e a cada mudança
export function onInvitesChange(cb) {
  listeners.add(cb);
  if (ready) cb(invites);
  return () => listeners.delete(cb);
}

// Aceita ou recusa. Sai da lista sozinho (a leitura em tempo real percebe a mudança).
export async function respondInvite(invite, accept) {
  const { user, profile } = session;
  try {
    if (accept) {
      await acceptInvite(invite.groupId, invite, user, profile);
      toast(`Você entrou no grupo ${invite.groupName}.`, 'success');
    } else {
      await declineInvite(invite.groupId, invite, profile?.name);
      toast('Convite recusado. Quem convidou vai ser avisado.');
    }
    return true;
  } catch (error) {
    toast(
      accept && error.code === 'permission-denied'
        ? 'Não foi possível entrar: o cargo do convite pode ter atingido o limite. Peça um novo convite.'
        : firebaseErrorMessage(error),
      'error',
    );
    return false;
  }
}

// "Erick convidou você para o grupo · Hospital Luís de França"
export const inviteText = (invite) =>
  `${escapeHtml(invite.invitedByName)} convidou você para o grupo${invite.unitName ? ` · ${escapeHtml(invite.unitName)}` : ''}`;

// "Otávio Novo aceitou o convite para UTI Adulto" / "... recusou o convite ..."
const answerer = (inv) => inv.respondedByName ?? inv.name ?? inv.email ?? 'Alguém';
const answerVerb = (inv) => (isAccepted(inv) ? 'aceitou' : 'recusou');
const answeredText = (inv) =>
  `<strong>${escapeHtml(answerer(inv))}</strong> ${answerVerb(inv)} o convite para
  <strong>${escapeHtml(inv.groupName)}</strong>`;

// Respostas aos pedidos de plantão vago
const vacancyAnswerText = (r) => {
  const where = `<strong>${escapeHtml(r.groupName ?? 'o grupo')}</strong>`;
  if (r.status === 'approved') {
    return `<strong>${escapeHtml(r.decidedByName ?? 'A coordenação')}</strong> aceitou seu pedido: você está no plantão ${requestShiftText(r)} em ${where}`;
  }
  if (r.reason === 'filled') return `As vagas do plantão ${requestShiftText(r)} em ${where} foram preenchidas`;
  return `<strong>${escapeHtml(r.decidedByName ?? 'A coordenação')}</strong> recusou seu pedido para o plantão ${requestShiftText(r)} em ${where}`;
};

const vacancyPendingText = (r) =>
  `<strong>${escapeHtml(r.name ?? 'Alguém')}</strong> pediu o plantão vago ${requestShiftText(r)} em <strong>${escapeHtml(r.groupName ?? 'um grupo')}</strong>`;

const stillMember = (r) => vacancyGroups.get(r.groupId)?.memberIds?.includes(r.uid) ?? true;

// Cessões: quem cedeu vê a resposta; o colega vê o pedido e a resposta
function cessionNoteText(c) {
  const where = `<strong>${escapeHtml(c.groupName ?? 'o grupo')}</strong>`;
  const by = `<strong>${escapeHtml(c.decidedByName ?? 'A coordenação')}</strong>`;
  if (c.mine) {
    return c.status === 'approved'
      ? `${by} aprovou: <strong>${escapeHtml(c.toName)}</strong> ficou com o seu plantão ${requestShiftText(c)} em ${where}`
      : `${by} recusou a cessão do seu plantão ${requestShiftText(c)} para ${escapeHtml(c.toName)} em ${where}. Você continua no plantão`;
  }
  const from = `<strong>${escapeHtml(c.name)}</strong>`;
  if (c.status === 'pending') return `${from} quer ceder para você o plantão ${requestShiftText(c)} em ${where}. A coordenação vai aprovar ou recusar`;
  if (c.status === 'approved') return `Você ficou com o plantão ${requestShiftText(c)} em ${where}, cedido por ${from} (aprovado por ${by})`;
  return `${by} recusou a cessão do plantão ${requestShiftText(c)} de ${from} para você em ${where}`;
}

const cessionPendingText = (c) =>
  `<strong>${escapeHtml(c.name ?? 'Alguém')}</strong> quer ceder o plantão ${requestShiftText(c)} para <strong>${escapeHtml(c.toName)}</strong> em <strong>${escapeHtml(c.groupName ?? 'um grupo')}</strong>`;

const cessionIcon = (c) => (c.status === 'approved' ? 'check' : c.status === 'declined' ? 'x' : 'arrowRight');
const cessionTone = (c) => (c.status === 'approved' ? ' is-accepted' : c.status === 'declined' ? ' is-declined' : ' is-notice');

const noticeText = (n) =>
  n.type === 'role'
    ? `<strong>${escapeHtml(n.byName ?? 'Um Gestor')}</strong> alterou seu cargo para <strong>${escapeHtml(n.categoryName ?? 'outro cargo')}</strong>`
    : 'Você tem um aviso novo';

const whenText = (ts) => {
  const date = ts?.toDate?.();
  return date ? date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
};

const isUnread = (item) => !seen.has(item.id);

// Marca e desmarca: no aviso visto, a cor de destaque some e o número do sininho diminui
const readClass = (item) => (isUnread(item) ? '' : ' is-read');
const unreadLabel = (item) => (isUnread(item) ? '<span class="sr-only">Não lida. </span>' : '');

function renderBell() {
  const bell = session.app.querySelector('#notifications-button');
  const count =
    invites.length +
    vacancyPending.length +
    cessionPending.length +
    cessionNotes.filter(isUnread).length +
    answered.filter(isUnread).length +
    notices.filter(isUnread).length +
    vacancyAnswers.filter(isUnread).length;
  let badge = bell.querySelector('.bell-count');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'bell-count';
    badge.setAttribute('aria-hidden', 'true');
    bell.append(badge);
  }
  badge.textContent = count > 9 ? '9+' : String(count);
  badge.hidden = count === 0;
  setAppBadge(count); // o mesmo número no ícone do app (celular), onde o sistema suporta
  const label = count ? `Notificações (${count} ${count === 1 ? 'nova' : 'novas'})` : 'Notificações';
  bell.setAttribute('aria-label', label);
  bell.title = label;
}

// Filtros da gaveta: convites recebidos contam como "Grupos"; respostas (aceite ou recusa),
// como "Gestão" e "Grupos"
function pressedFilters() {
  return [...document.querySelectorAll('#drawer-notifications .chip[aria-pressed="true"]')].map((c) => c.dataset.filter);
}

function renderDrawer() {
  const list = document.getElementById('notifications-list');
  if (!list) return;
  const filters = pressedFilters();
  const showInvites = !filters.length || filters.includes('groups');
  const showAnswered = !filters.length || filters.includes('groups') || filters.includes('management');
  const received = showInvites ? invites : [];
  const replies = showAnswered ? answered : [];
  const mine = !filters.length || filters.includes('management') ? notices : [];
  const showShifts = !filters.length || filters.includes('shifts');
  const toAnswer = showShifts || filters.includes('management') ? vacancyPending : [];
  const myAnswers = showShifts ? vacancyAnswers : [];
  const toApprove = showShifts || filters.includes('management') ? cessionPending : [];
  const myCessionNotes = showShifts ? cessionNotes : [];

  // Gestor e coordenador: "Bruno quer ceder o plantão ... para Ana em UTI"
  const toApproveHtml = toApprove.length
    ? `<h3 class="section-title">Cessões para aprovar</h3>
      <ul class="notification-list">${toApprove
        .map(
          (c) => `<li class="notification-item" data-id="${escapeHtml(c.path)}">
          <span class="notification-icon" aria-hidden="true">${icon('arrowRight')}</span>
          <div class="notification-text">
            <span class="notification-sentence">${cessionPendingText(c)}</span>
            <small>${whenText(c.createdAt)}</small>
            <div class="notification-actions">
              <a class="btn btn-ghost" href="${requestDayLink(c)}">Ver o dia</a>
              <button type="button" class="btn btn-secondary" data-cession-answer="no">Recusar</button>
              <button type="button" class="btn btn-primary" data-cession-answer="yes">Aprovar</button>
            </div>
          </div>
        </li>`,
        )
        .join('')}</ul>`
    : '';

  const cessionNotesHtml = myCessionNotes.length
    ? `<h3 class="section-title">Cessões de plantão</h3>
      <ul class="notification-list">${myCessionNotes
        .map(
          (c) => `<li class="notification-item${cessionTone(c)}${readClass(c)}" data-id="${escapeHtml(c.id)}" data-readable>
          <span class="notification-icon" aria-hidden="true">${icon(cessionIcon(c))}</span>
          <div class="notification-text">
            <span class="notification-sentence">${unreadLabel(c)}${cessionNoteText(c)}</span>
            <small>${whenText(c.decidedAt ?? c.createdAt)}</small>
            <div class="notification-actions">
              <a class="btn btn-ghost" href="${requestDayLink(c)}">Ver o dia</a>
              <button type="button" class="btn btn-ghost" data-dismiss>Dispensar</button>
            </div>
          </div>
        </li>`,
        )
        .join('')}</ul>`
    : '';

  // Gestor e coordenador: "Ana pediu o plantão vago Noturno de 07/11 (19h00 às 01h00) em UTI"
  const toAnswerHtml = toAnswer.length
    ? `<h3 class="section-title">Pedidos de plantão vago</h3>
      <ul class="notification-list">${toAnswer
        .map(
          (r) => `<li class="notification-item" data-id="${escapeHtml(r.path)}">
          <span class="notification-icon" aria-hidden="true">${icon('hourglass')}</span>
          <div class="notification-text">
            <span class="notification-sentence">${vacancyPendingText(r)}${stillMember(r) ? '' : ' <span class="muted">(saiu do grupo)</span>'}</span>
            <small>${whenText(r.createdAt)}</small>
            <div class="notification-actions">
              <a class="btn btn-ghost" href="${requestDayLink(r)}">Ver o dia</a>
              <button type="button" class="btn btn-secondary" data-vacancy-answer="no">Recusar</button>
              ${stillMember(r) ? '<button type="button" class="btn btn-primary" data-vacancy-answer="yes">Aceitar</button>' : ''}
            </div>
          </div>
        </li>`,
        )
        .join('')}</ul>`
    : '';

  // Quem pediu: "Bruno aceitou seu pedido: você está no plantão ..."
  const myAnswersHtml = myAnswers.length
    ? `<h3 class="section-title">Respostas aos seus pedidos de plantão</h3>
      <ul class="notification-list">${myAnswers
        .map(
          (r) => `<li class="notification-item ${r.status === 'approved' ? 'is-accepted' : 'is-declined'}${readClass(r)}" data-id="${escapeHtml(r.id)}" data-readable>
          <span class="notification-icon" aria-hidden="true">${icon(r.status === 'approved' ? 'check' : 'x')}</span>
          <div class="notification-text">
            <span class="notification-sentence">${unreadLabel(r)}${vacancyAnswerText(r)}</span>
            <small>${whenText(r.decidedAt)}</small>
            <div class="notification-actions">
              <a class="btn btn-ghost" href="${requestDayLink(r)}">Ver o dia</a>
              <button type="button" class="btn btn-ghost" data-dismiss>Dispensar</button>
            </div>
          </div>
        </li>`,
        )
        .join('')}</ul>`
    : '';

  // "Ana Gestora alterou seu cargo para Médico"
  const noticesHtml = mine.length
    ? `<h3 class="section-title">Avisos</h3>
      <ul class="notification-list">${mine
        .map(
          (n) => `<li class="notification-item is-notice${readClass(n)}" data-id="${escapeHtml(n.id)}" data-readable>
          <span class="notification-icon" aria-hidden="true">${icon('userCheck')}</span>
          <div class="notification-text">
            <span class="notification-sentence">${unreadLabel(n)}${noticeText(n)}</span>
            <small>${whenText(n.createdAt)}</small>
            <div class="notification-actions">
              <a class="btn btn-ghost" href="/settings.html#profissional">Ver meu cargo</a>
              <button type="button" class="btn btn-ghost" data-dismiss>Dispensar</button>
            </div>
          </div>
        </li>`,
        )
        .join('')}</ul>`
    : '';

  const receivedHtml = received.length
    ? `<h3 class="section-title">Convites para grupos</h3>
      <ul class="notification-list">${received
        .map(
          (inv) => `<li class="notification-item" data-id="${escapeHtml(inv.id)}">
          <span class="notification-icon" aria-hidden="true">${icon('mail')}</span>
          <div class="notification-text">
            <strong>Convite para ${escapeHtml(inv.groupName)}</strong>
            <span>${inviteText(inv)}</span>
            <div class="notification-actions">
              <button type="button" class="btn btn-secondary" data-decline>Recusar</button>
              <button type="button" class="btn btn-primary" data-accept>Aceitar</button>
            </div>
          </div>
        </li>`,
        )
        .join('')}</ul>`
    : '';

  const repliesHtml = replies.length
    ? `<h3 class="section-title">Respostas aos seus convites</h3>
      <ul class="notification-list">${replies
        .map(
          (inv) => `<li class="notification-item ${isAccepted(inv) ? 'is-accepted' : 'is-declined'}${readClass(inv)}" data-id="${escapeHtml(inv.id)}" data-readable>
          <span class="notification-icon" aria-hidden="true">${icon(isAccepted(inv) ? 'check' : 'x')}</span>
          <div class="notification-text">
            <span class="notification-sentence">${unreadLabel(inv)}${answeredText(inv)}</span>
            <small>${whenText(inv.respondedAt)}</small>
            <div class="notification-actions">
              <button type="button" class="btn btn-ghost" data-dismiss>Dispensar</button>
            </div>
          </div>
        </li>`,
        )
        .join('')}</ul>`
    : '';

  // Limpar todas: avisos e respostas aos convites (os do filtro escolhido). Convite recebido
  // só sai respondendo.
  const clearable = mine.length + replies.length + myAnswers.length + myCessionNotes.length;
  const toolsHtml = clearable
    ? `<div class="notification-tools">
        <button type="button" class="btn btn-ghost" data-clear-all>${icon('trash')}Limpar todas</button>
      </div>`
    : '';

  list.innerHTML =
    noticesHtml || toAnswerHtml || toApproveHtml || receivedHtml || myAnswersHtml || cessionNotesHtml || repliesHtml
      ? toolsHtml + noticesHtml + toAnswerHtml + toApproveHtml + receivedHtml + myAnswersHtml + cessionNotesHtml + repliesHtml
      : `<h3 class="section-title">Não lidas</h3>
      <div class="empty-state">
        ${icon('bell')}
        <h3>Tudo em dia</h3>
        <p>Você não tem notificações novas. Avisaremos aqui sobre convites, trocas, cessões e plantões vagos.</p>
      </div>`;
}

function render() {
  renderBell();
  renderDrawer();
}

// Avisa o que chegou com a página aberta (não avisa o que já existia ao abrir).
// Devolve a função que recebe (lista, { synced }) e diz se a lista mudou.
function tracker(onNew) {
  let known = null;
  let signature = null;
  return (list, { synced }) => {
    if (known && synced) list.filter((item) => !known.has(item.id)).forEach(onNew);
    if (synced) known = new Set(list.map((item) => item.id));
    const next = list.map((item) => item.id).join('|');
    const changed = next !== signature;
    signature = next;
    return changed;
  };
}

// ---------- Notificações push neste aparelho (topo da gaveta) ----------
const onPhone = () => window.matchMedia('(pointer: coarse)').matches;

function pushCard({ tone = '', iconName, title, text, body = '', actions = '' }) {
  return `<div class="push-card${tone ? ` is-${tone}` : ''}">
    <span class="push-card-icon" aria-hidden="true">${icon(iconName)}</span>
    <div class="push-card-text">
      <strong>${title}</strong>
      ${text ? `<span>${text}</span>` : ''}
      ${body}
    </div>
    ${actions ? `<div class="push-card-actions">${actions}</div>` : ''}
  </div>`;
}

// Linha discreta (já decidido: ativo, dispensado ou bloqueado)
function pushLine({ tone = '', iconName, text, actions = '' }) {
  return `<div class="push-line${tone ? ` is-${tone}` : ''}">
    ${icon(iconName)}<span>${text}</span>${actions ? `<span class="push-line-actions">${actions}</span>` : ''}
  </div>`;
}

function pushPanelHtml(state) {
  const where = onPhone() ? 'no celular' : 'neste computador';
  if (state.support === 'unsupported') return '';
  const apple = /iPhone|iPod/.test(navigator.userAgent) ? 'iPhone' : 'iPad';
  if (state.support === 'ios-old') {
    return pushLine({ iconName: 'smartphone', text: `Para receber as notificações no ${apple}, atualize o sistema (iOS 16.4 ou mais novo).` });
  }
  if (state.support === 'ios-install') {
    if (state.dismissed) {
      return pushLine({
        iconName: 'smartphone',
        text: `Notificações no ${apple}: adicione o EscalaMed à Tela de Início.`,
        actions: '<button type="button" class="btn-link" data-push="howto">Como fazer</button>',
      });
    }
    return pushCard({
      iconName: 'smartphone',
      title: `Receba os avisos no seu ${apple}`,
      text: `No ${apple}, as notificações chegam pelo EscalaMed instalado na Tela de Início:`,
      body: `<ol class="push-steps">
        <li>No Safari, toque em ${icon('share')}<b>Compartilhar</b>.</li>
        <li>Escolha ${icon('plusSquare')}<b>Adicionar à Tela de Início</b>.</li>
        <li>Abra o EscalaMed pela Tela de Início e ative as notificações aqui no sininho.</li>
      </ol>`,
      actions: '<button type="button" class="btn btn-ghost" data-push="later">Agora não</button>',
    });
  }
  if (state.permission === 'denied') {
    return pushLine({
      tone: 'warning',
      iconName: 'bellOff',
      text: `Notificações bloqueadas ${where}. Libere nas configurações do navegador (permissões do site) e volte aqui.`,
    });
  }
  // Ativas: o aviso (com Testar e Desativar) só aparece para o Dev, que testa as notificações;
  // para os demais não aparece nada
  if (state.enabled) {
    if (!session.isDev) return '';
    return pushLine({
      tone: 'success',
      iconName: 'checkCircle',
      text: `Notificações ativas ${where}.`,
      actions: `<button type="button" class="btn-link" data-push="test">Testar</button>
        <button type="button" class="btn-link is-muted" data-push="disable">Desativar</button>`,
    });
  }
  if (state.dismissed) {
    return pushLine({
      iconName: 'bellOff',
      text: `Notificações ${where} desativadas.`,
      actions: '<button type="button" class="btn-link" data-push="enable">Ativar</button>',
    });
  }
  return pushCard({
    tone: 'primary',
    iconName: 'bellRing',
    title: `Receba os avisos ${where}`,
    text: 'Convites e respostas chegam na hora, mesmo com o EscalaMed fechado.',
    actions: `<button type="button" class="btn btn-primary" data-push="enable">${icon('bellRing')}Ativar notificações</button>
      <button type="button" class="btn btn-ghost" data-push="later">Agora não</button>`,
  });
}

// Só Dev: teste para todos os aparelhos ativos da plataforma (aparece mesmo sem push neste aparelho)
const devTestHtml = () =>
  session.isDev
    ? `<div class="push-dev">
        <span>${icon('megaphone')}Dev: testar o push em todas as contas ativas (celular e computador).</span>
        <button type="button" class="btn btn-secondary" data-push="test-all">${icon('bellRing')}Testar em todos os aparelhos</button>
      </div>`
    : '';

async function renderPushPanel() {
  const panel = document.getElementById('push-panel');
  if (!panel || !session) return;
  const state = await pushStatus(session.user.uid).catch(() => ({ support: 'unsupported' }));
  panel.innerHTML = pushPanelHtml(state) + devTestHtml();
  panel.hidden = !panel.innerHTML.trim();
}

async function testAllDevices() {
  const ok = await confirmDialog({
    title: 'Testar em todos os aparelhos?',
    message: 'Todas as pessoas com as notificações ativas vão receber "Teste de notificações", no celular e no computador.',
    confirmText: 'Enviar teste',
  });
  if (!ok) return;
  const { aparelhos, contas, enviados } = await sendTestPushToAll();
  if (!aparelhos) {
    toast('Nenhum aparelho está com as notificações ativas ainda.');
    return;
  }
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  const falhas = aparelhos - enviados;
  toast(
    `Teste enviado para ${plural(enviados, 'aparelho', 'aparelhos')} de ${plural(contas, 'conta', 'contas')}` +
      (falhas ? ` (${plural(falhas, 'aparelho não aceitou', 'aparelhos não aceitaram')}; os que saíram do serviço foram removidos).` : '.'),
    falhas ? 'info' : 'success',
    8000,
  );
}

function setupPushPanel() {
  const panel = document.getElementById('push-panel');
  if (!panel) return;
  renderPushPanel();
  // Abrir o sininho confere de novo (a permissão pode ter mudado nas configurações do aparelho)
  session.app.querySelector('#notifications-button')?.addEventListener('click', renderPushPanel);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && renderPushPanel());

  panel.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-push]');
    if (!button) return;
    const { uid } = session.user;
    const action = button.dataset.push;
    if (action === 'later') {
      dismissPush(uid);
      renderPushPanel();
      return;
    }
    if (action === 'howto') {
      resetPushChoice(uid);
      renderPushPanel();
      return;
    }
    setLoading(button, true);
    try {
      if (action === 'enable') {
        await enablePush(uid);
        toast('Pronto! Os avisos do sininho vão chegar neste aparelho.', 'success');
      } else if (action === 'disable') {
        await disablePush(uid);
        toast('Este aparelho não vai mais receber as notificações.');
      } else if (action === 'test') {
        await sendTestPush();
        toast('Notificação de teste enviada. Ela deve aparecer em alguns segundos.', 'success');
      } else if (action === 'test-all') {
        await testAllDevices();
      }
    } catch (error) {
      toast(error.message || 'Não foi possível concluir. Tente de novo.', 'error', 6000);
    }
    if (button.isConnected) setLoading(button, false);
    renderPushPanel();
  });
}

export function setupNotifications(app, user, profile, access = {}) {
  session = { app, user, profile, isDev: Boolean(access?.isDev) };
  setupPushPanel();

  const receivedChanged = tracker((inv) => toast(`Novo convite para ${inv.groupName}. Veja no sininho.`, 'info', 6000));
  watchMyInvites(user, (list, meta) => {
    // Só redesenha se a lista mudou (o Firestore também avisa quando só a origem dos dados muda)
    if (!receivedChanged(list, meta) && ready) return;
    invites = list;
    ready = true;
    render();
    listeners.forEach((cb) => cb(invites));
  });

  const answeredChanged = tracker((inv) =>
    toast(`${answerer(inv)} ${answerVerb(inv)} o convite para ${inv.groupName}.`, isAccepted(inv) ? 'success' : 'info', 6000),
  );
  watchAnsweredInvites(user.uid, (list, meta) => {
    if (!answeredChanged(list, meta)) return;
    answered = list;
    render();
  });

  // Avisos da própria pessoa, em tempo real (o mais novo primeiro). Cargo alterado não tem
  // toast: a sessão termina com uma janela explicando (auth.js: watchSession).
  const noticesChanged = tracker((n) => {
    if (n.type !== 'role') toast('Você tem um aviso novo.', 'info', 8000);
  });
  listenWithRetry(
    collection(db, 'users', user.uid, 'notices'),
    (snapshot) => {
      const list = snapshot.docs
        .map((d) => ({ id: d.ref.path, ...d.data({ serverTimestamps: 'estimate' }) }))
        .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
      if (!noticesChanged(list, { synced: !snapshot.metadata.fromCache })) return;
      notices = list;
      render();
    },
    'Avisos',
    { metadata: true },
  );

  // Respostas aos meus pedidos de plantão vago. O id leva a hora do pedido: pedir de novo
  // depois de uma recusa gera uma resposta nova (não lida).
  const vacancyAnswersChanged = tracker((r) =>
    toast(
      r.status === 'approved'
        ? `Pedido aceito: você está no plantão de ${r.shiftDate.slice(8)}/${r.shiftDate.slice(5, 7)} em ${r.groupName}.`
        : `Seu pedido de plantão vago em ${r.groupName} foi recusado.`,
      r.status === 'approved' ? 'success' : 'info',
      8000,
    ),
  );
  watchMyRequests(user.uid, (list, meta) => {
    const next = list
      .filter((r) => r.status === 'approved' || r.status === 'declined')
      .map((r) => ({ ...r, id: `${r.path}@${r.createdAt?.toMillis?.() ?? 0}` }));
    if (!vacancyAnswersChanged(next, meta)) return;
    vacancyAnswers = next;
    render();
  });

  // Cessões: as minhas já respondidas e as pedidas para mim (o id leva a situação: a aprovação
  // de uma cessão já vista volta como nova). Dispensada some só para quem dispensou.
  const cessionNotesChanged = tracker((c) => {
    let text;
    if (c.mine) text = c.status === 'approved' ? `Cessão aprovada: ${c.toName} ficou com o seu plantão.` : 'A coordenação recusou a sua cessão de plantão.';
    else if (c.status === 'pending') text = `${c.name} quer ceder um plantão para você. Veja no sininho.`;
    else if (c.status === 'approved') text = `Você ficou com o plantão cedido por ${c.name}.`;
    else text = `A coordenação recusou a cessão de ${c.name} para você.`;
    toast(text, c.status === 'approved' ? 'success' : 'info', 8000);
  });
  watchMyCessions(user.uid, ({ mine, toMe }, meta) => {
    const visible = (c) => !c.dismissedBy?.includes(user.uid);
    const note = (c, isMine) => ({ ...c, mine: isMine, id: `${c.path}@${c.createdAt?.toMillis?.() ?? 0}#${c.status}` });
    const when = (c) => (c.decidedAt ?? c.createdAt)?.toMillis?.() ?? 0;
    const next = [
      ...mine.filter((c) => c.status !== 'pending' && visible(c)).map((c) => note(c, true)),
      ...toMe.filter(visible).map((c) => note(c, false)),
    ].sort((a, b) => when(b) - when(a));
    if (!cessionNotesChanged(next, meta)) return;
    cessionNotes = next;
    render();
  });

  // Pedidos esperando resposta: só para quem altera a escala de algum grupo de equipe
  // (Gestor, coordenador marcado no grupo, Dev). Uma escuta por grupo.
  if (['dev', 'gestor', 'coordenador'].includes(access?.role)) {
    const byGroup = new Map(); // groupId → { stop, list, cessions }
    const synced = new Set(); // "grupo:v" (vagas) e "grupo:c" (cessões) que já responderam do servidor
    const pendingChanged = tracker((r) => toast(`${r.name} pediu um plantão vago em ${r.groupName}. Veja no sininho.`, 'info', 8000));
    const cessionsChanged = tracker((c) => toast(`${c.name} quer ceder um plantão em ${c.groupName}. Veja no sininho.`, 'info', 8000));
    const newest = (a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0);
    const emit = () => {
      const allSynced = [...byGroup.keys()].every((id) => synced.has(`${id}:v`) && synced.has(`${id}:c`));
      const list = [...byGroup.values()].flatMap((entry) => entry.list).sort(newest);
      const cessions = [...byGroup.values()].flatMap((entry) => entry.cessions).sort(newest);
      const changed = pendingChanged(list, { synced: allSynced });
      const changedCessions = cessionsChanged(cessions, { synced: allSynced });
      vacancyPending = list;
      cessionPending = cessions;
      if (changed || changedCessions) render();
    };
    watchMyGroups(user.uid, access.role, (groups) => {
      const editable = groups.filter((g) => g.type === 'team' && can(g.role, 'editSchedule'));
      const ids = new Set(editable.map((g) => g.id));
      vacancyGroups.clear();
      editable.forEach((g) => vacancyGroups.set(g.id, g));
      for (const [id, entry] of byGroup) {
        if (ids.has(id)) continue;
        entry.stop();
        byGroup.delete(id);
        synced.delete(`${id}:v`);
        synced.delete(`${id}:c`);
      }
      for (const g of editable) {
        if (byGroup.has(g.id)) continue;
        const entry = { list: [], cessions: [], stop: null };
        byGroup.set(g.id, entry);
        const stops = [
          watchGroupRequests(g.id, (list, meta) => {
            entry.list = list;
            if (meta.synced) synced.add(`${g.id}:v`);
            emit();
          }),
          watchGroupCessions(g.id, (list, meta) => {
            entry.cessions = list;
            if (meta.synced) synced.add(`${g.id}:c`);
            emit();
          }),
        ];
        entry.stop = () => stops.forEach((stop) => stop());
      }
      emit();
      render(); // quem pediu pode ter saído do grupo
    });
  }

  // Já vistas, em tempo real (vistas em outro aparelho também deixam de contar aqui)
  const readsRef = doc(db, 'notificationReads', user.uid);
  listenWithRetry(
    readsRef,
    (snapshot) => {
      seen = new Set(snapshot.data()?.ids ?? []);
      render();
    },
    'Notificações vistas',
  );

  // Guarda só as que ainda estão na lista (as dispensadas saem), no máximo 300
  const saveSeen = () =>
    setDoc(readsRef, {
      ids: [...notices, ...answered, ...vacancyAnswers, ...cessionNotes].map((item) => item.id).filter((id) => seen.has(id)).slice(0, 300),
      updatedAt: serverTimestamp(),
    }).catch(() => {}); // sem conexão: o Firestore grava quando voltar

  function markSeen(id) {
    if (seen.has(id)) return;
    seen.add(id);
    // Na hora, sem esperar o servidor; depois do clique, para o link "Ver meu cargo" ainda abrir
    setTimeout(render);
    saveSeen();
  }

  async function clearAll(button) {
    const list = [...document.querySelectorAll('#notifications-list [data-readable]')].map((li) => li.dataset.id);
    const ok = await confirmDialog({
      title: 'Limpar todas as notificações?',
      message: 'Os avisos e as respostas aos seus convites e pedidos saem da lista. Convites e pedidos que esperam a sua resposta continuam até você responder.',
      confirmText: 'Limpar todas',
      danger: true,
    });
    if (!ok) return;
    setLoading(button, true);
    const results = await Promise.allSettled(
      list.map((id) => {
        const notice = notices.find((item) => item.id === id);
        const inv = answered.find((item) => item.id === id);
        const answer = vacancyAnswers.find((item) => item.id === id);
        const cession = cessionNotes.find((item) => item.id === id);
        if (notice) return deleteDoc(doc(db, notice.id));
        if (inv) return cancelInvite(inv.groupId, inviteKey(inv));
        if (answer) return removeRequest(answer.groupId, answer.docId);
        if (cession) return dismissCession(cession.groupId, cession.docId);
        return null;
      }),
    );
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length) toast(firebaseErrorMessage(failed[0].reason), 'error');
    if (button.isConnected) setLoading(button, false);
  }

  const drawer = document.getElementById('drawer-notifications');
  drawer.querySelectorAll('.chip').forEach((chip) => chip.addEventListener('click', renderDrawer));
  drawer.addEventListener('click', async (event) => {
    const clear = event.target.closest('[data-clear-all]');
    if (clear) {
      clearAll(clear);
      return;
    }
    // Clicar no aviso (ou em "Ver meu cargo") marca como visto; Dispensar apaga
    const item = event.target.closest('[data-readable]');
    if (item && !event.target.closest('[data-dismiss]')) markSeen(item.dataset.id);
    // Pedido de plantão vago: Aceitar ou Recusar
    const vacancyButton = event.target.closest('[data-vacancy-answer]');
    if (vacancyButton) {
      const request = vacancyPending.find((r) => r.path === vacancyButton.closest('[data-id]').dataset.id);
      if (!request) return;
      setLoading(vacancyButton, true);
      const ok = await answerRequest(request, vacancyButton.dataset.vacancyAnswer === 'yes', {
        deciderName: session.profile?.name,
        pending: vacancyPending,
      });
      if (!ok && vacancyButton.isConnected) setLoading(vacancyButton, false);
      return;
    }
    // Cessão: Aprovar ou Recusar
    const cessionButton = event.target.closest('[data-cession-answer]');
    if (cessionButton) {
      const cession = cessionPending.find((c) => c.path === cessionButton.closest('[data-id]').dataset.id);
      if (!cession) return;
      setLoading(cessionButton, true);
      const ok = await answerCession(cession, cessionButton.dataset.cessionAnswer === 'yes', { deciderName: session.profile?.name });
      if (!ok && cessionButton.isConnected) setLoading(cessionButton, false);
      return;
    }
    const button = event.target.closest('[data-accept], [data-decline], [data-dismiss]');
    if (!button) return;
    const id = button.closest('[data-id]').dataset.id;
    setLoading(button, true);
    let ok = true;
    if (button.hasAttribute('data-dismiss')) {
      // Dispensar: apaga o aviso, ou o convite aceito ou recusado
      const notice = notices.find((item) => item.id === id);
      const inv = answered.find((item) => item.id === id);
      const answer = vacancyAnswers.find((item) => item.id === id);
      const cession = cessionNotes.find((item) => item.id === id);
      try {
        if (notice) await deleteDoc(doc(db, notice.id));
        else if (inv) await cancelInvite(inv.groupId, inviteKey(inv));
        else if (answer) await removeRequest(answer.groupId, answer.docId);
        else if (cession) await dismissCession(cession.groupId, cession.docId);
      } catch (error) {
        ok = false;
        toast(firebaseErrorMessage(error), 'error');
      }
    } else {
      const inv = invites.find((item) => item.id === id);
      if (inv) ok = await respondInvite(inv, button.hasAttribute('data-accept'));
    }
    if (!ok && button.isConnected) setLoading(button, false);
  });
}
