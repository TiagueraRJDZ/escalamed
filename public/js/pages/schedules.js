// Tela de Escalas: lista de grupos do usuário, menu "+", calendário e disponíveis.
import { onSnapshot } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { isLeaving } from '../firebase.js';
import { initLayout } from '../layout.js';
import { icon, renderIcons } from '../icons.js';
import { createCalendar } from '../calendar.js';
import { escapeHtml, initials, setupMenu, toast, setLoading, firebaseErrorMessage } from '../ui.js';
import { normalize } from '../validators.js';
import { groupColor } from '/data/colors.js';
import { isMember, canCreateTeam, canEditSettings } from '../permissions.js';
import { groupQueries, mergeGroups } from '../my-groups.js';
import { myApprovalState } from '../access.js';
import { categoryName } from '/data/categories.js';
import { onInvitesChange, respondInvite, inviteText } from '../notifications.js';
import { monthKey, userDays, dayShifts } from '../schedule-math.js';
import { loadSchedule, loadShifts, scheduleShifts } from '../schedule-data.js';
import { formatClock } from '../shifts.js';
import { isoDate } from '../dates.js';

renderIcons();
const { user, profile, access } = await initLayout({ active: 'schedules' });
const platformRole = access.role;

// "Criar novo grupo" só para Gestor e Coordenador de escala (cargo aprovado)
document.getElementById('new-team').hidden = !canCreateTeam(platformRole);

// Cargo pedido ainda sem aprovação: avisa que, por enquanto, vale o acesso de membro
if (myApprovalState(profile, access) === 'pending') {
  const notice = document.getElementById('approval-notice');
  notice.textContent = `Seu cargo de ${categoryName(profile.categoryId)} está aguardando aprovação de um Gestor ou do administrador. Até lá, você vê só os grupos em que está.`;
  notice.hidden = false;
}

const listEl = document.getElementById('group-list');
const searchInput = document.getElementById('group-search');
let groups = [];
let loaded = false;

setupMenu(document.getElementById('new-button'), document.getElementById('new-menu'));
// ---------- Calendário e plantões do dia ----------
// Marca os dias em que o usuário tem plantão (fundo azul) e os dias com vaga aberta
// numa escala publicada (ponto laranja), em todos os grupos. Clicar num dia mostra
// embaixo os plantões dele naquele dia e as vagas abertas ("Disponíveis").
const today = new Date();
today.setHours(0, 0, 0, 0);
let selectedDate = today;
let calendarMonth = null;
let groupsKey = null; // grupos prontos; quando muda, as escalas são lidas de novo
const monthCache = new Map(); // "YYYY-MM" → Promise<[{ group, schedule, shifts }]>
const shiftsCache = new Map(); // groupId → Promise<turnos do grupo>

// Calendário: só os grupos em que a pessoa está na escala (Gestor e Administrativo veem
// todos os grupos na lista, mas os plantões e vagas do calendário são os da pessoa)
const readyGroups = () => groups.filter((g) => g.setupStep === 'done' && isMember(g, user.uid));

// Escalas do mês em todos os grupos prontos (só as que existem e a pessoa pode ler)
function monthEntries(month) {
  if (!monthCache.has(month)) {
    const promise = Promise.all(
      readyGroups().map(async (group) => {
        const schedule = await loadSchedule(group.id, month);
        if (!schedule) return null;
        if (!shiftsCache.has(group.id)) shiftsCache.set(group.id, loadShifts(group.id).catch(() => ({})));
        return { group, schedule, shifts: scheduleShifts(schedule, await shiftsCache.get(group.id)) };
      }),
    ).then((list) => list.filter(Boolean));
    promise.catch(() => monthCache.delete(month)); // erro de rede: tenta de novo na próxima vez
    monthCache.set(month, promise);
  }
  return monthCache.get(month);
}

// Vagas abertas só contam em escala publicada (rascunho ainda pode mudar)
const isPublished = (schedule) => schedule.status === 'published';

// Vagas abertas do dia em que a pessoa ainda não está
const openSlots = (schedule, key) =>
  isPublished(schedule) && !schedule.assignments?.[key]?.includes(user.uid) ? schedule.vacancies?.[key] ?? 0 : 0;

async function markDays() {
  if (!loaded || !calendarMonth) return;
  const month = calendarMonth;
  const entries = await monthEntries(month).catch(() => []);
  if (month !== calendarMonth) return; // trocou de mês enquanto carregava
  const mine = new Set();
  const open = new Set();
  for (const { schedule, shifts } of entries) {
    userDays(schedule.assignments, user.uid).forEach((day) => mine.add(day));
    for (const key of Object.keys(schedule.vacancies ?? {})) {
      if (shifts[key.slice(3)] && openSlots(schedule, key) > 0) open.add(Number(key.slice(0, 2)));
    }
  }
  calendar.setMarks(mine, open);
}

const calendar = createCalendar(document.getElementById('calendar'), {
  selected: today,
  toggle: false,
  onMonthChange: (year, monthIndex) => {
    calendarMonth = monthKey(year, monthIndex);
    markDays();
  },
  onSelect: (date) => {
    selectedDate = date;
    renderDay();
  },
});

// ---------- Painel do dia escolhido ----------
const dayPanel = document.getElementById('day-panel');
const dayTitle = document.getElementById('day-title');
const longDay = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

const panelSkeleton = () =>
  `<div class="card day-card" aria-hidden="true">${'<div class="home-shift-skeleton"><span class="skeleton"></span><div><span class="skeleton"></span><span class="skeleton"></span></div></div>'.repeat(2)}</div>`;

// Um plantão (seu ou vago) do dia: abre o grupo já na gaveta daquele dia
function shiftItem({ group, shift, date, badge = '' }) {
  return `<li><a class="home-shift" href="/group.html?id=${encodeURIComponent(group.id)}&dia=${isoDate(date)}">
    <span class="group-avatar" style="background:${escapeHtml(groupColor(group.color))}" aria-hidden="true">${escapeHtml(initials(group.name))}</span>
    <span class="home-shift-info">
      <strong>${escapeHtml(shift.title)} · ${formatClock(shift.startMinute)} às ${formatClock(shift.endMinute)}</strong>
      <span>${escapeHtml(group.name)}</span>
    </span>
    ${badge}
    ${icon('chevronRight')}
  </a></li>`;
}

const sectionHtml = (title, items, empty) => `<div class="card day-card">
    <h3 class="day-card-title">${title} (${items.length})</h3>
    ${items.length ? `<ul class="home-shifts">${items.join('')}</ul>` : `<p class="day-empty">${empty}</p>`}
  </div>`;

let dayRequest = 0;

async function renderDay() {
  const date = selectedDate;
  const id = ++dayRequest;
  const isToday = date.getTime() === today.getTime();
  dayTitle.innerHTML = `<span class="day-title-text">${escapeHtml(capitalize(longDay.format(date)))}</span>${isToday ? '<span class="badge badge-primary">Hoje</span>' : ''}`;
  if (!loaded) {
    dayPanel.innerHTML = panelSkeleton();
    return; // desenha de novo quando os grupos chegarem
  }
  if (!readyGroups().length) {
    dayPanel.setAttribute('aria-busy', 'false');
    dayPanel.innerHTML = `<div class="card"><div class="empty-state">${icon('calendar')}<h3>Nenhuma escala ainda</h3>
      <p>Quando você fizer parte de um grupo com escala, os plantões de cada dia aparecem aqui.</p></div></div>`;
    return;
  }
  dayPanel.setAttribute('aria-busy', 'true');
  dayPanel.innerHTML = panelSkeleton();
  let entries;
  try {
    entries = await monthEntries(monthKey(date.getFullYear(), date.getMonth()));
  } catch (error) {
    if (id !== dayRequest || isLeaving()) return;
    console.error(error);
    dayPanel.setAttribute('aria-busy', 'false');
    dayPanel.innerHTML = `<div class="card"><div class="empty-state">${icon('x')}<h3>Não foi possível carregar os plantões</h3>
      <p>Verifique sua conexão e tente de novo.</p>
      <button type="button" class="btn btn-secondary" data-retry>Tentar de novo</button></div></div>`;
    return;
  }
  if (id !== dayRequest) return; // escolheu outro dia enquanto carregava

  const day = date.getDate();
  const mine = [];
  const open = [];
  for (const { group, schedule, shifts } of entries) {
    for (const { shiftId, shift, uids } of dayShifts(schedule, shifts, day)) {
      if (uids.includes(user.uid)) {
        const badge = isPublished(schedule) ? '' : '<span class="badge badge-muted">Rascunho</span>';
        mine.push({ start: shift.startMinute, html: shiftItem({ group, shift, date, badge }) });
        continue;
      }
      const slots = openSlots(schedule, `${String(day).padStart(2, '0')}_${shiftId}`);
      if (slots > 0) {
        const badge = `<span class="badge badge-warning">${slots} ${slots === 1 ? 'vaga' : 'vagas'}</span>`;
        open.push({ start: shift.startMinute, html: shiftItem({ group, shift, date, badge }) });
      }
    }
  }
  const sorted = (list) => list.sort((a, b) => a.start - b.start).map((item) => item.html);
  dayPanel.setAttribute('aria-busy', 'false');
  dayPanel.innerHTML =
    sectionHtml('Seus plantões', sorted(mine), isToday ? 'Você não tem plantão hoje.' : 'Você não tem plantão neste dia.') +
    sectionHtml('Disponíveis', sorted(open), 'Nenhuma vaga aberta neste dia. Plantões vagos nos seus grupos aparecem aqui.');
}

dayPanel.addEventListener('click', (event) => {
  if (event.target.closest('[data-retry]')) renderDay();
});

// Os grupos mudaram (entrou, saiu, terminou a configuração): lê as escalas de novo
function refreshCalendar() {
  const key = readyGroups()
    .map((g) => g.id)
    .join(',');
  if (key === groupsKey) return;
  groupsKey = key;
  monthCache.clear();
  markDays();
  renderDay();
}
renderDay();

// Aviso depois de concluir o wizard
const params = new URLSearchParams(location.search);
if (params.has('created')) {
  toast('Grupo criado com sucesso!', 'success');
  history.replaceState(null, '', location.pathname);
}
// Veio de Relatórios sem ter acesso a nenhum grupo
if (params.get('aviso') === 'relatorios') {
  toast('Relatórios é para Gestor, Coordenador de escala e Administrativo.', 'error', 6000);
  history.replaceState(null, '', location.pathname);
}

// ---------- Lista ----------
function skeleton() {
  const row = `<li class="group-skeleton" aria-hidden="true">
      <span class="skeleton"></span>
      <div><span class="skeleton" style="height:14px;width:55%"></span><span class="skeleton" style="height:12px;width:35%"></span></div>
    </li>`;
  return row.repeat(4);
}

function groupSubtitle(group) {
  if (group.type === 'personal') return 'Escala individual';
  if (!group.unit) return 'Sem unidade definida';
  return `${group.unit.name} · ${group.unit.city}/${group.unit.state}`;
}

function groupItem(group) {
  const pending = group.setupStep !== 'done';
  const href = pending ? `/group-new.html?id=${group.id}` : `/group.html?id=${group.id}`;
  const badges = pending ? '<span class="badge badge-warning">Configuração pendente</span>' : '';

  return `<li>
    <a class="group-item" href="${href}">
      <span class="group-avatar" style="background:${escapeHtml(groupColor(group.color))}" aria-hidden="true">${escapeHtml(initials(group.name))}</span>
      <span class="group-info">
        <strong>${escapeHtml(group.name)}</strong>
        <span>${escapeHtml(groupSubtitle(group))}</span>
      </span>
      <span class="group-badges">${badges}</span>
      ${icon('chevronRight')}
    </a>
  </li>`;
}

// Seções pela relação da pessoa com cada grupo; escalas individuais por último
const SECTION_TITLES = {
  coordinator: 'Coordeno',
  member: 'Participo',
  other: 'Outros grupos',
  personal: 'Escalas individuais',
  otherPersonal: 'Escalas individuais de outras pessoas', // só o Dev vê
};

function sectionKey(g) {
  if (g.type === 'personal') return g.ownerId === user.uid ? 'personal' : 'otherPersonal';
  if (g.role === 'coordinator') return 'coordinator';
  return isMember(g, user.uid) ? 'member' : 'other';
}

function sectionsHtml(list) {
  const keyOf = sectionKey;
  return Object.keys(SECTION_TITLES)
    .map((key) => {
      const items = list.filter((g) => keyOf(g) === key);
      if (!items.length) return '';
      return `<li class="group-section"><h2>${SECTION_TITLES[key]}</h2></li>${items.map(groupItem).join('')}`;
    })
    .join('');
}

function emptyState() {
  const creates = canCreateTeam(platformRole);
  return `<li class="empty-state">
    ${icon('users')}
    <h3>Você ainda não participa de nenhum grupo</h3>
    <p>${
      creates
        ? 'Crie um grupo para montar a escala da sua equipe ou uma escala individual para organizar seus plantões.'
        : 'Quando um Gestor ou Coordenador de escala convidar você, o grupo aparece aqui. Enquanto isso, você pode criar uma escala individual.'
    }</p>
    <div class="empty-actions">
      ${creates ? `<a class="btn btn-primary" href="/group-new.html?type=team">${icon('plus')}Criar novo grupo</a>` : ''}
      <a class="btn ${creates ? 'btn-secondary' : 'btn-primary'}" href="/group-new.html?type=personal">Criar escala individual</a>
    </div>
  </li>`;
}

function render() {
  if (!loaded) {
    listEl.innerHTML = skeleton();
    return;
  }
  listEl.setAttribute('aria-busy', 'false');
  if (!groups.length) {
    listEl.innerHTML = emptyState();
    return;
  }

  const term = normalize(searchInput.value);
  const filtered = term
    ? groups.filter((g) => normalize(`${g.name} ${g.unit?.name ?? ''} ${g.unit?.city ?? ''}`).includes(term))
    : groups;

  listEl.innerHTML = filtered.length
    ? sectionsHtml(filtered)
    : `<li class="empty-state">${icon('search')}<h3>Nenhum grupo encontrado</h3>
        <p>Nenhum grupo corresponde a "${escapeHtml(searchInput.value.trim())}".</p></li>`;
}

searchInput.addEventListener('input', render);
render();

// Grupos que a pessoa vê (em que está, que coordena e, para Gestor e Administrativo, todos
// os de equipe), atualizados em tempo real. Grupo ainda sendo criado só aparece para quem
// pode terminar a criação.
const queries = groupQueries(user.uid, platformRole);
const snapshots = queries.map(() => null);
queries.forEach((q, i) =>
  onSnapshot(
    q,
    (snapshot) => {
      snapshots[i] = snapshot;
      if (!snapshots.every(Boolean)) return; // espera todas as consultas responderem
      groups = mergeGroups(snapshots, user.uid, platformRole)
        .filter((g) => g.setupStep === 'done' || canEditSettings(g, g.role))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
      loaded = true;
      render();
      refreshCalendar();
    },
    (error) => {
      if (isLeaving()) return; // trocando de página: não é erro de verdade
      console.error(error);
      listEl.setAttribute('aria-busy', 'false');
      listEl.innerHTML = `<li class="empty-state">${icon('x')}<h3>Não foi possível carregar seus grupos</h3>
      <p>Verifique sua conexão e tente novamente.</p>
      <div class="empty-actions"><button type="button" class="btn btn-secondary" onclick="location.reload()">Tentar de novo</button></div></li>`;
    },
  ),
);

// ---------- Convites pendentes (por pessoa ou pelo e-mail de quem está logado) ----------
// Em tempo real: a mesma lista do sininho (notifications.js)
const invitesEl = document.getElementById('my-invites');
let pendingInvites = [];

function renderInvites() {
  invitesEl.hidden = !pendingInvites.length;
  invitesEl.innerHTML = pendingInvites
    .map(
      (invite, i) => `<div class="invite-card">
        <span class="group-avatar" style="background:var(--cor-primaria)" aria-hidden="true">${icon('mail')}</span>
        <div class="group-info" style="flex:1;min-width:200px">
          <strong>Convite para ${escapeHtml(invite.groupName)}</strong>
          <span>${inviteText(invite)}</span>
        </div>
        <div class="empty-actions" style="margin:0">
          <button type="button" class="btn btn-secondary" data-decline="${i}">Recusar</button>
          <button type="button" class="btn btn-primary" data-accept="${i}">Aceitar</button>
        </div>
      </div>`,
    )
    .join('');
}

invitesEl.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-accept], [data-decline]');
  if (!button) return;
  const invite = pendingInvites[Number(button.dataset.accept ?? button.dataset.decline)];
  if (!invite) return;
  setLoading(button, true);
  const ok = await respondInvite(invite, button.hasAttribute('data-accept'));
  if (!ok && button.isConnected) setLoading(button, false);
});

onInvitesChange((list) => {
  pendingInvites = list;
  renderInvites();
});
