// Histórico: movimentações de um mês (trocas, cessões, vagas e alterações na escala),
// num grupo ou em todos os grupos da pessoa, agrupadas por dia.
// "Todos os meus grupos" faz uma consulta por grupo e junta aqui: assim cada consulta
// respeita o cargo da pessoa naquele grupo (quem não vê rascunho só lê as públicas).
import { initLayout } from '../layout.js';
import { isLeaving } from '../firebase.js';
import { icon, renderIcons } from '../icons.js';
import { escapeHtml, initials, setupMenu } from '../ui.js';
import { groupColor } from '/data/colors.js';
import { loadMyGroups, loadMembers, groupLabel, seesDrafts, rememberGroup, lastGroup } from '../my-groups.js';
import { loadMovements, MOVEMENT_TYPES, TYPE_FILTERS, monthOfDate } from '../movements.js';
import { addMonths, monthParts } from '../schedule-math.js';
import { MONTHS, brDate, dayHeading, isoDate } from '../dates.js';

renderIcons();
const { user } = await initLayout({ active: 'history' });
const $ = (id) => document.getElementById(id);
const list = $('history-list');
const ALL = 'all';

const state = { group: ALL, month: monthOfDate(), member: '', type: 'all' };
let groups = [];
const membersOf = new Map(); // groupId → Map(uid → cartão)

// ---------- Estados da lista ----------
const skeleton = () =>
  `<div class="history-skeleton" aria-hidden="true">${'<div><span class="skeleton"></span><span class="skeleton"></span></div>'.repeat(4)}</div>`;

const emptyState = (title, text) =>
  `<div class="empty-state report-empty">${icon('hourglass')}<h3>${title}</h3><p>${text}</p></div>`;

function showError() {
  list.innerHTML = `<div class="empty-state report-empty">${icon('x')}<h3>Não foi possível carregar o histórico</h3>
    <p>Verifique sua conexão e tente de novo.</p>
    <button type="button" class="btn btn-secondary" id="retry">Tentar de novo</button></div>`;
  $('retry').addEventListener('click', load);
}

// ---------- Filtros ----------
function renderMonth() {
  const { year, monthIndex } = monthParts(state.month);
  const name = MONTHS[monthIndex];
  $('month-name').innerHTML = `<strong>${name.charAt(0).toUpperCase() + name.slice(1)}</strong> <span>${year}</span>`;
}

async function renderMemberOptions() {
  const select = $('history-member');
  if (state.group === ALL) {
    select.innerHTML = '<option value="">Todos os membros</option>';
    select.disabled = true;
    state.member = '';
    return;
  }
  select.disabled = false;
  const members = [...(await membersFor(state.group)).values()];
  select.innerHTML =
    '<option value="">Todos os membros</option>' +
    members.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`).join('');
  if (!members.some((m) => m.id === state.member)) state.member = '';
  select.value = state.member;
}

async function membersFor(groupId) {
  if (!membersOf.has(groupId)) {
    const members = await loadMembers(groupId).catch(() => []);
    membersOf.set(groupId, new Map(members.map((m) => [m.id, m])));
  }
  return membersOf.get(groupId);
}

function renderTypeMenu() {
  $('type-menu').innerHTML = TYPE_FILTERS.map(
    (f) => `<button type="button" class="menu-item${f.id === state.type ? ' is-active' : ''}" role="menuitem"
      data-type="${f.id}" aria-current="${f.id === state.type}">${icon(f.icon)}<span>${f.label}</span>${f.id === state.type ? icon('check', 'menu-check') : ''}</button>`,
  ).join('');
  $('type-dot').hidden = state.type === 'all';
}

// ---------- Frases ----------
const nameOf = (members, uid) => `<strong>${escapeHtml(members.get(uid)?.name ?? 'Ex-membro')}</strong>`;

// "11/10, turno M (07:00–13:00)"
function shiftText(m, prefix = 'shift') {
  const date = m[`${prefix}Date`];
  if (!date) return 'um plantão';
  const [, mm, dd] = date.split('-');
  const title = prefix === 'shift' && m.shiftTitle ? `, turno ${escapeHtml(m.shiftTitle)}` : '';
  const time = m[`${prefix}Start`] ? ` (${m[`${prefix}Start`]}–${m[`${prefix}End`]})` : '';
  return `${dd}/${mm}${title}${time}`;
}

const monthText = (month) => {
  const { year, monthIndex } = monthParts(month);
  return `${MONTHS[monthIndex]} de ${year}`;
};

function sentence(m, members) {
  const actor = nameOf(members, m.actorUid);
  const target = m.targetUid ? nameOf(members, m.targetUid) : '';
  const self = m.targetUid === m.actorUid;
  switch (m.type) {
    case 'swap':
      return `${actor} trocou o plantão de ${shiftText(m)} com ${target}${m.counterShiftDate ? ` (${shiftText(m, 'counterShift')})` : ''}`;
    case 'cession':
      return `${actor} cedeu o plantão de ${shiftText(m)} para ${target}`;
    case 'vacant_open':
      return `${actor} abriu ${m.count === 1 ? '1 vaga' : `${m.count ?? ''} vagas`} no plantão de ${shiftText(m)}`;
    case 'vacant_closed':
      return `${actor} fechou as vagas do plantão de ${shiftText(m)}`;
    case 'vacant_taken':
      return `${actor} assumiu o plantão vago de ${shiftText(m)}`;
    case 'assigned':
      return self ? `${actor} se escalou no plantão de ${shiftText(m)}` : `${actor} escalou ${target} no plantão de ${shiftText(m)}`;
    case 'unassigned':
      return self ? `${actor} saiu do plantão de ${shiftText(m)}` : `${actor} tirou ${target} do plantão de ${shiftText(m)}`;
    case 'published':
      return `${actor} publicou a escala de ${monthText(m.scheduleMonth ?? state.month)}`;
    case 'unpublished':
      return `${actor} voltou a escala de ${monthText(m.scheduleMonth ?? state.month)} para rascunho`;
    case 'replicated':
      return `${actor} replicou a escala de ${monthText(m.fromMonth)} para ${monthText(m.scheduleMonth)}`;
    default:
      return `${actor} fez uma alteração`;
  }
}

// ---------- Lista ----------
const whenOf = (m) => m.createdAt?.toDate?.() ?? new Date(); // gravação ainda pendente: agora

function render(movements) {
  const shown = movements.filter(
    (m) =>
      (state.type === 'all' || MOVEMENT_TYPES[m.type]?.filter === state.type) &&
      (!state.member || m.memberUids?.includes(state.member)),
  );
  if (!shown.length) {
    list.innerHTML = emptyState('Nenhuma movimentação encontrada', 'Não encontramos nenhum histórico para os filtros informados.');
    return;
  }
  const byDay = new Map();
  for (const m of shown) {
    const day = isoDate(whenOf(m));
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(m);
  }
  const groupById = new Map(groups.map((g) => [g.id, g]));
  list.innerHTML = [...byDay]
    .map(
      ([day, items]) => `<section class="history-day" aria-label="${brDate(day)}">
      <h2 class="history-day-title">${dayHeading(day)}</h2>
      <ul class="history-items">${items
        .map((m) => {
          const group = groupById.get(m.groupId);
          const members = membersOf.get(m.groupId) ?? new Map();
          const actorName = members.get(m.actorUid)?.name ?? 'Ex-membro';
          const time = whenOf(m).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
          return `<li class="history-item">
            <span class="group-avatar history-avatar" style="background:${escapeHtml(groupColor(group?.color))}" aria-hidden="true">${escapeHtml(initials(actorName))}</span>
            <span class="history-type" title="${escapeHtml(TYPE_FILTERS.find((f) => f.id === MOVEMENT_TYPES[m.type]?.filter)?.label ?? '')}">${icon(MOVEMENT_TYPES[m.type]?.icon ?? 'clock')}</span>
            <div class="history-text">
              <p>${sentence(m, members)}</p>
              ${state.group === ALL && group ? `<small>${escapeHtml(group.name)}</small>` : ''}
            </div>
            <time class="history-time" datetime="${whenOf(m).toISOString()}">${time}</time>
          </li>`;
        })
        .join('')}</ul>
    </section>`,
    )
    .join('');
}

let movements = [];
let loadId = 0;

async function load() {
  const id = ++loadId;
  list.setAttribute('aria-busy', 'true');
  list.innerHTML = skeleton();
  const targets = state.group === ALL ? groups : groups.filter((g) => g.id === state.group);
  try {
    const results = await Promise.all(
      targets.map(async (g) => {
        const [items] = await Promise.all([loadMovements(g.id, state.month, { seesDrafts: seesDrafts(g) }), membersFor(g.id)]);
        return items;
      }),
    );
    if (id !== loadId) return; // mudou o filtro enquanto carregava
    movements = results.flat().sort((a, b) => whenOf(b) - whenOf(a));
    render(movements);
  } catch (error) {
    if (id !== loadId || isLeaving()) return; // filtro mudou ou a página está saindo
    console.error(error);
    showError();
  } finally {
    if (id === loadId) list.setAttribute('aria-busy', 'false');
  }
}

// ---------- Início ----------
try {
  groups = await loadMyGroups(user.uid);
} catch (error) {
  if (isLeaving()) await new Promise(() => {}); // a página está saindo: para aqui
  console.error(error);
  showError();
  throw error;
}

if (!groups.length) {
  list.setAttribute('aria-busy', 'false');
  list.innerHTML = emptyState('Você ainda não participa de grupos', 'O histórico mostra as movimentações das escalas dos seus grupos.');
  document.querySelector('.report-filters').hidden = true;
} else {
  const select = $('history-group');
  select.innerHTML =
    `<option value="${ALL}">Todos os meus grupos</option>` +
    groups.map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(groupLabel(g))}</option>`).join('');
  const remembered = lastGroup('historico');
  state.group = remembered && (remembered === ALL || groups.some((g) => g.id === remembered)) ? remembered : ALL;
  select.value = state.group;

  select.addEventListener('change', async () => {
    state.group = select.value;
    rememberGroup('historico', state.group);
    await renderMemberOptions();
    load();
  });
  $('history-member').addEventListener('change', (e) => {
    state.member = e.target.value;
    render(movements); // filtro aplicado aqui, sem nova consulta
  });
  $('month-prev').addEventListener('click', () => {
    state.month = addMonths(state.month, -1);
    renderMonth();
    load();
  });
  $('month-next').addEventListener('click', () => {
    state.month = addMonths(state.month, 1);
    renderMonth();
    load();
  });

  setupMenu($('type-button'), $('type-menu'));
  $('type-menu').addEventListener('click', (event) => {
    const item = event.target.closest('[data-type]');
    if (!item) return;
    state.type = item.dataset.type;
    renderTypeMenu();
    render(movements);
  });

  renderMonth();
  renderTypeMenu();
  await renderMemberOptions();
  load();
}
