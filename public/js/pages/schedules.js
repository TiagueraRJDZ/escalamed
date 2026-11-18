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
import { groupQueries, mergeGroups, seesDrafts, groupSubtitle } from '../my-groups.js';
import { onInvitesChange, respondInvite, inviteText } from '../notifications.js';
import { monthKey, userDays, dayShifts, requestId } from '../schedule-math.js';
import { watchMyRequests } from '../vacancy-requests.js';
import { watchMyCessions } from '../cession-requests.js';
import { scheduleShifts, schedulesQuery, schedulesFrom, shiftsRef, shiftsFrom } from '../schedule-data.js';
import { listenWithRetry, batched } from '../live.js';
import { formatClock } from '../shifts.js';
import { isoDate } from '../dates.js';

renderIcons();
const { user, access } = await initLayout({ active: 'schedules' });
const platformRole = access.role;

// "Criar novo grupo" só para o Gestor (cargo aprovado)
document.getElementById('new-team').hidden = !canCreateTeam(platformRole);

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
let askedVacancies = new Set(); // pedidos de plantão vago pendentes: "<grupo>/<id do pedido>"
let cedingShifts = new Set(); // cessões pedidas, esperando a coordenação: "<grupo>/<id da cessão>"

// Calendário: só os grupos em que a pessoa está na escala (Gestor e Administrativo veem
// todos os grupos na lista, mas os plantões e vagas do calendário são os da pessoa)
const readyGroups = () => groups.filter((g) => g.setupStep === 'done' && isMember(g, user.uid));

// Escalas e turnos de cada grupo em tempo real (uma escuta de escalas e uma de turnos por
// grupo): alocação, vaga e publicação aparecem na hora no calendário e no painel do dia.
const live = new Map(); // groupId → { group, withDrafts, schedules, shifts, stop }
const liveReady = () => [...live.values()].every((entry) => entry.schedules && entry.shifts);
const redraw = batched(() => {
  if (!liveReady()) return;
  markDays();
  renderDay();
});

// Os grupos mudaram (entrou, saiu, terminou a configuração, mudou o papel): ajusta as escutas
function syncLive() {
  const ready = readyGroups();
  const ids = new Set(ready.map((g) => g.id));
  for (const [id, entry] of live) {
    if (ids.has(id)) continue;
    entry.stop();
    live.delete(id);
  }
  for (const group of ready) {
    const withDrafts = seesDrafts(group);
    const current = live.get(group.id);
    if (current && current.withDrafts === withDrafts) {
      current.group = group; // nome ou cor podem ter mudado
      continue;
    }
    current?.stop();
    const entry = { group, withDrafts, schedules: null, shifts: null };
    const stops = [
      listenWithRetry(schedulesQuery(group.id, withDrafts), (snapshot) => ((entry.schedules = schedulesFrom(snapshot)), redraw()), 'Escalas', {
        onError: () => ((entry.schedules ??= new Map()), redraw()),
      }),
      listenWithRetry(shiftsRef(group.id), (snapshot) => ((entry.shifts = shiftsFrom(snapshot)), redraw()), 'Turnos', {
        onError: () => ((entry.shifts ??= {}), redraw()),
      }),
    ];
    entry.stop = () => stops.forEach((stop) => stop());
    live.set(group.id, entry);
  }
  redraw();
}

// Escalas do mês em todos os grupos prontos (só as que existem e a pessoa pode ler)
function monthEntries(month) {
  return [...live.values()]
    .map(({ group, schedules, shifts }) => {
      const schedule = schedules?.get(month);
      return schedule ? { group, schedule, shifts: scheduleShifts(schedule, shifts) } : null;
    })
    .filter(Boolean);
}

// Vagas abertas só contam em escala publicada (rascunho ainda pode mudar)
const isPublished = (schedule) => schedule.status === 'published';

// Vagas abertas do dia em que a pessoa ainda não está
const openSlots = (schedule, key) =>
  isPublished(schedule) && !schedule.assignments?.[key]?.includes(user.uid) ? schedule.vacancies?.[key] ?? 0 : 0;

function markDays() {
  if (!loaded || !calendarMonth || !liveReady()) return;
  const entries = monthEntries(calendarMonth);
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

function renderDay() {
  const date = selectedDate;
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
  if (!liveReady()) {
    dayPanel.setAttribute('aria-busy', 'true');
    dayPanel.innerHTML = panelSkeleton();
    return; // desenha de novo quando as escalas chegarem
  }
  const entries = monthEntries(monthKey(date.getFullYear(), date.getMonth()));

  const day = date.getDate();
  const mine = [];
  const open = [];
  for (const { group, schedule, shifts } of entries) {
    for (const { shiftId, shift, uids } of dayShifts(schedule, shifts, day)) {
      if (uids.includes(user.uid)) {
        const cellId = requestId(monthKey(date.getFullYear(), date.getMonth()), `${String(day).padStart(2, '0')}_${shiftId}`, user.uid);
        const badge = !isPublished(schedule)
          ? '<span class="badge badge-muted">Rascunho</span>'
          : cedingShifts.has(`${group.id}/${cellId}`)
            ? '<span class="badge badge-warning">Cedendo</span>'
            : '';
        mine.push({ start: shift.startMinute, html: shiftItem({ group, shift, date, badge }) });
        continue;
      }
      const key = `${String(day).padStart(2, '0')}_${shiftId}`;
      const slots = openSlots(schedule, key);
      if (slots > 0) {
        const month = monthKey(date.getFullYear(), date.getMonth());
        const badge = askedVacancies.has(`${group.id}/${requestId(month, key, user.uid)}`)
          ? '<span class="badge badge-primary">Pedido enviado</span>'
          : `<span class="badge badge-warning">${slots} ${slots === 1 ? 'vaga' : 'vagas'}</span>`;
        open.push({ start: shift.startMinute, html: shiftItem({ group, shift, date, badge }) });
      }
    }
  }
  const sorted = (list) => list.sort((a, b) => a.start - b.start).map((item) => item.html);
  dayPanel.setAttribute('aria-busy', 'false');
  dayPanel.innerHTML =
    sectionHtml('Seus plantões', sorted(mine), isToday ? 'Você não tem plantão hoje.' : 'Você não tem plantão neste dia.') +
    sectionHtml('Disponíveis', sorted(open), 'Nenhuma vaga aberta neste dia. Plantões vagos nos seus grupos aparecem aqui.') +
    (open.length ? '<p class="muted text-sm day-hint">Toque numa vaga para pedir o plantão. A coordenação da escala aceita ou recusa.</p>' : '');
}

// Plantões que a pessoa pediu para ceder e esperam a coordenação: selo "Cedendo"
watchMyCessions(user.uid, ({ mine }) => {
  cedingShifts = new Set(mine.filter((c) => c.status === 'pending').map((c) => `${c.groupId}/${c.docId}`));
  redraw();
});

// Vagas que a pessoa já pediu e esperam resposta: selo "Pedido enviado"
watchMyRequests(user.uid, (list) => {
  askedVacancies = new Set(list.filter((r) => r.status === 'pending').map((r) => `${r.groupId}/${r.docId}`));
  redraw();
});

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
      syncLive();
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
