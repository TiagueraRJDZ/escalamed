// Calendário mensal: navegação entre meses, dia de hoje destacado e seleção de dia.
// Uso: createCalendar(elemento, { onSelect: (data) => ... })
import { icon } from './icons.js';

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const monthFormat = new Intl.DateTimeFormat('pt-BR', { month: 'long' });
const dayLabelFormat = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });

const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

export function createCalendar(container, { onSelect } = {}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let month = new Date(today.getFullYear(), today.getMonth(), 1);
  let selected = null;

  function render() {
    const year = month.getFullYear();
    const firstWeekday = month.getDay();
    const daysInMonth = new Date(year, month.getMonth() + 1, 0).getDate();

    const blanks = Array.from({ length: firstWeekday }, () => '<span class="cal-blank"></span>');
    const days = Array.from({ length: daysInMonth }, (_, i) => {
      const date = new Date(year, month.getMonth(), i + 1);
      const classes = ['cal-day'];
      if (date < today) classes.push('is-past');
      const isToday = sameDay(date, today);
      const isSelected = selected && sameDay(date, selected);
      return `<button type="button" class="${classes.join(' ')}" data-day="${i + 1}"
        aria-label="${dayLabelFormat.format(date)}"${isToday ? ' aria-current="date"' : ''}
        aria-pressed="${Boolean(isSelected)}">${i + 1}</button>`;
    });

    container.innerHTML = `
      <div class="cal-header">
        <button type="button" class="btn-icon" data-nav="-1" aria-label="Mês anterior">${icon('chevronLeft')}</button>
        <h2 class="cal-title" aria-live="polite">${capitalize(monthFormat.format(month))} <span>${year}</span></h2>
        <button type="button" class="btn-icon" data-nav="1" aria-label="Próximo mês">${icon('chevronRight')}</button>
      </div>
      <div class="cal-grid" role="group" aria-label="Dias do mês">
        ${WEEKDAYS.map((d) => `<span class="cal-weekday" aria-hidden="true">${d}</span>`).join('')}
        ${blanks.join('')}${days.join('')}
      </div>`;
  }

  container.addEventListener('click', (event) => {
    const nav = event.target.closest('[data-nav]');
    if (nav) {
      month = new Date(month.getFullYear(), month.getMonth() + Number(nav.dataset.nav), 1);
      render();
      return;
    }
    const day = event.target.closest('[data-day]');
    if (day) {
      const date = new Date(month.getFullYear(), month.getMonth(), Number(day.dataset.day));
      selected = selected && sameDay(selected, date) ? null : date;
      render();
      container.querySelector(`[data-day="${day.dataset.day}"]`)?.focus();
      onSelect?.(selected);
    }
  });

  render();
}
