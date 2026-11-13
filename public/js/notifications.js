// Notificações (sininho do topo), em tempo real em todas as páginas:
//  - convites para grupos que a pessoa recebeu (Aceitar / Recusar);
//  - convites que ela mandou e foram recusados (Dispensar).
// O sininho mostra quantas há; o que chega com a página aberta também vira um aviso.
// A tela de Escalas usa a mesma lista de convites (onInvitesChange) para os cartões.
// No topo da gaveta: as notificações push neste aparelho (push.js), para os mesmos avisos
// chegarem no celular com o app fechado.
import { icon } from './icons.js';
import { pushStatus, enablePush, disablePush, dismissPush, resetPushChoice, sendTestPush, sendTestPushToAll, setAppBadge } from './push.js';
import { escapeHtml, toast, setLoading, firebaseErrorMessage, confirmDialog } from './ui.js';
import {
  watchMyInvites,
  watchDeclinedInvites,
  acceptInvite,
  declineInvite,
  cancelInvite,
  inviteKey,
} from './members.js';

let invites = []; // recebidos, pendentes
let declined = []; // mandados e recusados
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

// "Otávio Novo recusou o convite para UTI Adulto"
const declinedText = (inv) =>
  `<strong>${escapeHtml(inv.respondedByName ?? inv.name ?? inv.email ?? 'Alguém')}</strong> recusou o convite para
  <strong>${escapeHtml(inv.groupName)}</strong>`;

const whenText = (ts) => {
  const date = ts?.toDate?.();
  return date ? date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
};

function renderBell() {
  const bell = session.app.querySelector('#notifications-button');
  const count = invites.length + declined.length;
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

// Filtros da gaveta: convites recebidos contam como "Grupos"; recusas, como "Gestão" e "Grupos"
function pressedFilters() {
  return [...document.querySelectorAll('#drawer-notifications .chip[aria-pressed="true"]')].map((c) => c.dataset.filter);
}

function renderDrawer() {
  const list = document.getElementById('notifications-list');
  if (!list) return;
  const filters = pressedFilters();
  const showInvites = !filters.length || filters.includes('groups');
  const showDeclined = !filters.length || filters.includes('groups') || filters.includes('management');
  const received = showInvites ? invites : [];
  const refused = showDeclined ? declined : [];

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

  const refusedHtml = refused.length
    ? `<h3 class="section-title">Convites recusados</h3>
      <ul class="notification-list">${refused
        .map(
          (inv) => `<li class="notification-item is-declined" data-id="${escapeHtml(inv.id)}">
          <span class="notification-icon" aria-hidden="true">${icon('x')}</span>
          <div class="notification-text">
            <span class="notification-sentence">${declinedText(inv)}</span>
            <small>${whenText(inv.respondedAt)}</small>
            <div class="notification-actions">
              <button type="button" class="btn btn-ghost" data-dismiss>Dispensar</button>
            </div>
          </div>
        </li>`,
        )
        .join('')}</ul>`
    : '';

  list.innerHTML =
    receivedHtml || refusedHtml
      ? receivedHtml + refusedHtml
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
  if (state.enabled) {
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

  const declinedChanged = tracker((inv) =>
    toast(`${inv.respondedByName ?? inv.name ?? inv.email} recusou o convite para ${inv.groupName}.`, 'info', 6000),
  );
  watchDeclinedInvites(user.uid, (list, meta) => {
    if (!declinedChanged(list, meta)) return;
    declined = list;
    render();
  });

  const drawer = document.getElementById('drawer-notifications');
  drawer.querySelectorAll('.chip').forEach((chip) => chip.addEventListener('click', renderDrawer));
  drawer.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-accept], [data-decline], [data-dismiss]');
    if (!button) return;
    const id = button.closest('[data-id]').dataset.id;
    setLoading(button, true);
    let ok = true;
    if (button.hasAttribute('data-dismiss')) {
      // Dispensar a recusa: apaga o convite recusado
      const inv = declined.find((item) => item.id === id);
      try {
        if (inv) await cancelInvite(inv.groupId, inviteKey(inv));
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
