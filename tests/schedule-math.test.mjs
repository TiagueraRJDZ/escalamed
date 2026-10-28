// Testes da escala mensal (public/js/schedule-math.js) e da sobreposição de turnos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overlaps, formatClock } from '../public/js/shifts.js';
import {
  daysInMonth,
  weekdayOf,
  addMonths,
  cellKey,
  parseCellKey,
  memberMinutes,
  formatHours,
  findConflict,
  userDays,
  dayShifts,
  replicationMap,
  replicate,
} from '../public/js/schedule-math.js';

// Turnos do grupo de referência
const SHIFTS = {
  m: { title: 'M', startMinute: 420, endMinute: 780 },
  t: { title: 'T', startMinute: 780, endMinute: 1140 },
  ref: { title: 'REF', startMinute: 960, endMinute: 1140 },
  n: { title: 'N', startMinute: 1140, endMinute: 60 },
  n1: { title: 'N1', startMinute: 1140, endMinute: 1320 },
  nf: { title: 'NF', startMinute: 1320, endMinute: 60 },
  mad: { title: 'MAD', startMinute: 0, endMinute: 360 },
};

test('meses e dias', () => {
  assert.equal(daysInMonth('2026-02'), 28);
  assert.equal(daysInMonth('2028-02'), 29);
  assert.equal(daysInMonth('2026-10'), 31);
  assert.equal(weekdayOf('2026-10', 1), 4); // 01/10/2026 é quinta
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
});

test('chaves das células', () => {
  assert.equal(cellKey(7, 'abc'), '07_abc');
  assert.deepEqual(parseCellKey('07_abc_d'), { day: 7, shiftId: 'abc_d' });
});

test('sobreposição de turnos no mesmo dia (com a virada da meia-noite)', () => {
  assert.ok(overlaps(SHIFTS.t, SHIFTS.ref)); // REF dentro do T
  assert.ok(overlaps(SHIFTS.n, SHIFTS.n1));
  assert.ok(overlaps(SHIFTS.n, SHIFTS.nf)); // os dois passam da meia-noite
  assert.ok(!overlaps(SHIFTS.m, SHIFTS.t)); // T começa quando M termina
  assert.ok(!overlaps(SHIFTS.n1, SHIFTS.nf));
  assert.equal(formatClock(420), '07h00');
});

test('horas do membro no mês', () => {
  const uid = 'ana';
  // M + T + N no mesmo dia = 18h
  const sameDay = { [cellKey(5, 'm')]: [uid], [cellKey(5, 't')]: [uid], [cellKey(5, 'n')]: [uid, 'bia'] };
  assert.equal(formatHours(memberMinutes(sameDay, SHIFTS, uid)), '18h00');
  // T + N + NF em dias diferentes = 15h
  const days = { [cellKey(1, 't')]: [uid], [cellKey(2, 'n')]: [uid], [cellKey(3, 'nf')]: [uid] };
  assert.equal(formatHours(memberMinutes(days, SHIFTS, uid)), '15h00');
  // Turno apagado não conta
  assert.equal(memberMinutes({ [cellKey(1, 'sumiu')]: [uid] }, SHIFTS, uid), 0);
});

test('conflito: turnos sobrepostos no mesmo dia', () => {
  const a = { [cellKey(10, 'n')]: ['ana'] };
  assert.deepEqual(findConflict(a, SHIFTS, 'ana', 10, 'n1')?.shiftId, 'n');
  assert.equal(findConflict(a, SHIFTS, 'ana', 10, 'm'), null);
  assert.equal(findConflict(a, SHIFTS, 'bia', 10, 'n1'), null); // outra pessoa
  assert.equal(findConflict(a, SHIFTS, 'ana', 10, 'n'), null); // a própria célula
});

test('conflito entre dias: o N da noite bate com o turno da madrugada seguinte', () => {
  const a = { [cellKey(30, 'n')]: ['ana'] };
  assert.equal(findConflict(a, SHIFTS, 'ana', 31, 'mad')?.day, 30);
  // E no sentido contrário
  const b = { [cellKey(31, 'mad')]: ['ana'] };
  assert.equal(findConflict(b, SHIFTS, 'ana', 30, 'nf')?.day, 31);
  // M do dia seguinte começa às 07h: sem conflito
  assert.equal(findConflict(a, SHIFTS, 'ana', 31, 'm'), null);
});

test('dias com plantão e visão do dia', () => {
  const schedule = {
    assignments: { [cellKey(3, 'm')]: ['ana'], [cellKey(9, 'n')]: ['ana', 'bia'] },
    vacancies: { [cellKey(9, 'n')]: 2 },
    fixed: { [cellKey(9, 'n')]: ['bia'] },
  };
  assert.deepEqual([...userDays(schedule.assignments, 'ana')], [3, 9]);
  const shifts = { m: SHIFTS.m, n: SHIFTS.n };
  const day9 = dayShifts(schedule, shifts, 9);
  assert.deepEqual(day9.map((s) => s.shiftId), ['m', 'n']);
  assert.deepEqual(day9[1].uids, ['ana', 'bia']);
  assert.equal(day9[1].vacancies, 2);
  assert.deepEqual(dayShifts(schedule, shifts, 9, { fixed: true })[1].uids, ['bia']);
});

test('replicar por dia da semana e posição', () => {
  // Outubro/2026 começa numa quinta; novembro/2026, num domingo
  const map = replicationMap('2026-10', '2026-11', 'weekday');
  assert.equal(map.get(1), 4); // 1º domingo de nov ← 1º domingo de out (dia 4)
  assert.equal(map.get(2), 5); // 1ª segunda
  assert.equal(map.get(30), 26); // 5ª segunda de nov ← 4ª segunda de out (out tem só 4)
  for (const [to, from] of map) assert.equal(weekdayOf('2026-11', to), weekdayOf('2026-10', from));
});

test('replicar pelo número do dia (o 31 some em mês de 30 dias)', () => {
  const map = replicationMap('2026-10', '2026-11', 'day');
  assert.equal(map.get(15), 15);
  assert.equal(map.size, 30);
  const map2 = replicationMap('2026-11', '2026-12', 'day');
  assert.equal(map2.has(31), false); // novembro não tem dia 31
});

test('replicar copia alocações e vagas, só dos turnos que existem', () => {
  const source = {
    assignments: { [cellKey(4, 'm')]: ['ana'], [cellKey(4, 'sumiu')]: ['bia'] },
    vacancies: { [cellKey(4, 'n')]: 1 },
  };
  const result = replicate(source, '2026-10', '2026-11', 'weekday', ['m', 'n']);
  assert.deepEqual(result.assignments, { [cellKey(1, 'm')]: ['ana'] });
  assert.deepEqual(result.vacancies, { [cellKey(1, 'n')]: 1 });
});
