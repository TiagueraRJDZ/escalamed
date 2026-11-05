// Testes do Relatório de Plantões e das datas. Rodar: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectShifts, buildShiftReport, periodOf } from '../public/js/shift-report.js';
import { daysBetween, monthsInRange, dayHeading, brDate, monthRange } from '../public/js/dates.js';

const shifts = {
  m: { title: 'M', startMinute: 420, endMinute: 780 }, // 07:00-13:00
  n: { title: 'N', startMinute: 1140, endMinute: 420 }, // 19:00-07:00 (vira a noite)
};

test('período do turno pelo horário de início', () => {
  assert.equal(periodOf(420).id, 'M');
  assert.equal(periodOf(780).id, 'T');
  assert.equal(periodOf(1140).id, 'N');
  assert.equal(periodOf(0).id, 'N');
});

test('plantões do período: só dentro das datas, horas com virada da noite', () => {
  const months = [
    { month: '2026-10', schedule: { assignments: { '31_n': ['ana'] } }, shifts },
    { month: '2026-11', schedule: { assignments: { '01_m': ['ana', 'bia'], '02_n': ['bia'], '30_m': ['ana'] } }, shifts },
  ];
  const entries = collectShifts(months, '2026-10-31', '2026-11-02');
  assert.equal(entries.length, 4);
  assert.equal(entries.find((e) => e.date === '2026-10-31').minutes, 720); // 19h às 07h = 12h
  assert.equal(collectShifts(months, '2026-10-31', '2026-11-02', 'bia').length, 2);
  assert.equal(collectShifts(months, '2026-11-03', '2026-11-29').length, 0);
});

test('relatório: por pessoa, em ordem alfabética, com totais', () => {
  const months = [{ month: '2026-11', schedule: { assignments: { '02_n': ['bia'], '01_m': ['bia', 'ana', 'saiu'] } }, shifts }];
  const report = buildShiftReport(collectShifts(months, '2026-11-01', '2026-11-30'), [
    { id: 'bia', name: 'Beatriz' },
    { id: 'ana', name: 'Ana' },
  ]);
  assert.deepEqual(report.people.map((p) => p.name), ['Ana', 'Beatriz', 'Ex-membro']);
  const bia = report.people[1];
  assert.deepEqual(bia.shifts.map((s) => s.date), ['2026-11-01', '2026-11-02']);
  assert.equal(bia.minutes, 360 + 720);
  assert.deepEqual(report.totals, { shifts: 4, minutes: 360 * 3 + 720, people: 3 });
});

test('datas: dias entre, meses do período, cabeçalho do dia', () => {
  assert.equal(daysBetween('2026-11-01', '2026-11-30'), 29);
  assert.equal(daysBetween('2026-12-31', '2027-01-01'), 1);
  assert.deepEqual(monthsInRange('2026-11-15', '2027-01-10'), ['2026-11', '2026-12', '2027-01']);
  assert.equal(dayHeading('2026-10-11'), '11 OUT · DOM');
  assert.equal(brDate('2026-11-07'), '07/11/2026');
  assert.deepEqual(monthRange(new Date(2026, 0, 15), -1), { start: '2025-12-01', end: '2025-12-31' });
});
