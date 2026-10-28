// Escala mensal: células, horas, conflitos de horário e replicação.
// Sem Firebase: testado com `node --test` (tests/schedule-math.test.mjs).
//
// Documento groups/{g}/schedules/{YYYY-MM}:
//   assignments: { "07_<shiftId>": [uid, ...] }   quem está em cada plantão (escala dinâmica)
//   vacancies:   { "07_<shiftId>": número }       vagas abertas
//   fixed:       cópia de assignments ao publicar (escala fixa)
//   shifts:      turnos congelados ao publicar
// O plantão pertence ao dia em que começa (o N do dia 30 termina à 01h do dia 31).
import { durationMinutes } from './shifts.js';

export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
export const MAX_VACANCIES = 20;

// ---------- Meses e dias ----------
export const monthKey = (year, monthIndex) => `${year}-${String(monthIndex + 1).padStart(2, '0')}`;

export function monthParts(month) {
  const [year, number] = month.split('-').map(Number);
  return { year, monthIndex: number - 1 };
}

export function daysInMonth(month) {
  const { year, monthIndex } = monthParts(month);
  return new Date(year, monthIndex + 1, 0).getDate();
}

// 0 = domingo
export function weekdayOf(month, day) {
  const { year, monthIndex } = monthParts(month);
  return new Date(year, monthIndex, day).getDay();
}

export function addMonths(month, amount) {
  const { year, monthIndex } = monthParts(month);
  const date = new Date(year, monthIndex + amount, 1);
  return monthKey(date.getFullYear(), date.getMonth());
}

// ---------- Células ----------
export const cellKey = (day, shiftId) => `${String(day).padStart(2, '0')}_${shiftId}`;

export function parseCellKey(key) {
  const at = key.indexOf('_');
  return { day: Number(key.slice(0, at)), shiftId: key.slice(at + 1) };
}

// Turnos em ordem de exibição: início do dia primeiro, depois pelo título
export function sortShifts(shifts) {
  return [...shifts].sort((a, b) => a.startMinute - b.startMinute || a.title.localeCompare(b.title, 'pt-BR'));
}

// Plantões de uma pessoa: [{ key, day, shiftId }], em ordem
export function cellsOf(assignments, uid) {
  return Object.entries(assignments ?? {})
    .filter(([, uids]) => uids?.includes(uid))
    .map(([key]) => ({ key, ...parseCellKey(key) }))
    .sort((a, b) => a.day - b.day || a.shiftId.localeCompare(b.shiftId));
}

// Dias do mês em que a pessoa tem plantão
export const userDays = (assignments, uid) => new Set(cellsOf(assignments, uid).map((c) => c.day));

// ---------- Horas ----------
// shifts: { id: { startMinute, endMinute } }. Turno apagado não conta.
export function memberMinutes(assignments, shifts, uid) {
  return cellsOf(assignments, uid).reduce((total, { shiftId }) => {
    const shift = shifts[shiftId];
    return shift ? total + durationMinutes(shift.startMinute, shift.endMinute) : total;
  }, 0);
}

// 1080 -> "18h00" (total de horas na grade)
export function formatHours(minutes) {
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`;
}

// ---------- Conflitos ----------
// Início e fim do plantão em minutos contados desde a 00h do dia 1 do mês
export function shiftInterval(day, shift) {
  const start = (day - 1) * 1440 + shift.startMinute;
  return [start, start + durationMinutes(shift.startMinute, shift.endMinute)];
}

// A pessoa já tem um plantão que se sobrepõe a (day, shiftId)? Vale entre dias:
// o N do dia 30 (19h-01h) bate com um turno que começa à 00h do dia 31.
// Devolve o plantão em conflito ({ key, day, shiftId }) ou null.
export function findConflict(assignments, shifts, uid, day, shiftId) {
  const shift = shifts[shiftId];
  if (!shift) return null;
  const [start, end] = shiftInterval(day, shift);
  for (const cell of cellsOf(assignments, uid)) {
    if (cell.day === day && cell.shiftId === shiftId) continue;
    const other = shifts[cell.shiftId];
    if (!other || Math.abs(cell.day - day) > 1) continue;
    const [otherStart, otherEnd] = shiftInterval(cell.day, other);
    if (start < otherEnd && otherStart < end) return cell;
  }
  return null;
}

// ---------- Visão de um dia ----------
// [{ shiftId, shift, uids, vacancies }] em ordem de horário (só turnos que existem)
export function dayShifts(schedule, shifts, day, { fixed = false } = {}) {
  const source = (fixed ? schedule?.fixed : schedule?.assignments) ?? {};
  return sortShifts(Object.entries(shifts).map(([id, shift]) => ({ id, ...shift }))).map((shift) => {
    const key = cellKey(day, shift.id);
    return {
      shiftId: shift.id,
      shift,
      uids: source[key] ?? [],
      vacancies: fixed ? 0 : schedule?.vacancies?.[key] ?? 0,
    };
  });
}

// ---------- Replicação ----------
// N-ésima ocorrência do dia da semana no mês (dia 1-7 = 1ª, 8-14 = 2ª...)
const weekPosition = (day) => Math.ceil(day / 7);

// Dia de origem para cada dia do mês de destino.
// "weekday": mesmo dia da semana e mesma posição (2ª segunda → 2ª segunda); a 5ª
// ocorrência, quando o mês de origem não tem, usa a 4ª. "day": mesmo número do dia.
export function replicationMap(fromMonth, toMonth, mode = 'weekday') {
  const fromDays = daysInMonth(fromMonth);
  const map = new Map();
  for (let day = 1; day <= daysInMonth(toMonth); day++) {
    if (mode === 'day') {
      if (day <= fromDays) map.set(day, day);
      continue;
    }
    const weekday = weekdayOf(toMonth, day);
    const position = weekPosition(day);
    const sameWeekday = [];
    for (let d = 1; d <= fromDays; d++) if (weekdayOf(fromMonth, d) === weekday) sameWeekday.push(d);
    map.set(day, sameWeekday[Math.min(position, sameWeekday.length) - 1]);
  }
  return map;
}

// Copia alocações e vagas de um mês para outro. shiftIds: turnos que ainda existem.
export function replicate(source, fromMonth, toMonth, mode, shiftIds) {
  const valid = new Set(shiftIds);
  const assignments = {};
  const vacancies = {};
  for (const [toDay, fromDay] of replicationMap(fromMonth, toMonth, mode)) {
    for (const shiftId of valid) {
      const from = cellKey(fromDay, shiftId);
      const to = cellKey(toDay, shiftId);
      const uids = source.assignments?.[from] ?? [];
      if (uids.length) assignments[to] = [...uids];
      const open = source.vacancies?.[from] ?? 0;
      if (open > 0) vacancies[to] = open;
    }
  }
  return { assignments, vacancies };
}
