// Notificações (sininho do topo), em tempo real em todas as páginas:
//  - convites para grupos que a pessoa recebeu (Aceitar / Recusar);
//  - convites que ela mandou e foram recusados (Dispensar).
// O sininho mostra quantas há; o que chega com a página aberta também vira um aviso.
// A tela de Escalas usa a mesma lista de convites (onInvitesChange) para os cartões.
import { icon } from './icons.js';
import { escapeHtml, toast, setLoading, firebaseErrorMessage } from './ui.js';
import { ROLES } from './permissions.js';
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

// "Erick convidou você como Observador · Hospital Luís de França"
export const inviteText = (invite) =>
  `${escapeHtml(invite.invitedByName)} convidou você como ${ROLES[invite.role] ?? 'membro'}${
    invite.unitName ? ` · ${escapeHtml(invite.unitName)}` : ''
  }`;

// "Otávio Novo recusou o convite para Hospital Luís de França (Observador)"
const declinedText = (inv) =>
  `<strong>${escapeHtml(inv.respondedByName ?? inv.name ?? inv.email ?? 'Alguém')}</strong> recusou o convite para
  <strong>${escapeHtml(inv.groupName)}</strong> (${ROLES[inv.role] ?? 'membro'})`;

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

export function setupNotifications(app, user, profile) {
  session = { app, user, profile };

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
