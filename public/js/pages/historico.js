// Histórico: movimentações de um mês (trocas, cessões, vagas e alterações na escala),
// num grupo ou em todos os grupos da pessoa, agrupadas por dia.
// "Todos os meus grupos" faz uma consulta por grupo e junta aqui: assim cada consulta
// respeita o cargo da pessoa naquele grupo (quem não vê rascunho só lê as públicas).
import { initLayout } from '../layout.js';
import { isLeaving } from '../firebase.js';
import { icon, renderIcons } from '../icons.js';
import { escapeHtml } from '../ui.js';
import { loadMyGroups, loadMembers, groupLabel, seesDrafts, rememberGroup, lastGroup } from '../my-groups.js';
import { loadMovements, MOVEMENT_TYPES, monthOfDate } from '../movements.js';
import { addMonths, monthParts } from '../schedule-math.js';
import { MONTHS, brDate, isoDate, parseIsoDate } from '../dates.js';

renderIcons();
const { user, access } = await initLayout({ active: 'history' });
const $ = (id) => document.getElementById(id);
const list = $('history-list');
const ALL = 'all';

const state = { group: ALL, month: monthOfDate(), member: '', type: 'all' };
let groups = [];
const membersOf = new Map(); // groupId → Map(uid → cartão)

// ---------- Estados da lista ----------
const skeleton = () =>
  `<div class="history-skeleton" aria-hidden="true">${'<div><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div>'.repeat(4)}</div>`;

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
const filterOf = (m) => MOVEMENT_TYPES[m.type]?.filter;

// Abas por tipo, com a contagem do mês (também filtram a lista)
const STATS = [
  ['all', 'Todas'],
  ['swap', 'Trocas'],
  ['cession', 'Cessões'],
  ['vacant', 'Plantões vagos'],
  ['editor', 'Alterações na escala'],
];

function summary(items) {
  const count = (type) => (type === 'all' ? items.length : items.filter((m) => filterOf(m) === type).length);
  return `<div class="history-filter" role="group" aria-label="Filtrar por tipo">${STATS.map(
    ([type, label]) => `<button type="button" class="history-filter-btn" data-stat="${type}" aria-pressed="${state.type === type}">
      ${label}<span class="history-filter-count">${count(type)}</span></button>`,
  ).join('')}</div>`;
}

// "Terça-feira, 10 de novembro" + "Hoje"/"Ontem"
const longDay = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
function dayTitle(day) {
  const text = longDay.format(parseIsoDate(day));
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const tag = day === isoDate(today) ? 'Hoje' : day === isoDate(yesterday) ? 'Ontem' : '';
  return `${text.charAt(0).toUpperCase() + text.slice(1)}${tag ? ` <span class="history-day-tag">${tag}</span>` : ''}`;
}

// Ações repetidas no mesmo dia (mesma pessoa, mesmo tipo, mesmo grupo) viram uma linha só,
// que abre a lista: "Ana escalou Bruno em 5 plantões" ou "Ana fez 12 escalações" → ver as 12.
// Quem se escala fica separado de quem escala outras pessoas (a frase é outra).
const GROUPABLE = new Set(['assigned', 'unassigned', 'vacant_open', 'vacant_closed', 'vacant_taken', 'cession']);

function rowsOf(items) {
  const rows = [];
  const byKey = new Map();
  for (const m of items) {
    const day = isoDate(whenOf(m));
    const key = GROUPABLE.has(m.type) ? [day, m.groupId, m.actorUid, m.type, m.targetUid === m.actorUid].join('|') : m.id;
    const row = byKey.get(key);
    if (row) row.items.push(m);
    else {
      const created = { key, day, items: [m] };
      byKey.set(key, created);
      rows.push(created);
    }
  }
  return rows;
}

// Todas as ações da linha são com a mesma pessoa?
const sameTarget = (items) => items.every((i) => i.targetUid === items[0].targetUid);

// Frase da linha agrupada
function groupSentence(items, members) {
  const [m] = items;
  const count = items.length;
  const actor = nameOf(members, m.actorUid);
  const target = m.targetUid ? nameOf(members, m.targetUid) : '';
  const self = m.targetUid === m.actorUid;
  const n = `${count} plantões`;
  if (m.targetUid && !self && !sameTarget(items)) {
    // Várias pessoas: a lista aberta mostra quem
    if (m.type === 'assigned') return `${actor} fez ${count} escalações`;
    if (m.type === 'unassigned') return `${actor} tirou ${count} pessoas de plantões`;
    if (m.type === 'cession') return `${actor} cedeu ${n}`;
  }
  switch (m.type) {
    case 'assigned':
      return self ? `${actor} se escalou em ${n}` : `${actor} escalou ${target} em ${n}`;
    case 'unassigned':
      return self ? `${actor} saiu de ${n}` : `${actor} tirou ${target} de ${n}`;
    case 'vacant_open':
      return `${actor} abriu vagas em ${n}`;
    case 'vacant_closed':
      return `${actor} fechou as vagas de ${n}`;
    case 'vacant_taken':
      return `${actor} assumiu ${count} plantões vagos`;
    case 'cession':
      return `${actor} cedeu ${n} para ${target}`;
    default:
      return `${actor} fez ${count} alterações`;
  }
}

const timeOf = (m) => whenOf(m).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

// Linhas por vez na tela ("Mostrar mais" acrescenta outras tantas)
const PAGE = 20;
let limit = PAGE;
const expanded = new Set(); // linhas agrupadas abertas

function renderRow(row, groupById) {
  const [m] = row.items; // a mais recente
  const type = MOVEMENT_TYPES[m.type] ?? { icon: 'clock', label: 'Alteração' };
  const group = groupById.get(m.groupId);
  const members = membersOf.get(m.groupId) ?? new Map();
  const groupName = state.group === ALL && group ? ` · ${escapeHtml(group.name)}` : '';
  const many = row.items.length > 1;
  const withNames = many && m.targetUid && m.targetUid !== m.actorUid && !sameTarget(row.items);
  const open = many && expanded.has(row.key);
  const detailsId = `det-${escapeHtml(m.id)}`;
  const oldest = row.items[row.items.length - 1];
  const span = many && timeOf(oldest) !== timeOf(m) ? ` · ${timeOf(oldest)}–${timeOf(m)}` : '';
  return `<li class="history-item">
    <time class="history-time" datetime="${whenOf(m).toISOString()}">${timeOf(m)}</time>
    <span class="history-marker" aria-hidden="true">${icon(type.icon)}</span>
    <div class="history-content">
      <p class="history-text">${many ? groupSentence(row.items, members) : sentence(m, members)}</p>
      <p class="history-meta">${type.label}${groupName}${span}${
        many
          ? ` · <button type="button" class="history-expand" data-expand="${escapeHtml(row.key)}" aria-expanded="${open}" aria-controls="${detailsId}">${open ? 'Ocultar' : `Ver os ${row.items.length}`}${icon('chevronDown')}</button>`
          : ''
      }</p>
      ${
        many
          ? `<ul class="history-details" id="${detailsId}"${open ? '' : ' hidden'}>${row.items
              .map(
                (i) => `<li><span>${withNames ? `${nameOf(members, i.targetUid)} · ` : ''}${shiftText(i)}${i.type === 'vacant_open' && i.count > 1 ? ` · ${i.count} vagas` : ''}</span><time datetime="${whenOf(i).toISOString()}">${timeOf(i)}</time></li>`,
              )
              .join('')}</ul>`
          : ''
      }
    </div>
  </li>`;
}

function render(movements) {
  const byMember = movements.filter((m) => !state.member || m.memberUids?.includes(state.member));
  const shown = byMember.filter((m) => state.type === 'all' || filterOf(m) === state.type);
  if (!byMember.length) {
    list.innerHTML = emptyState('Nenhuma movimentação encontrada', 'Não encontramos nenhum histórico para os filtros informados.');
    return;
  }
  if (!shown.length) {
    list.innerHTML =
      summary(byMember) + emptyState('Nenhuma movimentação deste tipo', 'Escolha outro tipo acima para ver o restante do mês.');
    return;
  }
  // Total de cada dia (conta tudo, mesmo o que ainda não apareceu na tela)
  const perDay = new Map();
  for (const m of shown) {
    const day = isoDate(whenOf(m));
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  const rows = rowsOf(shown);
  const byDay = new Map();
  for (const row of rows.slice(0, limit)) {
    if (!byDay.has(row.day)) byDay.set(row.day, []);
    byDay.get(row.day).push(row);
  }
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const left = rows.length - limit;
  list.innerHTML =
    summary(byMember) +
    [...byDay]
      .map(([day, dayRows]) => {
        const total = perDay.get(day);
        return `<section class="history-day" aria-label="${brDate(day)}">
      <header class="history-day-head">
        <h2 class="history-day-title">${dayTitle(day)}</h2>
        <span class="history-day-count">${total === 1 ? '1 movimentação' : `${total} movimentações`}</span>
      </header>
      <ol class="history-items">${dayRows.map((row) => renderRow(row, groupById)).join('')}</ol>
    </section>`;
      })
      .join('') +
    (left > 0
      ? `<div class="history-more">
      <button type="button" class="btn btn-secondary" data-more>Mostrar mais</button>
      <span>${Math.min(limit, rows.length)} de ${rows.length} registros</span>
    </div>`
      : '');
}

let movements = [];
let loadId = 0;

async function load() {
  const id = ++loadId;
  if (!groups.length) {
    list.setAttribute('aria-busy', 'false');
    list.innerHTML = emptyState('Você ainda não participa de grupos', 'O histórico mostra as movimentações das escalas dos seus grupos.');
    return;
  }
  list.setAttribute('aria-busy', 'true');
  list.innerHTML = skeleton();
  limit = PAGE;
  expanded.clear();
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
  groups = await loadMyGroups(user.uid, access.role);
} catch (error) {
  if (isLeaving()) await new Promise(() => {}); // a página está saindo: para aqui
  console.error(error);
  showError();
  throw error;
}

// Sem grupos, os filtros continuam na tela: o de grupo fica desativado e a lista mostra o aviso
{
  const select = $('history-group');
  select.innerHTML =
    `<option value="${ALL}">Todos os meus grupos</option>` +
    groups.map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(groupLabel(g))}</option>`).join('');
  select.disabled = !groups.length;
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
    limit = PAGE;
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

  // Cartões do resumo: filtram pelo tipo (clicar no que já está marcado volta para "todas")
  list.addEventListener('click', (event) => {
    const stat = event.target.closest('[data-stat]');
    if (stat) {
      state.type = stat.dataset.stat === state.type ? 'all' : stat.dataset.stat;
      limit = PAGE;
      render(movements);
      list.querySelector(`[data-stat="${state.type}"]`)?.focus();
      return;
    }
    // Abre/fecha a lista de uma linha agrupada (sem redesenhar a página)
    const toggle = event.target.closest('[data-expand]');
    if (toggle) {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      if (open) expanded.add(toggle.dataset.expand);
      else expanded.delete(toggle.dataset.expand);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.firstChild.textContent = open ? 'Ocultar' : `Ver os ${toggle.closest('.history-content').querySelectorAll('.history-details li').length}`;
      $(toggle.getAttribute('aria-controls')).hidden = !open;
      return;
    }
    // "Mostrar mais": acrescenta linhas e leva o foco para a primeira nova
    if (event.target.closest('[data-more]')) {
      const before = list.querySelectorAll('.history-item').length;
      limit += PAGE;
      render(movements);
      const first = list.querySelectorAll('.history-item')[before];
      first?.setAttribute('tabindex', '-1');
      first?.focus();
    }
  });
  renderMonth();
  await renderMemberOptions();
  load();
}
