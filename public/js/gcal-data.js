// Agenda Google: o que o app manda ao serviço de contas (Worker, worker/src/agenda.js)
// para pôr os plantões publicados na agenda "EscalaMed" de cada pessoa.
// Sem Firebase: testado com `node --test` (tests/gcal-data.test.mjs).
import { addMonths, monthKey, parseCellKey } from './schedule-math.js';

// Permissão pedida ao Google: criar agendas próprias e mexer só nos eventos delas
// (não vê nem altera as outras agendas da pessoa)
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';

// Lembrete antes de cada plantão (minutos). Os mesmos valores de LEMBRETES no Worker.
export const CALENDAR_REMINDERS = [
  { minutes: 0, label: 'Sem lembrete' },
  { minutes: 30, label: '30 minutos antes' },
  { minutes: 60, label: '1 hora antes' },
  { minutes: 120, label: '2 horas antes' },
  { minutes: 360, label: '6 horas antes' },
  { minutes: 720, label: '12 horas antes' },
  { minutes: 1440, label: '1 dia antes' },
];

// Meses que a pessoa sincroniza ao abrir o app: o anterior, o atual e os dois seguintes
export function syncMonths(today = new Date()) {
  const current = monthKey(today.getFullYear(), today.getMonth());
  return [-1, 0, 1, 2].map((amount) => addMonths(current, amount));
}

// "Hospital Antonio Prudente, Fortaleza/CE" (o Worker monta igual a partir do grupo)
export function groupPlace(group) {
  const unit = group.unit;
  if (!unit) return '';
  return [unit.name, unit.city && unit.state ? `${unit.city}/${unit.state}` : unit.city].filter(Boolean).join(', ');
}

// Células com gente: { "07_<turno>": [uid] }. onlyUid: só as células dessa pessoa.
export function calendarCells(assignments, onlyUid = null) {
  const cells = {};
  for (const [key, uids] of Object.entries(assignments ?? {})) {
    const people = [...new Set(uids ?? [])].filter((uid) => !onlyUid || uid === onlyUid);
    if (people.length) cells[key] = people;
  }
  return cells;
}

// Turnos usados pelas células, no formato do Worker: { id: { titulo, inicio, fim } }
export function calendarShifts(shifts, cells) {
  const used = new Set(Object.keys(cells).map((key) => parseCellKey(key).shiftId));
  return Object.fromEntries(
    [...used]
      .filter((id) => shifts[id])
      .map((id) => [id, { titulo: shifts[id].title, inicio: shifts[id].startMinute, fim: shifts[id].endMinute }]),
  );
}

// Falta algum turno nos congelados da publicação? (turno criado depois de publicar)
export function needsLiveShifts(schedule, cells) {
  const frozen = schedule?.shifts ?? {};
  return Object.keys(cells).some((key) => !frozen[parseCellKey(key).shiftId]);
}

// Uma escala publicada no formato de /agenda/meus-plantoes
export function calendarSchedule({ group, month, cells, shifts }) {
  return {
    grupoId: group.id,
    mes: month,
    nome: group.name,
    local: groupPlace(group),
    fuso: group.timezone,
    turnos: calendarShifts(shifts, cells),
    celulas: cells,
  };
}

// "Atualizada hoje às 14h32" / "Atualizada em 07/11 às 09h05"
export function syncedLabel(timestamp, now = new Date()) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const time = `${String(date.getHours()).padStart(2, '0')}h${String(date.getMinutes()).padStart(2, '0')}`;
  const sameDay = date.toDateString() === now.toDateString();
  const day = `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
  return sameDay ? `Atualizada hoje às ${time}` : `Atualizada em ${day} às ${time}`;
}
