// Páginas ainda em construção: só montam o layout e mostram o aviso.
import { initLayout } from '../layout.js';
import { icon } from '../icons.js';

const page = document.getElementById('page');
const notice = page.querySelector('[data-icon]');
notice.insertAdjacentHTML('afterbegin', icon(notice.dataset.icon));

await initLayout({ active: page.dataset.active });
