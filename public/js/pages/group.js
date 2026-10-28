// Tela do grupo: cabeçalho, abas (Calendário, Membros), convites e cargos.
import { doc, collection, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db, navigate, isLeaving } from '../firebase.js';
import { initLayout, avatarHtml } from '../layout.js';
import { icon, renderIcons } from '../icons.js';
import { professionLabel, councilLabel } from '/data/categories.js';
import { normalize, isValidEmail } from '../validators.js';
import {
  ROLES,
  ROLE_ORDER,
  ROLE_LIMITS,
  INVITE_ROLES,
  roleOf,
  roleUsage,
  hasRoom,
  can,
  assignableRoles,
} from '../permissions.js';
import { changeRole, removeMember, createInvite, cancelInvite, inviteLink, INVITE_DAYS } from '../members.js';
import {
  escapeHtml,
  initials,
  toast,
  setLoading,
  setFieldError,
  clearFormErrors,
  clearErrorsWhileTyping,
  showFormAlert,
  confirmDialog,
  firebaseErrorMessage,
} from '../ui.js';

renderIcons();
const { user, profile } = await initLayout({ active: 'schedules' });

const $ = (id) => document.getElementById(id);
const groupId = new URLSearchParams(location.search).get('id');
if (!groupId) {
  navigate('/schedules.html', { replace: true });
  await new Promise(() => {});
}

let group = null;
let myRole = null;
let members = [];
let invites = [];
let stopInvites = null;
let leaving = false;

// Títulos das seções de membros (plural)
const SECTION_TITLES = {
  manager: 'Gestor',
  assistant: 'Auxiliares',
  analyst: 'Analistas',
  observer: 'Observadores',
  staff: 'Plantonistas',
};

const formatDate = (timestamp) => timestamp?.toDate?.().toLocaleDateString('pt-BR') ?? '';

function goAway(message) {
  if (leaving || isLeaving()) return;
  leaving = true;
  if (message) toast(message, 'error');
  setTimeout(() => navigate('/schedules.html', { replace: true }), message ? 1200 : 0);
}

// ---------- Cabeçalho ----------
function renderHeader() {
  document.title = `${group.name} | EscalaMed`;
  $('group-avatar').style.background = group.color;
  $('group-avatar').textContent = initials(group.name);
  $('group-name').textContent = group.name;
  const unit = group.unit ? `${group.unit.name} · ${group.unit.city}/${group.unit.state}` : 'Escala individual';
  $('group-unit').innerHTML = `${escapeHtml(unit)}${
    group.type === 'team' ? ` <span class="badge badge-primary">${ROLES[myRole]}</span>` : ''
  }`;

  const actions = [];
  if (can(myRole, 'editSettings')) {
    actions.push(
      `<a class="btn btn-secondary" href="/group-new.html?id=${encodeURIComponent(group.id)}&step=info">${icon('settings')}Configurações do grupo</a>`,
    );
  }
  if (group.type === 'team' && can(myRole, 'leaveGroup')) {
    actions.push(`<button type="button" class="btn btn-ghost is-danger" id="leave-group">${icon('logOut')}Sair do grupo</button>`);
  }
  $('group-actions').innerHTML = actions.join('');
  $('leave-group')?.addEventListener('click', leaveGroup);
}

async function leaveGroup() {
  const ok = await confirmDialog({
    title: 'Sair do grupo?',
    message: `Você deixa de ver a escala de ${group.name}. Para voltar, vai precisar de um novo convite.`,
    confirmText: 'Sair do grupo',
    danger: true,
  });
  if (!ok) return;
  leaving = true;
  try {
    await removeMember(group, user.uid);
    toast('Você saiu do grupo.', 'success');
    navigate('/schedules.html', { replace: true });
  } catch (error) {
    leaving = false;
    toast(firebaseErrorMessage(error), 'error');
  }
}

// ---------- Abas ----------
const tabs = () => [...document.querySelectorAll('#group-tabs .tab:not([hidden])')];

function selectTab(tab, { focus = false } = {}) {
  document.querySelectorAll('#group-tabs .tab').forEach((t) => {
    const selected = t === tab;
    t.setAttribute('aria-selected', String(selected));
    t.tabIndex = selected ? 0 : -1;
    $(t.getAttribute('aria-controls')).hidden = !selected;
  });
  if (focus) tab.focus();
  history.replaceState(null, '', `${location.pathname}${location.search}${tab.id === 'tab-members' ? '#membros' : ''}`);
}

$('group-tabs').addEventListener('click', (event) => {
  const tab = event.target.closest('.tab');
  if (tab) selectTab(tab);
});

// Setas trocam de aba (padrão de acessibilidade para abas)
$('group-tabs').addEventListener('keydown', (event) => {
  const list = tabs();
  const index = list.indexOf(document.activeElement);
  if (index < 0) return;
  if (event.key === 'ArrowRight') selectTab(list[(index + 1) % list.length], { focus: true });
  if (event.key === 'ArrowLeft') selectTab(list[(index - 1 + list.length) % list.length], { focus: true });
});

// ---------- Membros ----------
// Quem pode mexer no cargo de quem: gestor em todos; auxiliar em todos menos no gestor.
function canManage(targetUid) {
  if (targetUid === user.uid) return false;
  if (myRole === 'manager') return true;
  return myRole === 'assistant' && roleOf(group, targetUid) !== 'manager';
}

function memberCardHtml(member) {
  const role = roleOf(group, member.id);
  const details = [professionLabel(member), councilLabel(member.council)].filter(Boolean).join(' · ');
  const me = member.id === user.uid ? ' <span class="muted">(você)</span>' : '';
  const badge = role !== 'staff' ? `<span class="badge badge-primary">${ROLES[role]}</span>` : '';
  const manage = canManage(member.id)
    ? `<button type="button" class="btn-icon" data-manage="${member.id}" aria-label="Gerenciar ${escapeHtml(member.name)}" title="Alterar perfil">${icon('edit')}</button>`
    : '';
  return `<li class="member-item">
    ${avatarHtml(member, 'avatar member-avatar')}
    <div class="member-info">
      <strong>${escapeHtml(member.name)}${me}</strong>
      <span>${escapeHtml(details || 'Profissão não informada')}</span>
    </div>
    ${badge}
    ${manage}
  </li>`;
}

function renderMembers() {
  const term = normalize($('member-search').value);
  const usage = roleUsage(group);
  const visible = members
    .filter((m) => group.memberIds.includes(m.id))
    .filter((m) => !term || normalize(m.name).includes(term))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  $('members-count').textContent = `(${group.memberIds.length})`;

  const sections = ROLE_ORDER.map((role) => {
    const list = visible.filter((m) => roleOf(group, m.id) === role);
    if (!list.length) return '';
    const limit = ROLE_LIMITS[role] === Infinity ? usage[role] : `${usage[role]}/${ROLE_LIMITS[role]}`;
    return `<section class="member-section">
      <h2 class="section-title">${SECTION_TITLES[role]} <span class="muted">(${limit})</span></h2>
      <ul class="member-list">${list.map(memberCardHtml).join('')}</ul>
    </section>`;
  }).join('');

  $('member-sections').innerHTML =
    sections ||
    `<div class="empty-state">${icon('search')}<h3>Nenhum membro encontrado</h3>
      <p>Ninguém corresponde a "${escapeHtml($('member-search').value.trim())}".</p></div>`;
}

$('member-search').addEventListener('input', renderMembers);

$('member-sections').addEventListener('click', (event) => {
  const button = event.target.closest('[data-manage]');
  if (button) openRoleModal(button.dataset.manage);
});

// ---------- Alterar perfil ----------
function openRoleModal(uid) {
  const member = members.find((m) => m.id === uid);
  if (!member) return;
  const current = roleOf(group, uid);
  const usage = roleUsage(group);

  $('role-target').innerHTML = `${avatarHtml(member, 'avatar member-avatar')}
    <div class="member-info"><strong>${escapeHtml(member.name)}</strong><span>Perfil atual: ${ROLES[current]}</span></div>`;

  // Mesma ordem do modelo de referência: Plantonista, Gestor, Auxiliar, Analista, Observador
  const order = ['staff', 'manager', 'assistant', 'analyst', 'observer'];
  const allowed = assignableRoles(myRole);
  const options = order
    .filter((role) => allowed.includes(role))
    .map((role) => {
      const isCurrent = role === current;
      const isTransfer = role === 'manager';
      const full = role !== 'staff' && !isTransfer && !hasRoom(group, role);
      const label = role === 'staff' ? 'Plantonista' : `Tornar ${ROLES[role]}`;
      const count = role === 'staff' ? '' : ` <span class="role-count">(${usage[role]}/${ROLE_LIMITS[role]})</span>`;
      const hint = isCurrent ? 'Perfil atual' : full ? 'Limite atingido' : isTransfer ? 'Transfere a gestão do grupo' : '';
      return `<button type="button" class="role-option" data-role="${role}" ${isCurrent || full ? 'disabled' : ''}>
        <span>${label}${count}</span>${hint ? `<small>${hint}</small>` : ''}
      </button>`;
    })
    .join('');

  $('role-options').innerHTML = `${options}
    <button type="button" class="role-option is-danger" data-remove>${icon('trash')}<span>Remover membro</span></button>`;
  $('role-options').dataset.uid = uid;
  $('modal-role').showModal();
}

$('role-options').addEventListener('click', async (event) => {
  const button = event.target.closest('.role-option');
  if (!button || button.disabled) return;
  const uid = $('role-options').dataset.uid;
  const member = members.find((m) => m.id === uid);
  $('modal-role').close();

  if (button.hasAttribute('data-remove')) {
    const ok = await confirmDialog({
      title: 'Remover membro?',
      message: `${member.name} deixa de ver a escala deste grupo.`,
      confirmText: 'Remover',
      danger: true,
    });
    if (!ok) return;
    try {
      await removeMember(group, uid);
      toast(`${member.name} foi removido(a) do grupo.`, 'success');
    } catch (error) {
      toast(firebaseErrorMessage(error), 'error');
    }
    return;
  }

  const role = button.dataset.role;
  if (role === 'manager') {
    const next = roleUsage(group).assistant < ROLE_LIMITS.assistant ? 'auxiliar' : 'plantonista';
    const ok = await confirmDialog({
      title: 'Transferir a gestão?',
      message: `${member.name} passa a ser o(a) gestor(a) do grupo e você passa a ser ${next}. Só o novo gestor pode desfazer.`,
      confirmText: 'Transferir',
      danger: true,
    });
    if (!ok) return;
  }
  try {
    await changeRole(group, uid, role);
    toast(`${member.name} agora é ${ROLES[role].toLowerCase()}.`, 'success');
  } catch (error) {
    toast(firebaseErrorMessage(error), 'error');
  }
});

// ---------- Convites ----------
const inviteForm = $('invite-form');
clearErrorsWhileTyping(inviteForm);

function openInviteModal() {
  inviteForm.reset();
  clearFormErrors(inviteForm);
  const usage = roleUsage(group);
  $('invite-role').innerHTML = INVITE_ROLES.map((role) => {
    const full = role !== 'staff' && !hasRoom(group, role);
    const count = role === 'staff' ? '' : ` (${usage[role]}/${ROLE_LIMITS[role]})`;
    return `<option value="${role}" ${full ? 'disabled' : ''}>${ROLES[role]}${count}${full ? ' · limite atingido' : ''}</option>`;
  }).join('');
  $('modal-invite').showModal();
  inviteForm.email.focus();
}

$('invite-button').addEventListener('click', openInviteModal);

inviteForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFormErrors(inviteForm);
  const email = inviteForm.email.value.trim().toLowerCase();
  const role = inviteForm.role.value;
  if (!isValidEmail(email)) {
    setFieldError(inviteForm.email, 'Informe um e-mail válido.');
    return;
  }
  if (email === user.email?.toLowerCase()) {
    setFieldError(inviteForm.email, 'Você já faz parte do grupo.');
    return;
  }

  const button = inviteForm.querySelector('[type=submit]');
  setLoading(button, true);
  try {
    const renewed = invites.some((i) => i.email === email);
    await createInvite(group, email, role, { uid: user.uid, name: profile.name });
    $('modal-invite').close();
    showInviteLink(email, renewed);
  } catch (error) {
    showFormAlert(inviteForm, firebaseErrorMessage(error));
  } finally {
    setLoading(button, false);
  }
});

function showInviteLink(email, renewed = false) {
  const link = inviteLink(group.id);
  $('modal-invite-link-title').textContent = renewed ? 'Convite renovado' : 'Convite criado';
  $('invite-link-text').innerHTML = `Envie este link para <strong>${escapeHtml(email)}</strong>. Vale por ${INVITE_DAYS} dias e só funciona com esse e-mail.`;
  $('invite-link').value = link;
  const message = `Você foi convidado(a) para o grupo ${group.name} no EscalaMed. Entre com o e-mail ${email}: ${link}`;
  $('share-whatsapp').href = `https://wa.me/?text=${encodeURIComponent(message)}`;
  $('modal-invite-link').showModal();
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Link copiado.', 'success');
  } catch {
    $('invite-link').select();
    toast('Selecione e copie o link (Ctrl+C).');
  }
}

$('copy-link').addEventListener('click', () => copyText($('invite-link').value));

function renderInvites() {
  const show = can(myRole, 'inviteMembers') && invites.length > 0;
  $('invites-section').hidden = !show;
  if (!show) return;
  $('invite-list').innerHTML = invites
    .sort((a, b) => a.email.localeCompare(b.email))
    .map((invite) => {
      const expired = invite.expiresAt?.toMillis() < Date.now();
      const status = expired
        ? '<span class="badge badge-warning">Vencido</span>'
        : `<span class="muted">vence em ${formatDate(invite.expiresAt)}</span>`;
      return `<li class="invite-item">
        <div class="member-info">
          <strong>${escapeHtml(invite.email)}</strong>
          <span>${ROLES[invite.role]} · ${status}</span>
        </div>
        <div class="invite-actions">
          <button type="button" class="btn btn-ghost" data-copy="${escapeHtml(invite.email)}">${icon('arrowRightLeft')}Link</button>
          <button type="button" class="btn btn-ghost is-danger" data-cancel="${escapeHtml(invite.email)}">${icon('x')}Cancelar</button>
        </div>
      </li>`;
    })
    .join('');
}

$('invite-list').addEventListener('click', async (event) => {
  const copy = event.target.closest('[data-copy]');
  if (copy) {
    showInviteLink(copy.dataset.copy);
    return;
  }
  const cancel = event.target.closest('[data-cancel]');
  if (!cancel) return;
  const ok = await confirmDialog({
    title: 'Cancelar convite?',
    message: `O link deixa de funcionar para ${cancel.dataset.cancel}.`,
    confirmText: 'Cancelar convite',
    cancelText: 'Voltar',
    danger: true,
  });
  if (!ok) return;
  try {
    await cancelInvite(group.id, cancel.dataset.cancel);
    toast('Convite cancelado.', 'success');
  } catch (error) {
    toast(firebaseErrorMessage(error), 'error');
  }
});

function listenInvites() {
  if (can(myRole, 'inviteMembers')) {
    if (stopInvites) return;
    stopInvites = onSnapshot(
      collection(db, 'groups', groupId, 'invites'),
      (snapshot) => {
        invites = snapshot.docs.map((d) => d.data());
        renderInvites();
      },
      () => {}, // perdeu o cargo: a próxima atualização do grupo desliga
    );
  } else if (stopInvites) {
    stopInvites();
    stopInvites = null;
    invites = [];
    renderInvites();
  }
}

// ---------- Dados em tempo real ----------
let firstLoad = true;

onSnapshot(
  doc(db, 'groups', groupId),
  (snapshot) => {
    if (!snapshot.exists()) return goAway('Este grupo não existe mais.');
    group = { id: snapshot.id, ...snapshot.data() };
    myRole = roleOf(group, user.uid);
    if (!myRole) return goAway('Você não faz mais parte deste grupo.');

    renderHeader();
    const isTeam = group.type === 'team';
    $('tab-members').hidden = !isTeam;
    $('invite-button').hidden = !can(myRole, 'inviteMembers');
    listenInvites();
    renderMembers();
    renderInvites();

    if (firstLoad) {
      firstLoad = false;
      selectTab(isTeam && location.hash === '#membros' ? $('tab-members') : $('tab-calendar'));
    }
  },
  (error) => {
    if (error.code === 'permission-denied') goAway('Você não faz mais parte deste grupo.');
    else if (!isLeaving()) toast(firebaseErrorMessage(error), 'error');
  },
);

onSnapshot(
  collection(db, 'groups', groupId, 'members'),
  (snapshot) => {
    members = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (group) renderMembers();
  },
  () => {}, // sem acesso: o listener do grupo já cuida de sair da página
);
