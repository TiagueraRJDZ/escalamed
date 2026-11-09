// Testes do que o app manda para a Agenda Google (public/js/gcal-data.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  syncMonths,
  groupPlace,
  calendarCells,
  calendarShifts,
  calendarSchedule,
  needsLiveShifts,
  syncedLabel,
} from '../public/js/gcal-data.js';

const SHIFTS = {
  d: { title: 'Diurno', startMinute: 420, endMinute: 1140 },
  n: { title: 'Noturno', startMinute: 1140, endMinute: 420 },
  x: { title: 'Extra', startMinute: 0, endMinute: 360 },
};

test('meses sincronizados: anterior, atual e os dois seguintes (com virada de ano)', () => {
  assert.deepEqual(syncMonths(new Date(2026, 11, 15)), ['2026-11', '2026-12', '2027-01', '2027-02']);
  assert.deepEqual(syncMonths(new Date(2026, 0, 1)), ['2025-12', '2026-01', '2026-02', '2026-03']);
});

test('local do grupo: unidade, cidade/UF; escala individual fica sem local', () => {
  assert.equal(groupPlace({ unit: { name: 'Antonio Prudente', city: 'Fortaleza', state: 'CE' } }), 'Antonio Prudente, Fortaleza/CE');
  assert.equal(groupPlace({ unit: null }), '');
});

test('células: só as da pessoa, sem células vazias e sem repetir uid', () => {
  const assignments = { '01_d': ['a', 'b'], '02_n': ['b'], '03_d': [], '04_x': ['a', 'a'] };
  assert.deepEqual(calendarCells(assignments, 'a'), { '01_d': ['a'], '04_x': ['a'] });
  assert.deepEqual(calendarCells(assignments), { '01_d': ['a', 'b'], '02_n': ['b'], '04_x': ['a'] });
  assert.deepEqual(calendarCells(undefined, 'a'), {});
});

test('turnos: só os usados, no formato do Worker', () => {
  const cells = { '01_d': ['a'], '05_d': ['a'], '02_n': ['a'] };
  assert.deepEqual(calendarShifts(SHIFTS, cells), {
    d: { titulo: 'Diurno', inicio: 420, fim: 1140 },
    n: { titulo: 'Noturno', inicio: 1140, fim: 420 },
  });
});

test('turno criado depois da publicação precisa dos turnos atuais', () => {
  const schedule = { shifts: { d: SHIFTS.d } };
  assert.equal(needsLiveShifts(schedule, { '01_d': ['a'] }), false);
  assert.equal(needsLiveShifts(schedule, { '01_d': ['a'], '02_x': ['a'] }), true);
  assert.equal(needsLiveShifts(null, {}), false);
});

test('escala no formato de /agenda/meus-plantoes', () => {
  const group = { id: 'g1', name: 'UTI Adulto', timezone: 'America/Fortaleza', unit: { name: 'HAP', city: 'Fortaleza', state: 'CE' } };
  const cells = { '07_n': ['a'] };
  assert.deepEqual(calendarSchedule({ group, month: '2026-11', cells, shifts: SHIFTS }), {
    grupoId: 'g1',
    mes: '2026-11',
    nome: 'UTI Adulto',
    local: 'HAP, Fortaleza/CE',
    fuso: 'America/Fortaleza',
    turnos: { n: { titulo: 'Noturno', inicio: 1140, fim: 420 } },
    celulas: cells,
  });
});

test('texto da última atualização', () => {
  const now = new Date(2026, 10, 9, 18, 0);
  assert.equal(syncedLabel(new Date(2026, 10, 9, 14, 5).getTime(), now), 'Atualizada hoje às 14h05');
  assert.equal(syncedLabel(new Date(2026, 10, 7, 9, 30).getTime(), now), 'Atualizada em 07/11 às 09h30');
  assert.equal(syncedLabel(null, now), '');
});
