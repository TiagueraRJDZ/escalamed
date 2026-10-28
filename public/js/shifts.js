// Horários de turno. Os turnos guardam minutos desde 00:00 (0 a 1439).
// Fim menor que o início = termina no dia seguinte; início igual ao fim = 24 horas.

export function toMinutes(time) {
  const [h, m] = String(time).split(':').map(Number);
  return h * 60 + m;
}

export function toTime(minutes) {
  const h = String(Math.floor(minutes / 60)).padStart(2, '0');
  const m = String(minutes % 60).padStart(2, '0');
  return `${h}:${m}`;
}

export function durationMinutes(start, end) {
  if (end > start) return end - start;
  if (end < start) return 1440 - start + end;
  return 1440;
}

export function endsNextDay(start, end) {
  return end <= start;
}

// Dois turnos se sobrepõem quando começam no mesmo dia? (ex.: REF dentro do T; N e N1).
// A virada da meia-noite entra no cálculo: NF (22h-01h) e N (19h-01h) se sobrepõem.
// Conflitos entre dias diferentes ficam em schedule-math.js.
export function overlaps(a, b) {
  const endA = a.startMinute + durationMinutes(a.startMinute, a.endMinute);
  const endB = b.startMinute + durationMinutes(b.startMinute, b.endMinute);
  return a.startMinute < endB && b.startMinute < endA;
}

// 420 -> "07h00" (horário como aparece na escala)
export function formatClock(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}h${String(minutes % 60).padStart(2, '0')}`;
}

// 720 -> "12h"; 750 -> "12h30"
export function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

// Sugestões rápidas na criação do grupo
export const SHIFT_PRESETS = [
  { title: 'Diurno', start: 420, end: 1140 },
  { title: 'Noturno', start: 1140, end: 420 },
  { title: '24 horas', start: 420, end: 420 },
  { title: 'Manhã', start: 420, end: 780 },
  { title: 'Tarde', start: 780, end: 1140 },
];
