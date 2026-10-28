// Editor da escala mensal (/schedule-edit.html?group=<id>&month=YYYY-MM).
// Grade: colunas = dias; linhas = "Plantão vago" + cada membro, com uma sub-linha por turno.
// Clicar numa célula aloca ou tira a pessoa; a linha de vagas guarda quantas vagas estão abertas.
// Rodapé: filtrar membros, situação, Imprimir, Revisar (um dia por coluna), Replicar e Publicar.
import { doc, collection, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db, navigate, isLeaving } from '../firebase.js';
import { initLayout } from '../layout.js';
import { renderIcons } from '../icons.js';
import { can, roleOf } from '../permissions.js';
import { formatClock, toTime } from '../shifts.js';
import {
  MONTH_PATTERN,
  MAX_VACANCIES,
  daysInMonth,
  weekdayOf,
  addMonths,
  monthParts,
  cellKey,
  sortShifts,
  memberMinutes,
  formatHours,
  findConflict,
  replicate,
  dayShifts,
} from '../schedule-math.js';
import {
  loadShifts,
  loadSchedule,
  watchSchedule,
  setAssignment,
  setVacancies,
  publishSchedule,
  writeReplica,
} from '../schedule-data.js';
import { normalize } from '../validators.js';
import { escapeHtml, initials, toast, setLoading, confirmDialog, firebaseErrorMessage } from '../ui.js';

renderIcons();
const { user, profile } = await initLayout({ active: 'schedules' });

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const groupId = params.get('group');
const month = params.get('month');
if (!groupId || !MONTH_PATTERN.test(month ?? '')) {
  navigate('/schedules.html', { replace: true });
  await new Promise(() => {});
}

const groupUrl = `/group.html?id=${encodeURIComponent(groupId)}`;
const monthUrl = (m) => `/schedule-edit.html?group=${encodeURIComponent(groupId)}&month=${m}`;
const WEEK_LETTERS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const WEEKDAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const monthName = (m) => {
  const { year, monthIndex } = monthParts(m);
  const name = new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(new Date(year, monthIndex, 1));
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year}`;
};
const isWeekend = (day) => [0, 6].includes(weekdayOf(month, day));
const dayLabel = (day) => `${WEEKDAY_NAMES[weekdayOf(month, day)]}, ${String(day).padStart(2, '0')}`;

let group = null;
let members = [];
let shifts = {}; // turnos atuais do grupo
let schedule = null; // documento do mês (null = sem escala)
let creating = null; // criação do documento em andamento (evita duas criações)

$('back-link').href = groupUrl;
$('prev-month').href = monthUrl(addMonths(month, -1));
$('next-month').href = monthUrl(addMonths(month, 1));
$('schedule-month').textContent = monthName(month);
$('schedule-editor').textContent = `Editando: ${profile.name}`;
document.title = `Escala ${monthName(month)} | EscalaMed`;

// ---------- Grade ----------
// Quem aparece na grade: gestor, auxiliar e plantonistas (analista e observador não fazem plantão)
const gridMembers = () =>
  members
    .filter((m) => ['manager', 'assistant', 'staff'].includes(roleOf(group, m.id)))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

const shiftList = () => sortShifts(Object.entries(shifts).map(([id, s]) => ({ id, ...s })));

// Busca do rodapé: cada palavra precisa aparecer no nome
const shownMembers = () => {
  const words = normalize($('find-member').value).split(' ').filter(Boolean);
  return gridMembers().filter((m) => words.every((w) => normalize(m.name).includes(w)));
};

// Coluna Turno: sigla e horário ("M" / "07:00 até 13:00")
const shiftCell = (shift) =>
  `<td class="col-shift"><strong>${escapeHtml(shift.title)}</strong><small>${toTime(shift.startMinute)} até ${toTime(shift.endMinute)}</small></td>`;

function headHtml(days) {
  const cols = Array.from({ length: days }, (_, i) => {
    const day = i + 1;
    return `<th scope="col" class="day-head${isWeekend(day) ? ' is-weekend' : ''}" title="${dayLabel(day)}">
      <span>${WEEK_LETTERS[weekdayOf(month, day)]}</span><strong>${day}</strong></th>`;
  }).join('');
  return `<thead><tr><th scope="col" class="col-name">Nome</th><th scope="col" class="col-shift">Turno</th>${cols}</tr></thead>`;
}

function vacancyRows(list, days) {
  return list
    .map((shift, i) => {
      const cells = Array.from({ length: days }, (_, d) => {
        const key = cellKey(d + 1, shift.id);
        const count = schedule?.vacancies?.[key] ?? 0;
        return `<td class="${isWeekend(d + 1) ? 'is-weekend' : ''}"><button type="button" class="cell cell-vacancy${count ? ' has-vacancy' : ''}"
          data-vacancy="${key}" aria-label="Vagas em ${dayLabel(d + 1)}, turno ${escapeHtml(shift.title)}: ${count}">${count || ''}</button></td>`;
      }).join('');
      const name = i === 0 ? `<th scope="rowgroup" class="col-name block-label" rowspan="${list.length}">Plantão vago</th>` : '';
      return `<tr class="row-vacancy${i === 0 ? ' block-start' : ''}">${name}${shiftCell(shift)}${cells}</tr>`;
    })
    .join('');
}

// ---------- Fotos nas bolinhas ----------
// A foto do perfil pode ser um texto grande (data:...). Para não repeti-la em cada célula,
// cada foto vira uma vez um endereço curto (blob:) e todas as células usam esse endereço.
const photos = new Map(); // uid → { from: photoURL original, src: endereço curto }

async function preparePhotos() {
  let changed = false;
  for (const member of members) {
    const url = member.photoURL;
    const known = photos.get(member.id);
    if (known?.from === url) continue;
    if (known?.src.startsWith('blob:')) URL.revokeObjectURL(known.src);
    if (!url) {
      photos.delete(member.id);
    } else {
      const src = url.startsWith('data:') ? URL.createObjectURL(await (await fetch(url)).blob()) : url;
      photos.set(member.id, { from: url, src });
    }
    changed = true;
  }
  return changed;
}

// Bolinha da pessoa: foto (ou iniciais, sem foto)
function dotHtml(member, className = 'cell-dot') {
  const src = photos.get(member.id)?.src;
  return src
    ? `<span class="${className}"><img src="${escapeHtml(src)}" alt="" referrerpolicy="no-referrer" /></span>`
    : `<span class="${className}">${escapeHtml(initials(member.name))}</span>`;
}

function memberRows(member, list, days) {
  const minutes = memberMinutes(schedule?.assignments, shifts, member.id);
  const dot = dotHtml(member);
  const safeName = escapeHtml(member.name);
  return list
    .map((shift, i) => {
      const cells = Array.from({ length: days }, (_, d) => {
        const key = cellKey(d + 1, shift.id);
        const on = schedule?.assignments?.[key]?.includes(member.id) ?? false;
        return `<td class="${isWeekend(d + 1) ? 'is-weekend' : ''}"><button type="button" class="cell${on ? ' is-on' : ''}"
          data-key="${key}" data-uid="${member.id}" aria-pressed="${on}"${on ? ` title="${safeName}"` : ''}
          aria-label="${safeName}, ${dayLabel(d + 1)}, turno ${escapeHtml(shift.title)}">${on ? dot : ''}</button></td>`;
      }).join('');
      const nameCell =
        i === 0
          ? `<th scope="rowgroup" class="col-name" rowspan="${list.length}">
              <div class="member-cell">${dotHtml(member, 'avatar member-cell-avatar')}
                <span><strong>${escapeHtml(member.name)}</strong><small>${formatHours(minutes)}</small></span></div></th>`
          : '';
      return `<tr class="${i === 0 ? 'block-start' : ''}" data-member="${member.id}">${nameCell}${shiftCell(shift)}${cells}</tr>`;
    })
    .join('');
}

function render() {
  if (!group) return;
  const list = shiftList();
  const people = shownMembers();
  const empty = $('schedule-empty');
  if (!list.length) {
    empty.hidden = false;
    empty.innerHTML = `<p>O grupo ainda não tem turnos. Cadastre os turnos (ex.: M 07h00 às 13h00) para montar a escala.</p>
      <a class="btn btn-primary" href="/group-new.html?id=${encodeURIComponent(groupId)}&step=shifts">Cadastrar turnos</a>`;
    $('schedule-scroll').hidden = true;
    renderStatus();
    return;
  }
  empty.hidden = true;
  $('schedule-scroll').hidden = false;
  const days = daysInMonth(month);
  const scroll = $('schedule-scroll');
  const position = [scroll.scrollLeft, scroll.scrollTop];
  const nobody = $('find-member').value.trim() && !people.length
    ? `<tr><td class="grid-note" colspan="${days + 2}">Ninguém encontrado com esse nome.</td></tr>`
    : '';
  $('schedule-grid').innerHTML = `${headHtml(days)}<tbody>${vacancyRows(list, days)}${people
    .map((m) => memberRows(m, list, days))
    .join('')}${nobody}</tbody>`;
  [scroll.scrollLeft, scroll.scrollTop] = position;
  renderStatus();
}

function renderStatus() {
  const published = schedule?.status === 'published';
  const status = $('schedule-status');
  status.textContent = !schedule ? 'Sem escala' : published ? 'Escala publicada' : 'Escala em rascunho';
  status.className = `status-dot ${!schedule ? 'is-none' : published ? 'is-published' : 'is-draft'}`;
  $('publish-button').lastChild.textContent = published ? 'Publicar alterações' : 'Publicar';
}

// ---------- Alocar e desalocar ----------
// Antes de existir o documento, a primeira gravação cria o mês; as seguintes esperam por ela.
async function write(action) {
  if (creating) await creating.catch(() => {});
  const exists = Boolean(schedule);
  const promise = action(exists);
  if (!exists) creating = promise.finally(() => (creating = null));
  return promise;
}

$('schedule-grid').addEventListener('click', async (event) => {
  const vacancy = event.target.closest('[data-vacancy]');
  if (vacancy) {
    openVacancy(vacancy.dataset.vacancy);
    return;
  }
  const cell = event.target.closest('[data-key]');
  if (!cell) return;
  const { key, uid } = cell.dataset;
  const on = cell.getAttribute('aria-pressed') === 'true';
  const [dayText, shiftId] = [key.slice(0, 2), key.slice(3)];
  const day = Number(dayText);

  if (!on) {
    const conflict = findConflict(schedule?.assignments, shifts, uid, day, shiftId);
    if (conflict) {
      const member = members.find((m) => m.id === uid);
      const other = shifts[conflict.shiftId];
      toast(
        `${member?.name ?? 'Esta pessoa'} já está no turno ${other.title} (${formatClock(other.startMinute)} às ${formatClock(other.endMinute)}) do dia ${conflict.day}, que tem horário sobreposto.`,
        'error',
        6000,
      );
      return;
    }
  }
  try {
    await write((exists) => setAssignment(groupId, month, key, uid, !on, exists));
  } catch (error) {
    toast(firebaseErrorMessage(error), 'error');
  }
});

// ---------- Vagas ----------
let vacancyKey = null;
$('vacancy-count').innerHTML = Array.from({ length: MAX_VACANCIES + 1 }, (_, n) => `<option value="${n}">${n}</option>`).join('');

function openVacancy(key) {
  vacancyKey = key;
  const day = Number(key.slice(0, 2));
  const shift = shifts[key.slice(3)];
  $('vacancy-text').textContent = `${dayLabel(day)} · ${shift.title} (${formatClock(shift.startMinute)} às ${formatClock(shift.endMinute)})`;
  $('vacancy-count').value = String(schedule?.vacancies?.[key] ?? 0);
  $('modal-vacancy').showModal();
  $('vacancy-count').focus();
}

$('vacancy-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const count = Number($('vacancy-count').value);
  const button = event.target.querySelector('[type=submit]');
  setLoading(button, true);
  try {
    await write((exists) => setVacancies(groupId, month, vacancyKey, count, exists));
    $('modal-vacancy').close();
  } catch (error) {
    toast(firebaseErrorMessage(error), 'error');
  } finally {
    setLoading(button, false);
  }
});

// ---------- Filtrar membros ----------
$('find-member').addEventListener('input', render);

// ---------- Revisar: uma coluna por dia, com os turnos e quem está em cada um ----------
const WEEKDAY_LONG = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
let reviewMode = 'dynamic';

function renderReview() {
  $('review-mode')
    .querySelectorAll('[data-mode]')
    .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === reviewMode)));
  const fixed = reviewMode === 'fixed';
  if (fixed && !(schedule?.status === 'published' && schedule.fixed)) {
    $('review-columns').innerHTML = '<p class="muted review-note">A escala fixa aparece depois que a escala é publicada.</p>';
    return;
  }
  const byId = new Map(members.map((m) => [m.id, m]));
  const reviewShifts = fixed ? { ...shifts, ...(schedule.shifts ?? {}) } : shifts;
  $('review-columns').innerHTML = Array.from({ length: daysInMonth(month) }, (_, i) => {
    const day = i + 1;
    const cards = dayShifts(schedule, reviewShifts, day, { fixed })
      .map(({ shift, uids, vacancies }) => {
        const people = uids
          .map((uid) => byId.get(uid) ?? { id: uid, name: 'Ex-membro' })
          .map((m) => `<li title="${escapeHtml(m.name)}">${dotHtml(m, 'cell-dot review-avatar')}<span>${escapeHtml(m.name.split(' ')[0])}</span></li>`)
          .join('');
        const open = vacancies ? `<span class="badge badge-warning">${vacancies} ${vacancies === 1 ? 'vaga' : 'vagas'}</span>` : '';
        return `<article class="review-shift">
          <header><strong>${escapeHtml(shift.title)}</strong><small>${formatClock(shift.startMinute)} às ${formatClock(shift.endMinute)}</small>${open}</header>
          ${people ? `<ul>${people}</ul>` : '<p class="muted">Ninguém</p>'}
        </article>`;
      })
      .join('');
    return `<section class="review-day${isWeekend(day) ? ' is-weekend' : ''}">
      <h3><strong>${String(day).padStart(2, '0')}</strong><span>${WEEKDAY_LONG[weekdayOf(month, day)]}</span></h3>
      ${cards}
    </section>`;
  }).join('');
}

$('review-button').addEventListener('click', () => {
  reviewMode = 'dynamic';
  renderReview();
  $('modal-review').showModal();
});
$('review-mode').addEventListener('click', (event) => {
  const button = event.target.closest('[data-mode]');
  if (!button) return;
  reviewMode = button.dataset.mode;
  renderReview();
});

// ---------- Imprimir ----------
$('print-button').addEventListener('click', () => window.print());

// ---------- Publicar ----------
$('publish-button').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const published = schedule?.status === 'published';
  const ok = await confirmDialog({
    title: published ? 'Publicar alterações?' : `Publicar a escala de ${monthName(month)}?`,
    message: published
      ? 'A escala fixa passa a ser a situação atual da grade.'
      : 'Todos os membros do grupo passam a ver a escala. Ela continua editável depois de publicada.',
    confirmText: 'Publicar',
  });
  if (!ok) return;
  setLoading(button, true);
  try {
    await write(() => publishSchedule(groupId, month, schedule, shifts));
    toast(`Escala de ${monthName(month)} publicada.`, 'success');
  } catch (error) {
    toast(firebaseErrorMessage(error), 'error');
  } finally {
    setLoading(button, false);
  }
});

// ---------- Replicar para o mês seguinte ----------
const nextMonth = addMonths(month, 1);

$('replicate-button').addEventListener('click', () => {
  if (!schedule) {
    toast('Monte a escala deste mês antes de replicar.');
    return;
  }
  $('replicate-from').value = monthName(month);
  $('replicate-to').value = monthName(nextMonth);
  $('modal-replicate').showModal();
});

$('replicate-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.target.querySelector('[type=submit]');
  const mode = event.target.mode.value;
  setLoading(button, true);
  try {
    const target = await loadSchedule(groupId, nextMonth);
    const hasContent = target && Object.values(target.assignments ?? {}).some((uids) => uids.length);
    if (target?.status === 'published' || hasContent) {
      $('modal-replicate').close();
      const ok = await confirmDialog({
        title: `Substituir a escala de ${monthName(nextMonth)}?`,
        message:
          target.status === 'published'
            ? 'Essa escala já está publicada. Ela volta para rascunho e as alocações atuais são substituídas.'
            : 'As alocações que já estão lá são substituídas.',
        confirmText: 'Substituir',
        danger: true,
      });
      if (!ok) return;
    }
    const replica = replicate(schedule, month, nextMonth, mode, Object.keys(shifts));
    await writeReplica(groupId, nextMonth, replica, Boolean(target));
    $('modal-replicate').close();
    toast(`Escala replicada para ${monthName(nextMonth)}.`, 'success');
    navigate(monthUrl(nextMonth));
  } catch (error) {
    toast(firebaseErrorMessage(error), 'error');
  } finally {
    setLoading(button, false);
  }
});

// ---------- Dados em tempo real ----------
shifts = await loadShifts(groupId).catch(() => ({}));

onSnapshot(
  doc(db, 'groups', groupId),
  (snapshot) => {
    if (!snapshot.exists()) return navigate('/schedules.html', { replace: true });
    group = { id: snapshot.id, ...snapshot.data() };
    if (!can(roleOf(group, user.uid), 'editSchedule')) {
      toast('Só o gestor e os auxiliares editam a escala.', 'error');
      navigate(groupUrl, { replace: true });
      return;
    }
    $('schedule-group').textContent = group.name;
    $('schedule-unit').textContent = group.unit ? `${group.unit.name} · ${group.unit.city}/${group.unit.state}` : 'Escala individual';
    render();
  },
  (error) => {
    if (isLeaving()) return; // trocando de página: o Firestore desta página foi encerrado
    toast(firebaseErrorMessage(error), 'error');
    navigate('/schedules.html', { replace: true });
  },
);

onSnapshot(
  collection(db, 'groups', groupId, 'members'),
  (snapshot) => {
    members = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    render(); // já mostra a grade (com iniciais) e troca pelas fotos quando ficarem prontas
    preparePhotos()
      .then((changed) => changed && render())
      .catch(() => {}); // foto que não carrega: ficam as iniciais
  },
  () => {},
);

watchSchedule(
  groupId,
  month,
  (data) => {
    schedule = data;
    render();
    if ($('modal-review').open) renderReview();
  },
  (error) => !isLeaving() && toast(firebaseErrorMessage(error), 'error'),
);
