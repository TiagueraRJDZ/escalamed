// Tela do grupo: cabeçalho, abas (Calendário, Editar escala, Membros), convites e coordenadores.
// O papel de quem está logado vem do cargo da plataforma (permissions.js: groupRole).
import { doc, collection, getDoc, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db, navigate, isLeaving } from '../firebase.js';
import { initLayout, avatarHtml } from '../layout.js';
import { icon, renderIcons } from '../icons.js';
import { professionLabel, councilLabel } from '/data/categories.js';
import { groupSubtitle } from '../my-groups.js';
import { groupColor } from '/data/colors.js';
import { normalize, isValidEmail } from '../validators.js';
import {
  GROUP_ROLES,
  groupRole,
  can,
  canEditSettings,
  canLeave,
  canRemoveMember,
  canTakeShifts,
  isMarkedCoordinator,
  platformRoleOf,
} from '../permissions.js';
import { setCoordinator, removeMember, createInvite, cancelInvite, inviteLink, inviteKey, INVITE_DAYS } from '../members.js';
import { searchPeople } from '../people-search.js';
import { createCalendar } from '../calendar.js';
import { formatClock } from '../shifts.js';
import {
  monthKey,
  monthParts,
  cellKey,
  cellsOf,
  userDays,
  dayShifts,
  memberMinutes,
  formatHours,
  parseCellKey,
  requestId,
  requestBlock,
  cessionBlock,
  receiverBlock,
} from '../schedule-math.js';
import {
  watchMyRequests,
  watchGroupRequests,
  requestVacancy,
  removeRequest,
  answerRequest,
  requestShiftText,
  BLOCK_TEXT,
} from '../vacancy-requests.js';
import {
  watchMyCessions,
  watchGroupCessions,
  requestCession,
  cancelCession,
  answerCession,
  CESSION_BLOCK_TEXT,
  RECEIVER_BLOCK_TEXT,
} from '../cession-requests.js';
import { scheduleShifts, schedulesQuery, schedulesFrom, shiftsRef, shiftsFrom } from '../schedule-data.js';
import { listenWithRetry, batched } from '../live.js';
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
const { user, profile, access } = await initLayout({ active: 'schedules' });
const platformRole = access.role;

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

// Seções da aba Membros
const SECTION_TITLES = {
  coordinator: 'Coordenadores de escala',
  member: 'Membros',
};
const memberKind = (uid) => (isMarkedCoordinator(group, uid) ? 'coordinator' : 'member');

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
  $('group-avatar').style.background = groupColor(group.color);
  $('group-avatar').textContent = initials(group.name);
  $('group-name').textContent = group.name;
  const unit = groupSubtitle(group);
  $('group-unit').innerHTML = `${escapeHtml(unit)}${
    group.type === 'team' ? ` <span class="badge badge-primary">${GROUP_ROLES[myRole]}</span>` : ''
  }`;

  const actions = [];
  if (canEditSettings(group, myRole)) {
    actions.push(
      `<a class="btn btn-secondary" href="/group-new.html?id=${encodeURIComponent(group.id)}&step=info">${icon('settings')}Configurações do grupo</a>`,
    );
  }
  if (canLeave(group, user.uid)) {
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
  const hash = { 'tab-members': '#membros', 'tab-schedule': '#escala' }[tab.id] ?? '';
  history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
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
// Gerenciar alguém: o Gestor marca coordenadores e remove qualquer um; o coordenador remove
// quem não é coordenador. Ninguém gerencia a si mesmo (para sair, "Sair do grupo").
function canManage(targetUid) {
  if (targetUid === user.uid) return false;
  return can(myRole, 'setCoordinators') || canRemoveMember(group, myRole, targetUid, user.uid);
}

function memberCardHtml(member) {
  const details = [professionLabel(member), councilLabel(member.council)].filter(Boolean).join(' · ');
  const me = member.id === user.uid ? ' <span class="muted">(você)</span>' : '';
  // Coordenadores ficam numa seção própria: sem selo repetido no cartão
  const badge = '';
  const manage = canManage(member.id)
    ? `<button type="button" class="btn-icon" data-manage="${member.id}" aria-label="Gerenciar ${escapeHtml(member.name)}" title="Gerenciar membro">${icon('edit')}</button>`
    : '';
  return `<li class="member-item">
    ${avatarHtml(member, 'avatar member-avatar')}
    <div class="member-info">
      <strong>${escapeHtml(member.name)}${me}</strong>
      <span>${escapeHtml(details || 'Cargo não informado')}</span>
    </div>
    ${badge}
    ${manage}
  </li>`;
}

function renderMembers() {
  // Cada palavra digitada precisa aparecer (no começo, meio ou fim) no nome, e-mail ou cargo
  const words = normalize($('member-search').value).split(' ').filter(Boolean);
  const visible = members
    .filter((m) => group.memberIds.includes(m.id))
    .filter((m) => {
      if (!words.length) return true;
      const text = normalize(`${m.name} ${m.email ?? ''} ${professionLabel(m)}`);
      return words.every((w) => text.includes(w));
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  $('members-count').textContent = `(${group.memberIds.length})`;

  const sections = Object.keys(SECTION_TITLES).map((kind) => {
    const list = visible.filter((m) => memberKind(m.id) === kind);
    if (!list.length) return '';
    const total = group.memberIds.filter((uid) => memberKind(uid) === kind).length;
    return `<section class="member-section">
      <h2 class="section-title">${SECTION_TITLES[kind]} <span class="muted">(${total})</span></h2>
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

// ---------- Gerenciar membro ----------
// Só quem tem o cargo de Coordenador de escala aprovado pode ser marcado como coordenador
async function coordinatorEligibility(member) {
  if (member.categoryId !== 'coordenador-escala') return 'Só para quem tem o cargo Coordenador de escala.';
  const snapshot = await getDoc(doc(db, 'access', member.id)).catch(() => null);
  const approved = platformRoleOf({ access: snapshot?.exists() ? snapshot.data() : null }) === 'coordenador';
  return approved ? '' : 'O cargo de Coordenador de escala desta pessoa ainda não foi aprovado.';
}

async function openRoleModal(uid) {
  const member = members.find((m) => m.id === uid);
  if (!member) return;
  const marked = isMarkedCoordinator(group, uid);

  $('role-target').innerHTML = `${avatarHtml(member, 'avatar member-avatar')}
    <div class="member-info"><strong>${escapeHtml(member.name)}</strong><span>${marked ? 'Coordenador de escala' : 'Membro'} do grupo</span></div>`;

  let options = '';
  if (can(myRole, 'setCoordinators')) {
    if (marked) {
      options += `<button type="button" class="role-option" data-coordinator="off">
        <span>Remover coordenação</span><small>Continua no grupo como membro</small></button>`;
    } else {
      const blocked = await coordinatorEligibility(member);
      options += `<button type="button" class="role-option" data-coordinator="on" ${blocked ? 'disabled' : ''}>
        <span>Tornar coordenador de escala</span><small>${escapeHtml(blocked || 'Passa a montar a escala e gerenciar os membros deste grupo')}</small></button>`;
    }
  }
  if (canRemoveMember(group, myRole, uid, user.uid)) {
    options += `<button type="button" class="role-option is-danger" data-remove>${icon('trash')}<span>Remover membro</span></button>`;
  }

  // Senha provisória não fica aqui: só o administrador da plataforma gera (Configurações > Usuários)
  $('role-options').innerHTML = options;
  $('role-options').dataset.uid = uid;
  if (!$('modal-role').open) $('modal-role').showModal();
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

  const on = button.dataset.coordinator === 'on';
  try {
    await setCoordinator(group, uid, on);
    toast(on ? `${member.name} agora coordena a escala deste grupo.` : `${member.name} deixou de coordenar este grupo.`, 'success');
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
  $('modal-invite').showModal();
  inviteInput.focus();
}

$('invite-button').addEventListener('click', openInviteModal);

inviteForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFormErrors(inviteForm);

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
    await createInvite(group, target, { uid: user.uid, name: profile.name });
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
  const show = can(myRole, 'manageMembers') && invites.length > 0;
  $('invites-section').hidden = !show;
  if (!show) return;
  $('invite-list').innerHTML = invites
    .sort((a, b) => inviteLabel(a).localeCompare(inviteLabel(b), 'pt-BR'))
    .map((invite) => {
      const declined = invite.status === 'declined';
      const expired = invite.expiresAt?.toMillis() < Date.now();
      const status = declined
        ? `<span class="badge badge-danger">Recusado</span>${invite.respondedByName ? ` <span class="muted">por ${escapeHtml(invite.respondedByName)}</span>` : ''}`
        : expired
          ? '<span class="badge badge-warning">Vencido</span>'
          : `<span class="muted">vence em ${formatDate(invite.expiresAt)}</span>`;
      const key = escapeHtml(inviteKey(invite));
      const kind = invite.uid ? 'Usuário do EscalaMed · ' : '';
      return `<li class="invite-item">
        <div class="member-info">
          <strong>${escapeHtml(inviteLabel(invite))}</strong>
          <span>${kind}${status}</span>
        </div>
        <div class="invite-actions">
          ${declined ? '' : `<button type="button" class="btn btn-ghost" data-copy="${key}">${icon('arrowRightLeft')}Link</button>`}
          <button type="button" class="btn btn-ghost is-danger" data-cancel="${key}">${icon('x')}${declined ? 'Remover' : 'Cancelar'}</button>
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
  const declined = invite.status === 'declined';
  const ok = await confirmDialog({
    title: declined ? 'Remover convite recusado?' : 'Cancelar convite?',
    message: declined
      ? `O convite recusado por ${invite.respondedByName ?? inviteLabel(invite)} sai da lista.`
      : `O convite de ${inviteLabel(invite)} deixa de valer.`,
    confirmText: declined ? 'Remover' : 'Cancelar convite',
    cancelText: 'Voltar',
    danger: true,
  });
  if (!ok) return;
  try {
    await cancelInvite(group.id, key);
    toast(declined ? 'Convite removido.' : 'Convite cancelado.', 'success');
  } catch (error) {
    toast(firebaseErrorMessage(error), 'error');
  }
});

function listenInvites() {
  if (can(myRole, 'manageMembers')) {
    if (stopInvites) return;
    stopInvites = onSnapshot(
      collection(db, 'groups', groupId, 'invites'),
      (snapshot) => {
        // Aceitos ficam guardados só para o sininho de quem convidou (a pessoa já está em Membros)
        invites = snapshot.docs.map((d) => d.data()).filter((invite) => invite.status !== 'accepted');
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

// ---------- Calendário: meus plantões e plantões do dia ----------
// Turnos e escalas do grupo em tempo real: alocação, vaga, publicação e turnos novos aparecem
// na hora no calendário, na gaveta do dia e na lista de meses (Editar escala).
let liveShifts = null; // turnos do grupo
let schedules = null; // "AAAA-MM" → escala (só os meses que existem e a pessoa pode ver)
let stopCalendar = null;
let calendarWithDrafts = null;
let calendarReady;
let markCalendarReady;
const resetReady = () => (calendarReady = new Promise((resolve) => (markCalendarReady = resolve)));
resetReady();
let shownMonth = null;

// Começa (ou recomeça, se o papel mudou e a pessoa passou a ver rascunhos ou deixou de ver)
function listenCalendar() {
  const withDrafts = can(myRole, 'viewDraft');
  if (stopCalendar && withDrafts === calendarWithDrafts) return;
  stopCalendar?.();
  calendarWithDrafts = withDrafts;
  const changed = () => {
    if (!liveShifts || !schedules) return;
    markCalendarReady();
    refreshCalendarViews();
  };
  const stops = [
    listenWithRetry(schedulesQuery(groupId, withDrafts), (snapshot) => ((schedules = schedulesFrom(snapshot)), changed()), 'Escalas do grupo', {
      onError: () => ((schedules ??= new Map()), changed()),
    }),
    listenWithRetry(shiftsRef(groupId), (snapshot) => ((liveShifts = shiftsFrom(snapshot)), changed()), 'Turnos do grupo', {
      onError: () => ((liveShifts ??= {}), changed()),
    }),
  ];
  stopCalendar = () => stops.forEach((stop) => stop());
}

// Algo mudou: redesenha o que está na tela
const refreshCalendarViews = batched(() => {
  if (shownMonth) showMonth(shownMonth);
  if ($('drawer-day').open) renderDay();
  if (monthsLoaded !== null) renderMonthList(true);
});

const monthTitle = (month) => {
  const { year, monthIndex } = monthParts(month);
  const name = new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(new Date(year, monthIndex, 1));
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year}`;
};
const longDate = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
const shortDate = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
const dateOf = (month, day) => {
  const { year, monthIndex } = monthParts(month);
  return new Date(year, monthIndex, day);
};

async function monthData(month) {
  await calendarReady;
  return schedules.get(month) ?? null;
}

const calendar = createCalendar($('group-calendar'), {
  onMonthChange: (year, monthIndex) => showMonth(monthKey(year, monthIndex)),
  onSelect: (date) => openDay(monthKey(date.getFullYear(), date.getMonth()), date.getDate()),
});

async function showMonth(month) {
  shownMonth = month;
  $('my-shifts-title').textContent = `Meus plantões · ${monthTitle(month)}`;
  $('my-shifts').innerHTML = '<li class="muted">Carregando…</li>';
  $('my-shifts-note').textContent = '';
  let schedule;
  try {
    schedule = await monthData(month);
  } catch (error) {
    $('my-shifts').innerHTML = `<li class="muted">${escapeHtml(firebaseErrorMessage(error) ?? '')}</li>`;
    return;
  }
  if (shownMonth !== month) return; // trocou de mês enquanto carregava
  calendar.setMarks(userDays(schedule?.assignments, user.uid));

  const shifts = scheduleShifts(schedule, liveShifts);
  const mine = cellsOf(schedule?.assignments, user.uid).filter((c) => shifts[c.shiftId]);
  $('my-shifts-note').textContent = !schedule
    ? 'Ainda não há escala para este mês.'
    : schedule.status === 'draft'
      ? 'Escala em rascunho: só o Gestor e os coordenadores veem.'
      : `${mine.length} ${mine.length === 1 ? 'plantão' : 'plantões'} · ${formatHours(memberMinutes(schedule.assignments, shifts, user.uid))}`;
  $('my-shifts').innerHTML = mine.length
    ? mine
        .map(({ day, shiftId }) => {
          const shift = shifts[shiftId];
          return `<li><button type="button" class="my-shift" data-open-day="${day}">
            <span class="my-shift-date">${escapeHtml(shortDate.format(dateOf(month, day)))}</span>
            <strong>${escapeHtml(shift.title)}</strong>
            <span class="muted">${formatClock(shift.startMinute)} às ${formatClock(shift.endMinute)}</span>
          </button></li>`;
        })
        .join('')
    : schedule
      ? '<li class="muted">Você não tem plantões neste mês.</li>'
      : '';
}

$('my-shifts').addEventListener('click', (event) => {
  const item = event.target.closest('[data-open-day]');
  if (item) openDay(shownMonth, Number(item.dataset.openDay));
});

// Gaveta "Plantões do dia": faixa de 7 dias (meus dias com plantão em destaque),
// Dinâmica/Fixa e um cartão por turno. Clicar numa pessoa abre os detalhes do plantão.
const dayState = { month: null, day: 1, mode: 'dynamic', weekStart: null };
const WEEK_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const dateKey = (date) => ({ month: monthKey(date.getFullYear(), date.getMonth()), day: date.getDate() });
const addDays = (date, amount) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
const capitalizeFirst = (text) => text.charAt(0).toUpperCase() + text.slice(1);

async function openDay(month, day) {
  // A faixa começa 3 dias antes do dia escolhido (ele fica no meio)
  Object.assign(dayState, { month, day, weekStart: addDays(dateOf(month, day), -3) });
  if (!$('drawer-day').open) $('drawer-day').showModal();
  await renderDay();
}

async function renderWeek() {
  const days = Array.from({ length: 7 }, (_, i) => addDays(dayState.weekStart, i));
  const monthsInWeek = [...new Set(days.map((d) => dateKey(d).month))];
  const schedules = new Map(
    await Promise.all(monthsInWeek.map(async (m) => [m, await monthData(m).catch(() => null)])),
  );
  $('week-days').innerHTML = days
    .map((date) => {
      const { month, day } = dateKey(date);
      const mine = schedules.get(month)?.assignments
        ? userDays(schedules.get(month).assignments, user.uid).has(day)
        : false;
      const selected = month === dayState.month && day === dayState.day;
      return `<button type="button" class="week-day${mine ? ' has-shift' : ''}" data-week-day="${month}|${day}"
        aria-pressed="${selected}" aria-label="${escapeHtml(capitalizeFirst(longDate.format(date)))}${mine ? ', com plantão' : ''}">
        <span>${WEEK_SHORT[date.getDay()]}</span><strong>${day}</strong></button>`;
    })
    .join('');
}

const daySkeleton = () =>
  Array.from({ length: 3 }, () => `<div class="day-shift" aria-hidden="true">
      <span class="skeleton" style="height:16px;width:55%"></span>
      <span class="skeleton" style="height:28px;width:70%;margin-top:var(--esp-2)"></span></div>`).join('');

async function renderDay() {
  const { month, day } = dayState;
  $('day-label').textContent = capitalizeFirst(longDate.format(dateOf(month, day))); // "Terça-feira, 06/10/2026"
  $('day-shifts').innerHTML = daySkeleton();
  $('day-shifts').setAttribute('aria-busy', 'true');
  renderWeek();
  const schedule = await monthData(month).catch(() => null);
  if (dayState.month !== month || dayState.day !== day) return;
  $('day-shifts').setAttribute('aria-busy', 'false');

  const hasFixed = schedule?.status === 'published' && schedule.fixed;
  $('day-mode').hidden = !hasFixed;
  if (!hasFixed) dayState.mode = 'dynamic';
  $('day-mode').querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === dayState.mode)));

  if (!schedule) {
    $('day-shifts').innerHTML = `<div class="empty-state">${icon('calendar')}<h3>Sem escala</h3><p>${escapeHtml(monthTitle(month))} ainda não tem escala publicada.</p></div>`;
    return;
  }
  const shifts = scheduleShifts(schedule, liveShifts);
  const list = dayShifts(schedule, shifts, day, { fixed: dayState.mode === 'fixed' });
  if (!list.length) {
    $('day-shifts').innerHTML = '<p class="muted">O grupo não tem turnos cadastrados.</p>';
    return;
  }
  const byId = new Map(members.map((m) => [m.id, m]));
  $('day-shifts').innerHTML = list
    .map(({ shiftId, shift, uids, vacancies }) => {
      const people = uids
        .map((uid) => byId.get(uid) ?? { id: uid, name: 'Ex-membro' })
        .map(
          (m) => `<li><button type="button" class="day-person${m.id === user.uid ? ' is-me' : ''}" data-person="${escapeHtml(m.id)}" data-shift="${escapeHtml(shiftId)}">
            ${avatarHtml(m, 'avatar day-avatar')}
            <span class="day-person-name">${escapeHtml(m.name)}${m.id === user.uid ? ' <span class="muted">(você)</span>' : ''}</span>
            ${dayState.mode === 'dynamic' && pendingCessionOf(m.id, month, cellKey(day, shiftId)) ? '<span class="badge badge-warning">Cedendo</span>' : ''}
            ${icon('chevronRight')}</button></li>`,
        )
        .join('');
      const open = vacancies ? `<span class="badge badge-warning">${vacancies} ${vacancies === 1 ? 'vaga' : 'vagas'}</span>` : '';
      const request = dayState.mode === 'dynamic' ? requestHtml(schedule, shifts, month, cellKey(day, shiftId), vacancies) : '';
      // Coordenação: quantos pedidos esperam resposta neste turno (vaga e cessão)
      const waiting =
        dayState.mode === 'dynamic' && stopGroupRequests
          ? [...groupRequests, ...groupCessions].filter((r) => r.month === month && r.cell === cellKey(day, shiftId)).length
          : 0;
      const waitingBadge = waiting ? `<span class="badge badge-primary">${waiting} ${waiting === 1 ? 'pedido' : 'pedidos'}</span>` : '';
      return `<article class="day-shift">
        <header><strong>${escapeHtml(shift.title)} - ${formatClock(shift.startMinute)} às ${formatClock(shift.endMinute)}</strong><span class="day-shift-badges">${open}${waitingBadge}</span></header>
        ${people ? `<ul>${people}</ul>` : '<p class="muted text-sm">Ninguém escalado.</p>'}
        ${request}
      </article>`;
    })
    .join('');
}

$('drawer-day').addEventListener('click', (event) => {
  const weekNav = event.target.closest('[data-week-nav]');
  if (weekNav) {
    // Anda uma semana: a faixa e o dia escolhido
    const step = Number(weekNav.dataset.weekNav);
    dayState.weekStart = addDays(dayState.weekStart, step);
    Object.assign(dayState, dateKey(addDays(dateOf(dayState.month, dayState.day), step)));
    renderDay();
    return;
  }
  const weekDay = event.target.closest('[data-week-day]');
  if (weekDay) {
    const [month, day] = weekDay.dataset.weekDay.split('|');
    Object.assign(dayState, { month, day: Number(day) });
    renderDay();
    return;
  }
  const mode = event.target.closest('[data-mode]');
  if (mode) {
    dayState.mode = mode.dataset.mode;
    renderDay();
    return;
  }
  const ask = event.target.closest('[data-request-ask]');
  if (ask) {
    askVacancy(ask, ask.dataset.requestAsk);
    return;
  }
  const cancel = event.target.closest('[data-request-cancel]');
  if (cancel) {
    cancelVacancyRequest(cancel, cancel.dataset.requestCancel);
    return;
  }
  if (answerFromClick(event)) return;
  const person = event.target.closest('[data-person]');
  if (person) openShiftDetail(person.dataset.person, person.dataset.shift);
});

// ---------- Pedidos de plantão vago ----------
// Membro (sem poder alterar a escala): pede a vaga na gaveta do dia e acompanha o pedido.
// Gestor e coordenador do grupo: cartão no topo do Calendário e os pedidos de cada vaga na
// gaveta do dia, com Aceitar e Recusar (vacancy-requests.js).
let myRequests = new Map(); // docId → pedido meu neste grupo
let groupRequests = []; // pedidos pendentes do grupo (coordenação)
let stopMyRequests = null;
let stopGroupRequests = null;

const answersRequests = () => group.type === 'team' && can(myRole, 'editSchedule');
const asksVacancies = () => group.type === 'team' && canTakeShifts(group, user.uid) && !can(myRole, 'editSchedule');

// Liga ou desliga as escutas conforme o papel (o papel pode mudar com a página aberta)
function listenRequests() {
  if (asksVacancies() && !stopMyRequests) {
    stopMyRequests = watchMyRequests(user.uid, (list) => {
      myRequests = new Map(list.filter((r) => r.groupId === groupId).map((r) => [r.docId, r]));
      if ($('drawer-day').open) renderDay();
    });
  } else if (!asksVacancies() && stopMyRequests) {
    stopMyRequests();
    stopMyRequests = null;
    myRequests = new Map();
  }
  if (answersRequests() && !stopGroupRequests) {
    stopGroupRequests = watchGroupRequests(groupId, (list) => {
      groupRequests = list;
      renderRequests();
      if ($('drawer-day').open) renderDay();
    });
  } else if (!answersRequests() && stopGroupRequests) {
    stopGroupRequests();
    stopGroupRequests = null;
    groupRequests = [];
  }
}

// Quem entra no plantão: quem pediu a vaga ou o colega que recebe a cessão
const enteringUid = (r, kind) => (kind === 'cession' ? r.toUid : r.uid);
const stillMember = (r, kind = 'vacancy') => Boolean(group?.memberIds?.includes(enteringUid(r, kind)));

// Quem saiu do grupo não pode mais entrar na escala: o pedido só pode ser recusado
const answerButtons = (r, kind = 'vacancy') => `<button type="button" class="btn btn-secondary" data-request-answer="no">Recusar</button>
  ${stillMember(r, kind) ? `<button type="button" class="btn btn-primary" data-request-answer="yes">${kind === 'cession' ? 'Aprovar' : 'Aceitar'}</button>` : ''}`;

const memberName = (uid, fallback) => members.find((m) => m.id === uid)?.name ?? fallback;

// Pedidos pendentes de vaga e de cessão, por data do plantão
function pendingItems() {
  return [
    ...groupRequests.map((r) => ({ kind: 'vacancy', r })),
    ...groupCessions.map((r) => ({ kind: 'cession', r })),
  ].sort(
    (a, b) =>
      String(a.r.shiftDate).localeCompare(String(b.r.shiftDate)) || String(a.r.shiftStart).localeCompare(String(b.r.shiftStart)),
  );
}

// "pediu o plantão vago Diurno de 02/12 ..." ou "quer ceder o plantão ... para Ana"
const pendingText = ({ kind, r }) =>
  kind === 'cession'
    ? `quer ceder o plantão ${requestShiftText(r)} para <strong>${escapeHtml(memberName(r.toUid, r.toName))}</strong>${stillMember(r, kind) ? '' : ' (saiu do grupo)'}`
    : `pediu o plantão vago ${requestShiftText(r)}${stillMember(r, kind) ? '' : ' · saiu do grupo'}`;

// Cartão "Solicitações para a coordenação" (só aparece com pedido esperando)
function renderRequests() {
  const box = $('vacancy-requests');
  const items = pendingItems();
  box.hidden = !items.length;
  if (!items.length) {
    box.innerHTML = '';
    return;
  }
  const byId = new Map(members.map((m) => [m.id, m]));
  box.innerHTML = `<h2 class="requests-title">${icon('hourglass')}Solicitações para a coordenação (${items.length})</h2>
    <p class="muted text-sm">Pedidos de plantão vago e de cessão. Quem pediu recebe a resposta no sininho.</p>
    <ul class="request-list">${items
      .map((item) => {
        const { kind, r } = item;
        const person = byId.get(r.uid) ?? { id: r.uid, name: r.name };
        return `<li class="request-item" data-request="${escapeHtml(r.docId)}" data-kind="${kind}">
          ${avatarHtml(person, 'avatar day-avatar')}
          <div class="request-info">
            <strong>${escapeHtml(person.name ?? r.name)}</strong>
            <span class="muted">${pendingText(item)}</span>
          </div>
          <div class="request-actions">
            <button type="button" class="btn btn-ghost" data-request-day="${escapeHtml(r.shiftDate)}">Ver o dia</button>
            ${answerButtons(r, kind)}
          </div>
        </li>`;
      })
      .join('')}</ul>`;
}

$('vacancy-requests').addEventListener('click', (event) => {
  const day = event.target.closest('[data-request-day]');
  if (day) {
    openDay(day.dataset.requestDay.slice(0, 7), Number(day.dataset.requestDay.slice(8)));
    return;
  }
  answerFromClick(event);
});

// Aceitar/Aprovar ou Recusar (no cartão ou na gaveta do dia). true se o clique foi num desses botões.
function answerFromClick(event) {
  const button = event.target.closest('[data-request-answer]');
  if (!button) return false;
  const holder = button.closest('[data-request]');
  const kind = holder?.dataset.kind ?? 'vacancy';
  const list = kind === 'cession' ? groupCessions : groupRequests;
  const request = list.find((r) => r.docId === holder?.dataset.request);
  if (!request) return true;
  const yes = button.dataset.requestAnswer === 'yes';
  (async () => {
    setLoading(button, true);
    const ok =
      kind === 'cession'
        ? await answerCession(request, yes, { deciderName: profile?.name })
        : await answerRequest(request, yes, { deciderName: profile?.name, pending: groupRequests });
    if (!ok && button.isConnected) setLoading(button, false);
  })();
  return true;
}

// Bloco embaixo de cada turno na gaveta do dia (só na escala dinâmica publicada)
function requestHtml(schedule, shifts, month, key, vacancies) {
  if (schedule?.status !== 'published') return '';
  if (stopGroupRequests) {
    const asked = groupRequests.filter((r) => r.month === month && r.cell === key);
    const ceded = groupCessions.filter((r) => r.month === month && r.cell === key);
    // Cada pedido como o médico vê o dele: foto, nome, selo e os botões de resposta
    const row = (r, kind, label, badge) => `<li class="day-request-person" data-request="${escapeHtml(r.docId)}" data-kind="${kind}">
        ${avatarHtml(members.find((m) => m.id === r.uid) ?? { id: r.uid, name: r.name }, 'avatar day-avatar')}
        <div class="day-request-who">
          <strong>${label}</strong>
          <span>${badge}${stillMember(r, kind) ? '' : ' <span class="muted text-sm">saiu do grupo</span>'}</span>
        </div>
        <span class="request-actions">${answerButtons(r, kind)}</span>
      </li>`;
    const vacancyHtml = asked.length
      ? `<span class="day-request-title">Pedidos desta vaga (${asked.length})</span>
        <ul class="day-request-list">${asked
          .map((r) => row(r, 'vacancy', escapeHtml(memberName(r.uid, r.name)), '<span class="badge badge-warning">Pedido enviado</span>'))
          .join('')}</ul>`
      : '';
    const cessionHtmlBlock = ceded.length
      ? `<span class="day-request-title">Cessões pedidas (${ceded.length})</span>
        <ul class="day-request-list">${ceded
          .map((r) =>
            row(
              r,
              'cession',
              `${escapeHtml(memberName(r.uid, r.name))} → ${escapeHtml(memberName(r.toUid, r.toName))}`,
              '<span class="badge badge-warning">Cessão pedida</span>',
            ),
          )
          .join('')}</ul>`
      : '';
    return vacancyHtml || cessionHtmlBlock
      ? `<div class="day-request">${vacancyHtml}${cessionHtmlBlock}
          <p class="muted text-sm">Aguardando a sua resposta. Quem pediu recebe o aviso no sininho.</p>
        </div>`
      : '';
  }
  if (!stopMyRequests) return '';
  const mine = myRequests.get(requestId(month, key, user.uid));
  if (mine?.status === 'pending') {
    return `<div class="day-request">
      <div class="day-request-status">
        <span class="badge badge-warning">Pedido enviado</span>
        <button type="button" class="btn btn-ghost" data-request-cancel="${escapeHtml(mine.docId)}">Cancelar pedido</button>
      </div>
      <p class="muted text-sm">A coordenação da escala vai aceitar ou recusar. A resposta chega no sininho.</p>
    </div>`;
  }
  if (!vacancies) return '';
  const block = requestBlock(schedule, shifts, user.uid, month, key);
  if (block === 'assigned') return '';
  const declined = mine?.status === 'declined' ? '<p class="muted text-sm">Seu pedido anterior para esta vaga foi recusado.</p>' : '';
  if (block) return `<div class="day-request">${declined}<p class="muted text-sm">${BLOCK_TEXT[block]}</p></div>`;
  return `<div class="day-request">${declined}
    <button type="button" class="btn btn-primary" data-request-ask="${escapeHtml(key)}">${icon('userPlus')}${mine ? 'Pedir de novo' : 'Solicitar plantão'}</button>
  </div>`;
}

async function askVacancy(button, key) {
  const { month } = dayState;
  const schedule = await monthData(month).catch(() => null);
  const shifts = scheduleShifts(schedule, liveShifts);
  const block = requestBlock(schedule, shifts, user.uid, month, key);
  if (block) {
    toast(BLOCK_TEXT[block], 'error');
    return;
  }
  setLoading(button, true);
  try {
    await requestVacancy(group, month, key, shifts[parseCellKey(key).shiftId], profile?.name);
    toast('Pedido enviado. A coordenação da escala vai aceitar ou recusar.', 'success');
  } catch (error) {
    toast(firebaseErrorMessage(error), 'error');
    if (button.isConnected) setLoading(button, false);
  }
}

async function cancelVacancyRequest(button, docId) {
  setLoading(button, true);
  try {
    await removeRequest(groupId, docId);
    toast('Pedido cancelado.');
  } catch (error) {
    toast(firebaseErrorMessage(error), 'error');
    if (button.isConnected) setLoading(button, false);
  }
}

// ---------- Detalhes do plantão ----------
const detailDate = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

async function openShiftDetail(uid, shiftId) {
  const { month, day, mode } = dayState;
  const schedule = await monthData(month).catch(() => null);
  const shift = scheduleShifts(schedule, liveShifts)[shiftId];
  if (!shift) return;
  const source = (mode === 'fixed' ? schedule?.fixed : schedule?.assignments) ?? {};
  const byId = new Map(members.map((m) => [m.id, m]));
  const person = byId.get(uid) ?? { id: uid, name: 'Ex-membro' };
  const others = (source[cellKey(day, shiftId)] ?? []).filter((id) => id !== uid).map((id) => byId.get(id) ?? { id, name: 'Ex-membro' });
  const work = [professionLabel(person), councilLabel(person.council)].filter(Boolean);
  const unit = groupSubtitle(group);

  $('shift-detail').innerHTML = `
    <div class="detail-group">
      <span class="group-avatar" style="background:${escapeHtml(groupColor(group.color))}" aria-hidden="true">${escapeHtml(initials(group.name))}</span>
      <div><strong>${escapeHtml(group.name)}</strong><span class="muted">${escapeHtml(unit)}</span></div>
    </div>
    <div class="detail-person">
      ${avatarHtml(person, 'avatar detail-avatar')}
      <div>
        <strong>${escapeHtml(person.name)}${person.id === user.uid ? ' <span class="muted">(você)</span>' : ''}</strong>
        ${work.map((line) => `<span class="muted">${escapeHtml(line)}</span>`).join('')}
      </div>
    </div>
    <h3 class="section-title">Detalhes do plantão</h3>
    <div class="detail-shift">
      ${icon('calendar')}
      <div>
        <strong>${escapeHtml(capitalizeFirst(detailDate.format(dateOf(month, day))))}</strong>
        <span>${formatClock(shift.startMinute)} - ${formatClock(shift.endMinute)} (${escapeHtml(shift.title)})</span>
      </div>
    </div>
    <h3 class="section-title">Quem mais está no plantão?</h3>
    ${
      others.length
        ? `<ul class="detail-others">${others
            .map((m) => `<li>${avatarHtml(m, 'avatar day-avatar')}<div><strong>${escapeHtml(m.name)}</strong>
              <span class="muted">${escapeHtml(professionLabel(m) || '')}</span></div></li>`)
            .join('')}</ul>`
        : '<p class="muted">Não há outro profissional neste plantão.</p>'
    }
    ${uid === user.uid && mode === 'dynamic' ? cessionHtml(schedule, scheduleShifts(schedule, liveShifts), month, cellKey(day, shiftId)) : ''}`;
  detailState = { uid, shiftId, month, day };
  if (!$('drawer-shift').open) $('drawer-shift').showModal();
}

// Fechar (X) fecha as duas gavetas; a seta só volta para os plantões do dia
$('close-shift-drawers').addEventListener('click', () => {
  $('drawer-shift').close();
  $('drawer-day').close();
});
$('drawer-shift').addEventListener('click', (event) => {
  if (event.target === $('drawer-shift')) {
    $('drawer-shift').close();
    return;
  }
  if (event.target.closest('[data-cession-open]')) {
    openCessionModal();
    return;
  }
  const cancel = event.target.closest('[data-cession-cancel]');
  if (cancel) cancelMyCession(cancel, cancel.dataset.cessionCancel);
});

// ---------- Cessão direcionada ----------
// Quem está no plantão (membro sem poder alterar a escala) escolhe um colega do grupo nos
// detalhes do plantão; a coordenação aprova ou recusa (cession-requests.js). Gestor e
// coordenador alteram a escala direto, então não pedem cessão.
let detailState = null; // plantão aberto nos detalhes: { uid, shiftId, month, day }
let myCessions = new Map(); // docId → cessão que eu pedi neste grupo
let groupCessions = []; // cessões pendentes do grupo (coordenação)
let stopMyCessions = null;
let stopGroupCessions = null;

// Redesenha o que mostra cessões (detalhes do plantão aberto e a gaveta do dia)
function refreshCessionViews() {
  if ($('drawer-day').open) renderDay();
  if ($('drawer-shift').open && detailState?.month === dayState.month && detailState?.day === dayState.day) {
    openShiftDetail(detailState.uid, detailState.shiftId);
  }
}

function listenCessions() {
  if (asksVacancies() && !stopMyCessions) {
    stopMyCessions = watchMyCessions(user.uid, ({ mine }) => {
      myCessions = new Map(mine.filter((c) => c.groupId === groupId).map((c) => [c.docId, c]));
      refreshCessionViews();
    });
  } else if (!asksVacancies() && stopMyCessions) {
    stopMyCessions();
    stopMyCessions = null;
    myCessions = new Map();
  }
  if (answersRequests() && !stopGroupCessions) {
    stopGroupCessions = watchGroupCessions(groupId, (list) => {
      groupCessions = list;
      renderRequests();
      refreshCessionViews();
    });
  } else if (!answersRequests() && stopGroupCessions) {
    stopGroupCessions();
    stopGroupCessions = null;
    groupCessions = [];
  }
}

// Cessão pendente de alguém num plantão (para o selo "Cedendo" na gaveta do dia)
const pendingCessionOf = (uid, month, key) =>
  [...myCessions.values(), ...groupCessions].find((c) => c.status === 'pending' && c.uid === uid && c.month === month && c.cell === key);

// Seção "Ceder este plantão" nos detalhes do meu plantão
function cessionHtml(schedule, shifts, month, key) {
  if (!stopMyCessions) return '';
  const mine = myCessions.get(requestId(month, key, user.uid));
  if (mine?.status === 'pending') {
    return `<h3 class="section-title">Cessão</h3>
      <div class="detail-cession">
        <div class="day-request-status">
          <span class="badge badge-warning">Aguardando a coordenação</span>
          <button type="button" class="btn btn-ghost" data-cession-cancel="${escapeHtml(mine.docId)}">Cancelar cessão</button>
        </div>
        <p class="muted text-sm">Você pediu para ceder este plantão para <strong>${escapeHtml(mine.toName)}</strong>.</p>
      </div>`;
  }
  const block = cessionBlock(schedule, shifts, user.uid, month, key);
  if (block) return '';
  const declined =
    mine?.status === 'declined'
      ? `<p class="muted text-sm">A coordenação recusou a cessão anterior (para ${escapeHtml(mine.toName)}).</p>`
      : '';
  return `<h3 class="section-title">Cessão</h3>
    <div class="detail-cession">
      ${declined}
      <button type="button" class="btn btn-secondary" data-cession-open>${icon('arrowRight')}Ceder plantão</button>
      <p class="muted text-sm">Escolha um colega do grupo. A cessão vale depois que a coordenação da escala aprovar.</p>
    </div>`;
}

// Janela "Ceder plantão": colegas do grupo; quem já está no plantão ou tem outro no horário fica bloqueado
let cessionTarget = null; // { month, key, shift, schedule, shifts }

async function openCessionModal() {
  if (!detailState) return;
  const { month, day, shiftId } = detailState;
  const schedule = await monthData(month).catch(() => null);
  const shifts = scheduleShifts(schedule, liveShifts);
  const key = cellKey(day, shiftId);
  const block = cessionBlock(schedule, shifts, user.uid, month, key);
  if (block) {
    toast(CESSION_BLOCK_TEXT[block], 'error');
    return;
  }
  const shift = shifts[shiftId];
  cessionTarget = { month, key, shift, schedule, shifts };
  $('cession-shift').textContent = `${capitalizeFirst(detailDate.format(dateOf(month, day)))} · ${shift.title} (${formatClock(shift.startMinute)} às ${formatClock(shift.endMinute)})`;
  $('cession-search').value = '';
  renderCessionPeople();
  setLoading($('cession-submit'), false);
  $('modal-cession').showModal();
  $('cession-search').focus();
}

function renderCessionPeople() {
  if (!cessionTarget) return;
  const { schedule, shifts, key } = cessionTarget;
  const chosen = $('cession-people').querySelector('input:checked')?.value;
  const term = normalize($('cession-search').value);
  const people = members
    .filter((m) => m.id !== user.uid && group.memberIds.includes(m.id))
    .filter((m) => !term || normalize(m.name ?? '').includes(term))
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'pt-BR'));
  $('cession-people').innerHTML = people.length
    ? people
        .map((m) => {
          const block = receiverBlock(schedule, shifts, m.id, key);
          return `<li><label class="cession-person${block ? ' is-blocked' : ''}">
            <input type="radio" name="cession-to" value="${escapeHtml(m.id)}"${block ? ' disabled' : ''}${chosen === m.id && !block ? ' checked' : ''} />
            ${avatarHtml(m, 'avatar day-avatar')}
            <span class="cession-person-name">${escapeHtml(m.name)}${
              block ? `<small>${RECEIVER_BLOCK_TEXT[block]}</small>` : professionLabel(m) ? `<small>${escapeHtml(professionLabel(m))}</small>` : ''
            }</span>
          </label></li>`;
        })
        .join('')
    : `<li class="muted text-sm">${term ? 'Nenhum colega com esse nome.' : 'Não há outros colegas no grupo.'}</li>`;
}

$('cession-search').addEventListener('input', renderCessionPeople);

$('cession-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const toUid = $('cession-people').querySelector('input:checked')?.value;
  if (!toUid) {
    toast('Escolha para quem você quer ceder o plantão.', 'error');
    return;
  }
  const to = members.find((m) => m.id === toUid);
  const { month, key, shift } = cessionTarget;
  const button = $('cession-submit');
  setLoading(button, true);
  try {
    await requestCession(group, month, key, shift, profile?.name, to);
    $('modal-cession').close();
    toast(`Pedido de cessão para ${to.name} enviado. A coordenação da escala vai aprovar ou recusar.`, 'success', 6000);
  } catch (error) {
    toast(firebaseErrorMessage(error), 'error');
  }
  setLoading(button, false);
});

async function cancelMyCession(button, docId) {
  setLoading(button, true);
  try {
    await cancelCession(groupId, docId);
    toast('Cessão cancelada. Você continua no plantão.');
  } catch (error) {
    toast(firebaseErrorMessage(error), 'error');
    if (button.isConnected) setLoading(button, false);
  }
}

// ---------- Editar escala: meses do ano ----------
let listYear = new Date().getFullYear();
let monthsLoaded = null; // ano já carregado na lista

const STATUS = {
  none: ['Sem escala', 'badge-muted'],
  draft: ['Em rascunho', 'badge-warning'],
  published: ['Publicada', 'badge-primary'],
};

async function renderMonthList(force = false) {
  if (!can(myRole, 'editSchedule')) return;
  if (monthsLoaded === listYear && !force) return;
  monthsLoaded = listYear;
  const year = listYear;
  $('year-label').textContent = year;
  if (!force) $('month-list').innerHTML = '<li class="muted">Carregando…</li>';
  // Mais recente primeiro
  const keys = Array.from({ length: 12 }, (_, i) => monthKey(year, 11 - i));
  const data = await Promise.all(keys.map((m) => monthData(m)));
  if (year !== listYear) return;
  $('month-list').innerHTML = keys
    .map((m, i) => {
      const [label, badge] = STATUS[data[i]?.status ?? 'none'];
      return `<li class="month-item">
        <div><strong>${escapeHtml(monthTitle(m))}</strong> <span class="badge ${badge}">${label}</span></div>
        <a class="btn btn-secondary" href="/schedule-edit.html?group=${encodeURIComponent(groupId)}&month=${m}">${icon('edit')}Editar escala</a>
      </li>`;
    })
    .join('');
}

$('year-prev').addEventListener('click', () => {
  listYear -= 1;
  renderMonthList();
});
$('year-next').addEventListener('click', () => {
  listYear += 1;
  renderMonthList();
});
$('tab-schedule').addEventListener('click', () => renderMonthList());

// ---------- Dados em tempo real ----------
let firstLoad = true;

onSnapshot(
  doc(db, 'groups', groupId),
  (snapshot) => {
    if (!snapshot.exists()) return goAway('Este grupo não existe mais.');
    group = { id: snapshot.id, ...snapshot.data() };
    myRole = groupRole(group, user.uid, platformRole);
    if (!myRole) return goAway('Você não tem mais acesso a este grupo.');

    renderHeader();
    const isTeam = group.type === 'team';
    $('tab-members').hidden = !isTeam;
    $('tab-schedule').hidden = !can(myRole, 'editSchedule');
    $('invite-button').hidden = !can(myRole, 'manageMembers');
    listenInvites();
    listenCalendar();
    listenRequests();
    listenCessions();
    renderRequests();
    renderMembers();
    renderInvites();

    if (firstLoad) {
      firstLoad = false;
      const fromHash = { '#membros': isTeam && $('tab-members'), '#escala': !$('tab-schedule').hidden && $('tab-schedule') }[location.hash];
      selectTab(fromHash || $('tab-calendar'));
      if (fromHash === $('tab-schedule')) renderMonthList();
      // Veio da tela de Escalas pelo plantão de um dia (?dia=AAAA-MM-DD): abre a gaveta daquele dia
      const dia = new URLSearchParams(location.search).get('dia');
      if (/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(dia ?? '')) {
        history.replaceState(null, '', `${location.pathname}?id=${encodeURIComponent(groupId)}${location.hash}`);
        openDay(dia.slice(0, 7), Number(dia.slice(8)));
      }
    }
  },
  (error) => {
    if (error.code === 'permission-denied') goAway('Você não tem mais acesso a este grupo.');
    else if (!isLeaving()) toast(firebaseErrorMessage(error), 'error');
  },
);

onSnapshot(
  collection(db, 'groups', groupId, 'members'),
  (snapshot) => {
    members = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (group) {
      renderMembers();
      renderRequests();
    }
    if ($('drawer-day').open) renderDay();
  },
  () => {}, // sem acesso: o listener do grupo já cuida de sair da página
);
