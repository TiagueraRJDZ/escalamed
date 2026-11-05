// Exportar o Relatório de Plantões: Excel (.xlsx, pela biblioteca SheetJS baixada do CDN só
// quando a pessoa pede) e PDF (pela impressão do navegador, com @media print em reports.css).
import { toTime } from './shifts.js';
import { normalize } from './validators.js';
import { brDate } from './dates.js';
import { professionLabel, councilLabel } from '/data/categories.js';

const SHEETJS_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';

function loadSheetJs() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SHEETJS_URL;
    script.onload = () => resolve(window.XLSX);
    script.onerror = () => reject(new Error('Não foi possível baixar o gerador de planilhas. Verifique sua conexão.'));
    document.head.append(script);
  });
}

// "relatorio-teleauditoria-hapvida-01-11-2026_a_30-11-2026"
export function reportFileName(groupName, start, end) {
  const slug = normalize(groupName).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'grupo';
  const day = (iso) => brDate(iso).replaceAll('/', '-');
  return `relatorio-${slug}-${day(start)}_a_${day(end)}`;
}

const hours = (minutes) => Math.round((minutes / 60) * 100) / 100;

// Uma linha por plantão, total por membro e total geral
export async function exportXlsx(report, { groupName, start, end }) {
  const XLSX = await loadSheetJs();
  const rows = [['Membro', 'Profissão', 'Registro', 'Data', 'Início', 'Fim', 'Turno', 'Período', 'Horas']];
  for (const person of report.people) {
    const profession = professionLabel(person.member);
    const council = councilLabel(person.member.council);
    for (const s of person.shifts) {
      rows.push([person.name, profession, council, brDate(s.date), toTime(s.startMinute), toTime(s.endMinute), s.title, s.period, hours(s.minutes)]);
    }
    rows.push([`Total de ${person.name}`, '', '', `${person.shifts.length} plantões`, '', '', '', '', hours(person.minutes)]);
  }
  rows.push(['Total geral', '', '', `${report.totals.shifts} plantões`, '', '', '', '', hours(report.totals.minutes)]);

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = [28, 28, 18, 12, 8, 8, 14, 8, 8].map((wch) => ({ wch }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Plantões');
  XLSX.writeFile(book, `${reportFileName(groupName, start, end)}.xlsx`);
}

// PDF: a impressão usa o título da página como nome sugerido do arquivo
export function exportPdf({ groupName, start, end }) {
  const title = document.title;
  document.title = reportFileName(groupName, start, end);
  window.addEventListener('afterprint', () => (document.title = title), { once: true });
  window.print();
}
