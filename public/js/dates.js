// Datas em português e em texto "AAAA-MM-DD" (sem fuso: sempre a data local).
// Sem Firebase nem DOM: testado com `node --test` (tests/shift-report.test.mjs).

export const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const MONTHS_SHORT = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
export const WEEKDAYS_SHORT = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];

const pad = (n) => String(n).padStart(2, '0');

// Date → "2026-11-07"
export const isoDate = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

// "2026-11-07" → Date (meia-noite local)
export function parseIsoDate(text) {
  const [y, m, d] = String(text).split('-').map(Number);
  return new Date(y, m - 1, d);
}

// "2026-11-07" → "07/11/2026"
export function brDate(text) {
  const [y, m, d] = String(text).split('-');
  return `${d}/${m}/${y}`;
}

// "2026-11-07" → "07 NOV · SÁB"
export function dayHeading(text) {
  const date = parseIsoDate(text);
  return `${pad(date.getDate())} ${MONTHS_SHORT[date.getMonth()]} · ${WEEKDAYS_SHORT[date.getDay()]}`;
}

// Dias entre duas datas "AAAA-MM-DD" (fim - início), contando calendário, sem horário de verão
export function daysBetween(start, end) {
  const [a, b] = [parseIsoDate(start), parseIsoDate(end)];
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
}

// Meses ("AAAA-MM") que o período toca, em ordem
export function monthsInRange(start, end) {
  const months = [];
  let [y, m] = start.split('-').map(Number);
  const [endY, endM] = end.split('-').map(Number);
  while (y < endY || (y === endY && m <= endM)) {
    months.push(`${y}-${pad(m)}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months;
}

// Primeiro e último dia do mês da data (deslocado em "offset" meses)
export function monthRange(date = new Date(), offset = 0) {
  const first = new Date(date.getFullYear(), date.getMonth() + offset, 1);
  const last = new Date(date.getFullYear(), date.getMonth() + offset + 1, 0);
  return { start: isoDate(first), end: isoDate(last) };
}
