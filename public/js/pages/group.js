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
import { changeRole, removeMember, createInvite, cancelInvite, inviteLink, inviteKey, INVITE_DAYS } from '../members.js';
import { searchPeople } from '../people-search.js';
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
  // Cada palavra digitada precisa aparecer (no começo, meio ou fim) no nome, e-mail ou profissão
  const words = normalize($('member-search').value).split(' ').filter(Boolean);
  const usage = roleUsage(group);
  const visible = members
    .filter((m) => group.memberIds.includes(m.id))
    .filter((m) => {
      if (!words.length) return true;
      const text = normalize(`${m.name} ${m.email ?? ''} ${professionLabel(m)}`);
      return words.every((w) => text.includes(w));
    })
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

  // Senha provisória não fica aqui: só o administrador da plataforma gera (Configurações > Usuários)
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
// O campo aceita o nome de quem já usa o EscalaMed (sugestões da plataforma, convite
// "por pessoa", sem revelar o e-mail dela) ou o e-mail de quem ainda não tem conta.
const inviteForm = $('invite-form');
const inviteInput = $('invite-email');
const inviteList = $('invite-results');
clearErrorsWhileTyping(inviteForm);

let invitePerson = null; // pessoa escolhida na lista
let inviteResults = [];
let inviteActive = -1;
let inviteTimer = null;
let inviteSeq = 0;

const personDetails = (p) =>
  [professionLabel(p), councilLabel(p.council)].filter(Boolean).join(' · ') || (p.username ? `@${p.username}` : '');

function setInviteListOpen(open) {
  inviteList.hidden = !open;
  inviteInput.setAttribute('aria-expanded', String(open));
  if (!open) inviteInput.removeAttribute('aria-activedescendant');
}

// Situação da pessoa neste grupo: já é membro, já tem convite ou pode ser convidada
function inviteStatus(p) {
  if (group.memberIds.includes(p.uid)) return 'member';
  if (invites.some((i) => i.uid === p.uid)) return 'invited';
  return '';
}

function renderInviteResults(status = '') {
  inviteList.innerHTML =
    (status ? `<li class="search-status" role="presentation">${escapeHtml(status)}</li>` : '') +
    inviteResults
      .map((p, i) => {
        const state = inviteStatus(p);
        const note = state === 'member' ? 'Já está no grupo' : state === 'invited' ? 'Convite pendente (renova)' : personDetails(p);
        return `<li class="search-option${state === 'member' ? ' is-disabled' : ''}" role="option" id="invite-opt-${i}"
            data-index="${i}" aria-selected="${i === inviteActive}" aria-disabled="${state === 'member'}">
          ${avatarHtml(p, 'avatar')}
          <span><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(note)}</small></span>
        </li>`;
      })
      .join('');
  setInviteListOpen(true);
  if (inviteActive >= 0) inviteInput.setAttribute('aria-activedescendant', `invite-opt-${inviteActive}`);
}

function choosePerson(index) {
  const person = inviteResults[index];
  if (!person || inviteStatus(person) === 'member') return;
  invitePerson = person;
  setInviteListOpen(false);
  inviteInput.hidden = true;
  $('invite-chosen').hidden = false;
  $('invite-chosen').innerHTML = `${avatarHtml(person, 'avatar')}
    <div class="member-info"><strong>${escapeHtml(person.name)}</strong><span>${escapeHtml(personDetails(person) || 'Usuário do EscalaMed')}</span></div>
    <button type="button" class="btn-icon" id="invite-clear" aria-label="Trocar pessoa" title="Trocar pessoa">${icon('x')}</button>`;
  clearFormErrors(inviteForm);
}

function clearPerson({ focus = true } = {}) {
  invitePerson = null;
  $('invite-chosen').hidden = true;
  $('invite-chosen').innerHTML = '';
  inviteInput.hidden = false;
  if (focus) inviteInput.focus();
}

$('invite-chosen').addEventListener('click', (event) => {
  if (event.target.closest('#invite-clear')) clearPerson();
});

inviteInput.addEventListener('input', () => {
  clearTimeout(inviteTimer);
  const text = inviteInput.value.trim();
  inviteSeq++;
  inviteResults = [];
  inviteActive = -1;
  // Com "@" é e-mail: sem sugestões
  if (text.includes('@') || normalize(text).length < 2) {
    setInviteListOpen(false);
    return;
  }
  renderInviteResults('Buscando…');
  const seq = inviteSeq;
  inviteTimer = setTimeout(async () => {
    try {
      const found = await searchPeople(text, user.uid);
      if (seq !== inviteSeq) return; // chegou uma busca mais nova
      inviteResults = found;
      renderInviteResults(found.length ? '' : 'Ninguém encontrado. Se a pessoa ainda não tem conta, informe o e-mail dela.');
    } catch (error) {
      if (seq === inviteSeq) renderInviteResults(firebaseErrorMessage(error) ?? '');
    }
  }, 300);
});

inviteInput.addEventListener('keydown', (event) => {
  if (inviteList.hidden || !inviteResults.length) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const total = inviteResults.length;
    inviteActive = (inviteActive + (event.key === 'ArrowDown' ? 1 : -1) + total) % total;
    renderInviteResults();
    $(`invite-opt-${inviteActive}`)?.scrollIntoView({ block: 'nearest' });
  } else if (event.key === 'Enter' && inviteActive >= 0) {
    event.preventDefault();
    choosePerson(inviteActive);
  } else if (event.key === 'Escape') {
    event.preventDefault(); // não fecha o modal, só a lista
    setInviteListOpen(false);
  }
});

inviteInput.addEventListener('blur', () => setTimeout(() => setInviteListOpen(false), 150));

// mousedown em vez de click: escolhe antes de o campo perder o foco
inviteList.addEventListener('mousedown', (event) => {
  const option = event.target.closest('.search-option');
  if (!option) return;
  event.preventDefault();
  choosePerson(Number(option.dataset.index));
});

function openInviteModal() {
  inviteForm.reset();
  clearFormErrors(inviteForm);
  clearPerson({ focus: false });
  inviteResults = [];
  setInviteListOpen(false);
  const usage = roleUsage(group);
  $('invite-role').innerHTML = INVITE_ROLES.map((role) => {
    const full = role !== 'staff' && !hasRoom(group, role);
    const count = role === 'staff' ? '' : ` (${usage[role]}/${ROLE_LIMITS[role]})`;
    return `<option value="${role}" ${full ? 'disabled' : ''}>${ROLES[role]}${count}${full ? ' · limite atingido' : ''}</option>`;
  }).join('');
  $('modal-invite').showModal();
  inviteInput.focus();
}

$('invite-button').addEventListener('click', openInviteModal);

inviteForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFormErrors(inviteForm);
  const role = inviteForm.role.value;

  let target;
  if (invitePerson) {
    target = { uid: invitePerson.uid, name: invitePerson.name };
  } else {
    const email = inviteInput.value.trim().toLowerCase();
    if (!isValidEmail(email)) {
      setFieldError(inviteInput, 'Escolha uma pessoa da lista ou informe um e-mail válido.');
      return;
    }
    if (email === user.email?.toLowerCase()) {
      setFieldError(inviteInput, 'Você já faz parte do grupo.');
      return;
    }
    target = { email };
  }

  const button = inviteForm.querySelector('[type=submit]');
  setLoading(button, true);
  try {
    const renewed = invites.some((i) => inviteKey(i) === inviteKey(target));
    await createInvite(group, target, role, { uid: user.uid, name: profile.name });
    $('modal-invite').close();
    showInviteLink(target, renewed);
  } catch (error) {
    showFormAlert(inviteForm, firebaseErrorMessage(error));
  } finally {
    setLoading(button, false);
  }
});

// invite: { email } ou { uid, name }
function showInviteLink(invite, renewed = false) {
  const link = inviteLink(group.id);
  $('modal-invite-link-title').textContent = renewed ? 'Convite renovado' : 'Convite criado';
  if (invite.uid) {
    $('invite-link-text').innerHTML = `<strong>${escapeHtml(invite.name)}</strong> vê o convite na tela Escalas ao entrar no EscalaMed. Se quiser, envie também este link (vale por ${INVITE_DAYS} dias e só funciona na conta dela).`;
  } else {
    $('invite-link-text').innerHTML = `Envie este link para <strong>${escapeHtml(invite.email)}</strong>. Vale por ${INVITE_DAYS} dias e só funciona com esse e-mail.`;
  }
  $('invite-link').value = link;
  const message = invite.uid
    ? `Você foi convidado(a) para o grupo ${group.name} no EscalaMed: ${link}`
    : `Você foi convidado(a) para o grupo ${group.name} no EscalaMed. Entre com o e-mail ${invite.email}: ${link}`;
  $('share-whatsapp').href = `https://wa.me/?text=${encodeURIComponent(message)}`;
  $('modal-invite-link').showModal();
}

async function copyText(text, done = 'Link copiado.') {
  try {
    await navigator.clipboard.writeText(text);
    toast(done, 'success');
  } catch {
    toast('Não foi possível copiar. Selecione o texto e use Ctrl+C.');
  }
}

$('copy-link').addEventListener('click', () => copyText($('invite-link').value));

const inviteLabel = (invite) => invite.name ?? invite.email;

function renderInvites() {
  const show = can(myRole, 'inviteMembers') && invites.length > 0;
  $('invites-section').hidden = !show;
  if (!show) return;
  $('invite-list').innerHTML = invites
    .sort((a, b) => inviteLabel(a).localeCompare(inviteLabel(b), 'pt-BR'))
    .map((invite) => {
      const expired = invite.expiresAt?.toMillis() < Date.now();
      const status = expired
        ? '<span class="badge badge-warning">Vencido</span>'
        : `<span class="muted">vence em ${formatDate(invite.expiresAt)}</span>`;
      const key = escapeHtml(inviteKey(invite));
      const kind = invite.uid ? 'Usuário do EscalaMed · ' : '';
      return `<li class="invite-item">
        <div class="member-info">
          <strong>${escapeHtml(inviteLabel(invite))}</strong>
          <span>${kind}${ROLES[invite.role]} · ${status}</span>
        </div>
        <div class="invite-actions">
          <button type="button" class="btn btn-ghost" data-copy="${key}">${icon('arrowRightLeft')}Link</button>
          <button type="button" class="btn btn-ghost is-danger" data-cancel="${key}">${icon('x')}Cancelar</button>
        </div>
      </li>`;
    })
    .join('');
}

$('invite-list').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-copy], [data-cancel]');
  if (!button) return;
  const key = button.dataset.copy ?? button.dataset.cancel;
  const invite = invites.find((i) => inviteKey(i) === key);
  if (!invite) return;
  if (button.hasAttribute('data-copy')) {
    showInviteLink(invite);
    return;
  }
  const ok = await confirmDialog({
    title: 'Cancelar convite?',
    message: `O convite de ${inviteLabel(invite)} deixa de valer.`,
    confirmText: 'Cancelar convite',
    cancelText: 'Voltar',
    danger: true,
  });
  if (!ok) return;
  try {
    await cancelInvite(group.id, key);
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
