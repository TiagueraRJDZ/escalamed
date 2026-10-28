// Monta o layout das páginas internas: menu lateral, barra superior,
// menu da conta, gaveta de Notificações e modal do Google Agenda.
// Uso na página:  const { user } = await initLayout({ active: 'schedules' });
import { requireAuth, signOutUser } from './auth.js';
import { icon } from './icons.js';
import { escapeHtml, initials, toast, setupMenu } from './ui.js';
import { mountCredits } from './version.js';
import { setupPeopleSearch, personModalHtml } from './people-search.js';
import { syncMemberCards } from './members.js';

const NAV = [
  { id: 'schedules', label: 'Escalas', icon: 'calendar', href: '/schedules.html' },
];

const COLLAPSED_KEY = 'escalamed:menu-recolhido';

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function saveCollapsed(collapsed) {
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    // sem armazenamento (aba anônima): só não lembra a preferência
  }
}

function navItem(item, active) {
  const badge = item.badge ? `<span class="badge badge-new">${item.badge}</span>` : '';
  const content = `${icon(item.icon)}<span class="nav-label">${item.label}</span>${badge}`;
  const common = `class="nav-item" title="${item.label}" aria-label="${item.label}"`;
  if (item.href) {
    const current = item.id === active ? ' aria-current="page"' : '';
    return `<li><a ${common} href="${item.href}"${current}>${content}</a></li>`;
  }
  return `<li><button type="button" ${common} data-open="${item.drawer}" aria-haspopup="dialog">${content}</button></li>`;
}

export function avatarHtml({ name, photoURL } = {}, className = 'avatar') {
  return photoURL
    ? `<span class="${className}"><img src="${escapeHtml(photoURL)}" alt="" referrerpolicy="no-referrer" /></span>`
    : `<span class="${className}">${escapeHtml(initials(name))}</span>`;
}

const toggleLabel = (collapsed) => (collapsed ? 'Expandir menu' : 'Recolher menu');

function shellHtml(user, profile, active, collapsed) {
  return `
    <aside class="sidebar" id="sidebar" aria-label="Menu principal">
      <a class="sidebar-brand" href="/schedules.html" aria-label="Hapvida EscalaMed">
        <img class="sidebar-partner" src="/img/hapvida-logo.svg" alt="" width="98" height="22" />
        <span class="sidebar-brand-divider" aria-hidden="true"></span>
        <img src="/img/logo.svg" alt="" /><span class="sidebar-brand-name">EscalaMed</span>
      </a>
      <nav aria-label="Navegação principal">
        <ul class="nav">${NAV.map((item) => navItem(item, active)).join('')}</ul>
      </nav>
    </aside>
    <!-- Botão redondo na borda do menu: recolhe e expande -->
    <button type="button" class="sidebar-toggle" id="sidebar-toggle" aria-controls="sidebar"
      aria-expanded="${!collapsed}" aria-label="${toggleLabel(collapsed)}" title="${toggleLabel(collapsed)}">
      ${icon('chevronLeft')}
    </button>
    <div class="sidebar-backdrop" id="sidebar-backdrop"></div>

    <div class="app-main">
      <header class="topbar">
        <button type="button" class="btn-icon topbar-menu" id="menu-open" aria-label="Abrir menu" aria-controls="sidebar" aria-expanded="false">
          ${icon('menu')}
        </button>

        <form class="topbar-search input-icon" role="search" id="global-search">
          ${icon('search')}
          <label class="sr-only" for="global-search-input">Buscar pessoas</label>
          <input class="input" id="global-search-input" type="search" placeholder="Quem gostaria de encontrar?" autocomplete="off" />
        </form>

        <div class="topbar-actions">
          <button type="button" class="btn-icon gcal-button" data-open="modal-gcal" aria-haspopup="dialog" aria-label="Conectar Google Agenda" title="Google Agenda">
            ${icon('calendar', 'gcal-icon')}
          </button>
          <button type="button" class="btn-icon" id="notifications-button" data-open="drawer-notifications" aria-haspopup="dialog" aria-label="Notificações" title="Notificações">
            ${icon('bell')}
          </button>
          <div class="menu-anchor">
            <button type="button" class="avatar-button" id="avatar-button" aria-haspopup="menu" aria-expanded="false" aria-controls="user-menu" aria-label="Menu da conta">
              ${avatarHtml(profile)}
            </button>
            <div class="menu" id="user-menu" role="menu" aria-label="Conta" hidden>
              <div class="menu-header">
                <strong>${escapeHtml(profile.name || 'Minha conta')}</strong>
                <span>${escapeHtml(user.email || '')}</span>
              </div>
              <a class="menu-item" role="menuitem" href="/settings.html#conta">${icon('user')}Minha conta</a>
              <a class="menu-item" role="menuitem" href="/settings.html#senha">${icon('settings')}Configurações</a>
              <button type="button" class="menu-item is-danger" role="menuitem" id="logout">${icon('logOut')}Sair</button>
            </div>
          </div>
        </div>
      </header>
    </div>`;
}

function dialogsHtml() {
  const closeButton = `<button type="button" class="btn-icon" data-close aria-label="Fechar">${icon('x')}</button>`;
  return `
    <dialog class="drawer" id="drawer-notifications" aria-labelledby="drawer-notifications-title">
      <div class="dialog-header"><h2 id="drawer-notifications-title">Notificações</h2>${closeButton}</div>
      <div class="dialog-body">
        <div class="chips" role="group" aria-label="Filtrar notificações">
          <button type="button" class="chip" data-filter="management" aria-pressed="false">Gestão</button>
          <button type="button" class="chip" data-filter="shifts" aria-pressed="false">Plantões</button>
          <button type="button" class="chip" data-filter="groups" aria-pressed="false">Grupos</button>
        </div>
        <h3 class="section-title">Não lidas</h3>
        <div class="empty-state">
          ${icon('bell')}
          <h3>Tudo em dia</h3>
          <p>Você não tem notificações novas. Avisaremos aqui sobre trocas, cessões e plantões vagos.</p>
        </div>
      </div>
    </dialog>

    <dialog class="modal modal-center" id="modal-gcal" aria-labelledby="modal-gcal-title">
      <div class="dialog-header" style="border:0;justify-content:flex-end">${closeButton}</div>
      <div class="dialog-body">
        <div class="modal-hero">${icon('calendar')}</div>
        <h2 id="modal-gcal-title">Conecte sua Agenda Google</h2>
        <p class="muted" style="margin-top:var(--esp-2)">
          Seus plantões aparecem automaticamente no seu calendário do Google, com lembretes antes de cada um.
        </p>
      </div>
      <div class="dialog-footer">
        <button type="button" class="btn btn-secondary" data-close>Agora não</button>
        <button type="button" class="btn btn-primary" id="gcal-connect">Conectar</button>
      </div>
    </dialog>`;
}

function setupSidebar(app) {
  const toggle = app.querySelector('#sidebar-toggle');
  toggle.addEventListener('click', () => {
    const collapsed = app.classList.toggle('is-collapsed');
    saveCollapsed(collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', toggleLabel(collapsed));
    toggle.title = toggleLabel(collapsed);
  });

  // Celular: menu abre como gaveta pela esquerda
  const openButton = app.querySelector('#menu-open');
  const setMenuOpen = (open) => {
    app.classList.toggle('is-menu-open', open);
    openButton.setAttribute('aria-expanded', String(open));
  };
  openButton.addEventListener('click', () => setMenuOpen(true));
  app.querySelector('#sidebar-backdrop').addEventListener('click', () => setMenuOpen(false));
  app.querySelectorAll('.sidebar [data-open]').forEach((el) => el.addEventListener('click', () => setMenuOpen(false)));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && app.classList.contains('is-menu-open')) {
      setMenuOpen(false);
      openButton.focus();
    }
  });
}

function setupUserMenu(app) {
  const menu = app.querySelector('#user-menu');
  setupMenu(app.querySelector('#avatar-button'), menu);
  menu.querySelector('#logout').addEventListener('click', signOutUser);
}

function setupDialogs() {
  // Qualquer elemento com data-open="id-do-dialog" abre a gaveta/modal
  document.addEventListener('click', (event) => {
    const opener = event.target.closest('[data-open]');
    if (opener) document.getElementById(opener.dataset.open)?.showModal();

    const closer = event.target.closest('[data-close]');
    if (closer) closer.closest('dialog')?.close();
  });

  // Clicar no fundo escurecido fecha
  document.querySelectorAll('dialog.drawer, dialog.modal').forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  });

  document.querySelectorAll('#drawer-notifications .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      chip.setAttribute('aria-pressed', String(chip.getAttribute('aria-pressed') !== 'true'));
    });
  });

  document.getElementById('gcal-connect').addEventListener('click', () => {
    document.getElementById('modal-gcal').close();
    toast('A integração com o Google Agenda chega em uma próxima versão.');
  });
}

// Cartões de membro sem e-mail (criados antes da busca por e-mail) ou com o e-mail
// antigo: atualiza em todos os grupos. Roda uma vez por e-mail, em segundo plano.
function syncCardEmail(user, profile) {
  const key = `escalamed:email-cartoes:${user.uid}`;
  const email = (user.email ?? '').toLowerCase();
  try {
    if (!email || localStorage.getItem(key) === email) return;
  } catch {
    return; // sem armazenamento: tenta de novo em outra visita
  }
  syncMemberCards(user.uid, profile)
    .then(() => {
      try {
        localStorage.setItem(key, email);
      } catch {
        // sem armazenamento
      }
    })
    .catch(() => {});
}

export async function initLayout({ active } = {}) {
  const { user, profile } = await requireAuth();
  const page = document.getElementById('page');
  const collapsed = readCollapsed();

  const app = document.createElement('div');
  app.className = `app${collapsed ? ' is-collapsed' : ''}`;
  app.innerHTML = shellHtml(user, profile, active, collapsed);
  app.querySelector('.app-main').append(page);
  app.querySelector('.app-main').insertAdjacentHTML('beforeend', '<footer class="app-footer app-credits" data-credits></footer>');
  document.body.prepend(app);
  document.body.insertAdjacentHTML('beforeend', dialogsHtml() + personModalHtml());

  setupSidebar(app);
  setupUserMenu(app);
  setupDialogs();

  setupPeopleSearch(app.querySelector('#global-search'), user.uid);
  syncCardEmail(user, profile);

  mountCredits(app);
  document.body.classList.remove('is-booting');
  return { user, profile };
}
