// Relatório de Plantões: junta os plantões das escalas publicadas num período e agrupa
// por pessoa. Sem Firebase nem DOM: testado com `node --test` (tests/shift-report.test.mjs).
import { durationMinutes } from './shifts.js';
import { parseCellKey } from './schedule-math.js';

// Período do turno pelo horário de início: manhã (05h-11h59), tarde (12h-17h59), noite (resto)
export const PERIODS = [
  { id: 'M', label: 'Manhã', from: 5 * 60, to: 12 * 60 },
  { id: 'T', label: 'Tarde', from: 12 * 60, to: 18 * 60 },
];
export const NIGHT = { id: 'N', label: 'Noite' };

export const periodOf = (startMinute) => PERIODS.find((p) => startMinute >= p.from && startMinute < p.to) ?? NIGHT;

// Limites do relatório
export const MAX_RANGE_DAYS = 92;

const pad = (n) => String(n).padStart(2, '0');

// Plantões do período a partir dos meses carregados.
// months: [{ month: "2026-11", schedule, shifts }] (só escalas publicadas; shifts = turnos
// com os congelados na publicação). start/end: "AAAA-MM-DD". uid: só de uma pessoa.
// Devolve [{ uid, date, shiftId, title, startMinute, endMinute, minutes, period }]
export function collectShifts(months, start, end, uid = null) {
  const entries = [];
  for (const { month, schedule, shifts } of months) {
    for (const [key, uids] of Object.entries(schedule?.assignments ?? {})) {
      const { day, shiftId } = parseCellKey(key);
      const date = `${month}-${pad(day)}`;
      const shift = shifts?.[shiftId];
      if (!shift || date < start || date > end) continue;
      for (const person of uids ?? []) {
        if (uid && person !== uid) continue;
        entries.push({
          uid: person,
          date,
          shiftId,
          title: shift.title,
          startMinute: shift.startMinute,
          endMinute: shift.endMinute,
          minutes: durationMinutes(shift.startMinute, shift.endMinute),
          period: periodOf(shift.startMinute).id,
        });
      }
    }
  }
  return entries;
}

// Agrupa por pessoa (ordem alfabética; só quem tem plantão).
// members: cartões de membro [{ id, name, ... }]; quem saiu do grupo aparece como "Ex-membro".
export function buildShiftReport(entries, members = []) {
  const byId = new Map(members.map((m) => [m.id, m]));
  const people = new Map();
  for (const entry of entries) {
    if (!people.has(entry.uid)) {
      const member = byId.get(entry.uid) ?? { id: entry.uid, name: 'Ex-membro' };
      people.set(entry.uid, { uid: entry.uid, member, name: member.name ?? 'Ex-membro', shifts: [], minutes: 0 });
    }
    const person = people.get(entry.uid);
    person.shifts.push(entry);
    person.minutes += entry.minutes;
  }
  const list = [...people.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  list.forEach((p) => p.shifts.sort((a, b) => a.date.localeCompare(b.date) || a.startMinute - b.startMinute));
  return {
    people: list,
    totals: {
      shifts: entries.length,
      minutes: entries.reduce((sum, e) => sum + e.minutes, 0),
      people: list.length,
    },
  };
}
