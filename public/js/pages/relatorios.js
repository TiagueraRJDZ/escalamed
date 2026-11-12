// Relatório de Plantões (Gestor, Coordenador de escala e Administrativo): plantões das escalas publicadas num período, por
// membro, com horas. Os cálculos ficam em shift-report.js; a exportação em report-export.js.
// A escala de cada mês vem de groups/{g}/schedules/{AAAA-MM} (mapa "dia_turno" → pessoas);
// meses em rascunho não entram (aparece um aviso).
import { initLayout, avatarHtml } from '../layout.js';
import { isLeaving } from '../firebase.js';
import { icon, renderIcons } from '../icons.js';
import { escapeHtml, setupMenu, toast, firebaseErrorMessage } from '../ui.js';
import { professionLabel, councilLabel } from '/data/categories.js';
import { loadMyGroups, loadMembers, groupLabel, rememberGroup, lastGroup } from '../my-groups.js';
import { can, seesReports } from '../permissions.js';
import { loadShifts, loadSchedule, scheduleShifts } from '../schedule-data.js';
import { collectShifts, buildShiftReport, MAX_RANGE_DAYS } from '../shift-report.js';
import { formatDuration, toTime } from '../shifts.js';
import { MONTHS, MONTHS_SHORT, WEEKDAYS_SHORT, brDate, daysBetween, monthRange, monthsInRange, parseIsoDate } from '../dates.js';
import { exportXlsx, exportPdf } from '../report-export.js';

renderIcons();
const { user, access } = await initLayout({ active: 'reports' });
const $ = (id) => document.getElementById(id);
const form = $('report-form');
const body = $('report-body');

// Grupos de equipe em que a pessoa vê relatórios (Gestor e Administrativo: todos; Coordenador:
// os que coordena). Quem chega pelo endereço sem nenhum e sem cargo volta para Escalas com aviso.
let groups = [];
try {
  const mine = await loadMyGroups(user.uid, access.role);
  groups = mine.filter((g) => g.type === 'team' && can(g.role, 'viewReports'));
} catch (error) {
  if (isLeaving()) await new Promise(() => {}); // a página está saindo: para aqui
  body.innerHTML = errorState(firebaseErrorMessage(error));
  throw error;
}
if (!groups.length && !seesReports(access.role)) {
  location.replace('/schedules.html?aviso=relatorios');
  await new Promise(() => {}); // a página está saindo: não monta o resto
}
// Tem cargo com Relatórios, mas ainda não há grupo de equipe: filtros na tela, sem gerar
const noGroups = !groups.length;

// ---------- Estados ----------
function infoState(iconName, title, text = '') {
  return `<div class="empty-state report-empty">${icon(iconName)}<h3>${title}</h3>${text ? `<p>${text}</p>` : ''}</div>`;
}
function errorState(message) {
  return infoState('x', 'Não foi possível gerar o relatório', escapeHtml(message || 'Verifique sua conexão e tente de novo.'));
}
const initialState = () =>
  infoState('fileText', 'Selecione um grupo e um período para gerar o relatório', 'O relatório mostra os plantões das escalas publicadas, por membro, com as horas.');

const noGroupsState = () =>
  infoState('fileText', 'Nenhum grupo de equipe ainda', 'Os relatórios aparecem aqui quando houver um grupo de equipe com escala.');

body.innerHTML = noGroups ? noGroupsState() : initialState();

// ---------- Filtros ----------
const groupSelect = $('report-group');
groupSelect.innerHTML = noGroups
  ? '<option value="">Nenhum grupo de equipe</option>'
  : groups.map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(groupLabel(g))}</option>`).join('');
groupSelect.disabled = noGroups;
const remembered = lastGroup('relatorios');
groupSelect.value = groups.some((g) => g.id === remembered) ? remembered : (groups[0]?.id ?? '');

const selectedGroup = () => groups.find((g) => g.id === groupSelect.value);
let members = [];

async function fillMembers() {
  const select = $('report-member');
  select.disabled = true;
  if (noGroups) return; // sem grupo: fica só "Todos os membros", desativado
  members = await loadMembers(groupSelect.value).catch(() => []);
  select.innerHTML =
    '<option value="">Todos os membros</option>' +
    members.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`).join('');
  select.disabled = false;
}

function setRange(offset) {
  const { start, end } = monthRange(new Date(), offset);
  form.start.value = start;
  form.end.value = end;
  validate();
}

// Datas válidas: as duas preenchidas, fim ≥ início e no máximo 92 dias
function validate() {
  const { start, end } = form;
  let message = '';
  if (!start.value || !end.value) message = 'Informe a data inicial e a final.';
  else if (end.value < start.value) message = 'A data final precisa ser igual ou depois da inicial.';
  else if (daysBetween(start.value, end.value) + 1 > MAX_RANGE_DAYS) message = `Escolha um período de até ${MAX_RANGE_DAYS} dias.`;
  $('range-error').textContent = start.value && end.value ? message : '';
  $('report-submit').disabled = Boolean(message) || noGroups;
  markRange();
  return !message;
}

// Atalho aceso quando as datas são exatamente as dele ("Este mês", "Mês passado");
// mudar as datas na mão apaga
function markRange() {
  const today = new Date();
  form.querySelectorAll('[data-range]').forEach((chip) => {
    const { start, end } = monthRange(today, Number(chip.dataset.range));
    chip.setAttribute('aria-pressed', String(form.start.value === start && form.end.value === end));
  });
}

form.addEventListener('input', validate);
form.addEventListener('change', (event) => {
  if (event.target === groupSelect) {
    rememberGroup('relatorios', groupSelect.value);
    fillMembers();
  }
});
form.querySelectorAll('[data-range]').forEach((chip) => chip.addEventListener('click', () => setRange(Number(chip.dataset.range))));
setRange(0);
await fillMembers();

// ---------- Resultado ----------
// "11 OUT DOM"
function dayLabel(iso) {
  const date = parseIsoDate(iso);
  return `${String(date.getDate()).padStart(2, '0')} ${MONTHS_SHORT[date.getMonth()]} ${WEEKDAYS_SHORT[date.getDay()]}`;
}

function personHtml(person, index) {
  const work = [professionLabel(person.member), councilLabel(person.member.council)].filter(Boolean).join(' - ');
  const count = person.shifts.length;
  const panelId = `person-panel-${index}`;
  const rows = person.shifts
    .map(
      (s) => `<tr>
        <td><strong>${dayLabel(s.date)}</strong><small>${toTime(s.startMinute)} às ${toTime(s.endMinute)} · ${escapeHtml(s.title === s.period ? s.title : `${s.title} (${s.period})`)}</small></td>
        <td class="num">${formatDuration(s.minutes)}</td>
      </tr>`,
    )
    .join('');
  return `<li class="person-card">
    <button type="button" class="person-head" aria-expanded="false" aria-controls="${panelId}">
      ${icon('chevronDown', 'person-chevron')}
      ${avatarHtml(person.member, 'avatar person-avatar')}
      <span class="person-name">${escapeHtml(person.name)}</span>
      <span class="person-meta">
        ${work ? `<span>${escapeHtml(work)}</span>` : ''}
        <strong>${count} ${count === 1 ? 'plantão' : 'plantões'} · ${formatDuration(person.minutes)}</strong>
      </span>
    </button>
    <div class="person-panel" id="${panelId}" hidden>
      <table class="report-table">
        <thead><tr><th scope="col">Plantões (${count})</th><th scope="col" class="num">Horas</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><th scope="row">Total</th><td class="num">${formatDuration(person.minutes)}</td></tr></tfoot>
      </table>
    </div>
  </li>`;
}

// Aviso dos meses em rascunho (não entram no relatório)
function draftNotice(drafts) {
  if (!drafts.length) return '';
  const one = drafts.length === 1;
  return `<div class="alert alert-warning report-notice">${one ? 'A escala de' : 'As escalas de'} ${drafts.join(', ')} ${one ? 'está' : 'estão'} em rascunho e não ${one ? 'entra' : 'entram'} no relatório.</div>`;
}

function reportHtml(report, drafts) {
  return `${draftNotice(drafts)}
    <div class="report-summary">
      <div class="summary-card"><span>Total de plantões</span><strong>${report.totals.shifts}</strong></div>
      <div class="summary-card"><span>Total de horas</span><strong>${formatDuration(report.totals.minutes)}</strong></div>
      <div class="summary-card"><span>Profissionais</span><strong>${report.totals.people}</strong></div>
    </div>
    <div class="report-toolbar">
      <h2>Plantões por membro</h2>
      <div>
        <button type="button" class="btn btn-ghost" data-toggle-all="open">Expandir todos</button>
        <button type="button" class="btn btn-ghost" data-toggle-all="close">Recolher todos</button>
      </div>
    </div>
    <ul class="person-list">${report.people.map(personHtml).join('')}</ul>`;
}

const monthLabel = (month) => {
  const [year, number] = month.split('-').map(Number);
  return `${MONTHS[number - 1]} de ${year}`;
};

let current = null; // { report, groupName, start, end } do relatório na tela

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!validate()) return;
  const group = selectedGroup();
  if (!group) return;
  const start = form.start.value;
  const end = form.end.value;
  const uid = form.member.value || null;
  const button = $('report-submit');
  button.disabled = true;
  $('export-bar').hidden = true;
  body.innerHTML = infoState('hourglass', 'Gerando relatório…');
  try {
    const months = monthsInRange(start, end);
    const [liveShifts, schedules] = await Promise.all([
      loadShifts(group.id),
      Promise.all(months.map((m) => loadSchedule(group.id, m))),
    ]);
    const published = [];
    const drafts = [];
    months.forEach((month, i) => {
      const schedule = schedules[i];
      if (schedule?.status === 'published') published.push({ month, schedule, shifts: scheduleShifts(schedule, liveShifts) });
      else if (schedule) drafts.push(monthLabel(month));
    });
    const report = buildShiftReport(collectShifts(published, start, end, uid), members);
    if (!report.people.length) {
      body.innerHTML =
        draftNotice(drafts) +
        infoState('hourglass', 'Nenhum plantão encontrado no período.', `${brDate(start)} a ${brDate(end)} · ${escapeHtml(group.name)}`);
      current = null;
      return;
    }
    current = { report, groupName: group.name, start, end };
    body.innerHTML = reportHtml(report, drafts);
    $('print-info').textContent = `${group.name}${group.unit ? ` · ${group.unit.name} · ${group.unit.city}/${group.unit.state}` : ''} · ${brDate(start)} a ${brDate(end)}`;
    $('export-bar').hidden = false;
  } catch (error) {
    if (isLeaving()) return; // a página está saindo
    console.error(error);
    body.innerHTML = errorState(firebaseErrorMessage(error));
  } finally {
    button.disabled = false;
    validate();
  }
});

// Sanfona: um membro ou todos
function setOpen(head, open) {
  head.setAttribute('aria-expanded', String(open));
  $(head.getAttribute('aria-controls')).hidden = !open;
}
body.addEventListener('click', (event) => {
  const head = event.target.closest('.person-head');
  if (head) setOpen(head, head.getAttribute('aria-expanded') !== 'true');
  const all = event.target.closest('[data-toggle-all]');
  if (all) body.querySelectorAll('.person-head').forEach((h) => setOpen(h, all.dataset.toggleAll === 'open'));
});

// ---------- Exportar ----------
setupMenu($('export-button'), $('export-menu'));
$('export-menu').addEventListener('click', async (event) => {
  const option = event.target.closest('[data-export]');
  if (!option || !current) return;
  try {
    if (option.dataset.export === 'xlsx') await exportXlsx(current.report, current);
    else exportPdf(current);
  } catch (error) {
    toast(error.message || 'Não foi possível exportar.', 'error', 6000);
  }
});
