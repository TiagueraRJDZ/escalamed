// Monta o layout das páginas internas: menu lateral, barra superior,
// menu da conta, gavetas (Privacidade, Ajuda, Notificações) e modal do Google Agenda.
// Uso na página:  const { user } = await initLayout({ active: 'schedules' });
import { requireAuth, signOutUser } from './auth.js';
import { icon } from './icons.js';
import { escapeHtml, initials, toast, setupMenu } from './ui.js';

const NAV = [
  { id: 'schedules', label: 'Escalas', icon: 'calendar', href: '/schedules.html' },
  { id: 'checkin', label: 'Painel de check-in/out', icon: 'checkCircle', href: '/checkin.html', badge: 'NOVO!' },
  { id: 'ads', label: 'Anúncios', icon: 'megaphone', href: '/ads.html' },
  { id: 'privacy', label: 'Privacidade', icon: 'lock', drawer: 'drawer-privacy' },
  { id: 'help', label: 'Ajuda', icon: 'help', drawer: 'drawer-help' },
  { id: 'settings', label: 'Configurações', icon: 'settings', href: '/settings.html' },
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

function avatarHtml(user) {
  const name = user.displayName || user.email || '';
  return user.photoURL
    ? `<span class="avatar"><img src="${escapeHtml(user.photoURL)}" alt="" referrerpolicy="no-referrer" /></span>`
    : `<span class="avatar">${escapeHtml(initials(name))}</span>`;
}

function shellHtml(user, active, collapsed) {
  return `
    <aside class="sidebar" id="sidebar" aria-label="Menu principal">
      <a class="sidebar-brand" href="/schedules.html"><img src="/img/logo.svg" alt="" /><span>EscalaMed</span></a>
      <nav aria-label="Navegação principal">
        <ul class="nav">${NAV.map((item) => navItem(item, active)).join('')}</ul>
      </nav>
      <div class="sidebar-footer">
        <button type="button" class="nav-item sidebar-toggle" id="sidebar-toggle" aria-expanded="${!collapsed}" aria-controls="sidebar">
          ${icon('chevronLeft')}<span class="nav-label">${collapsed ? 'Mostrar mais' : 'Mostrar menos'}</span>
        </button>
      </div>
    </aside>
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
              ${avatarHtml(user)}
            </button>
            <div class="menu" id="user-menu" role="menu" aria-label="Conta" hidden>
              <div class="menu-header">
                <strong>${escapeHtml(user.displayName || 'Minha conta')}</strong>
                <span>${escapeHtml(user.email || '')}</span>
              </div>
              <a class="menu-item" role="menuitem" href="/profile.html">${icon('user')}Ver perfil</a>
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
    <dialog class="drawer" id="drawer-privacy" aria-labelledby="drawer-privacy-title">
      <div class="dialog-header"><h2 id="drawer-privacy-title">Privacidade</h2>${closeButton}</div>
      <div class="dialog-body">
        <div class="empty-state">
          ${icon('lock')}
          <h3>Controle quem vê seus dados</h3>
          <p>Em breve você poderá escolher quem vê seu telefone e seu e-mail.</p>
        </div>
      </div>
    </dialog>

    <dialog class="drawer" id="drawer-help" aria-labelledby="drawer-help-title">
      <div class="dialog-header"><h2 id="drawer-help-title">Ajuda</h2>${closeButton}</div>
      <div class="dialog-body">
        <div class="empty-state">
          ${icon('help')}
          <h3>Fale com a gente</h3>
          <p>Em breve você poderá enviar dúvidas, sugestões e pedidos de suporte por aqui.</p>
        </div>
      </div>
    </dialog>

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
    toggle.querySelector('.nav-label').textContent = collapsed ? 'Mostrar mais' : 'Mostrar menos';
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

export async function initLayout({ active } = {}) {
  const user = await requireAuth();
  const page = document.getElementById('page');
  const collapsed = readCollapsed();

  const app = document.createElement('div');
  app.className = `app${collapsed ? ' is-collapsed' : ''}`;
  app.innerHTML = shellHtml(user, active, collapsed);
  app.querySelector('.app-main').append(page);
  document.body.prepend(app);
  document.body.insertAdjacentHTML('beforeend', dialogsHtml());

  setupSidebar(app);
  setupUserMenu(app);
  setupDialogs();

  app.querySelector('#global-search').addEventListener('submit', (event) => {
    event.preventDefault();
    toast('A busca de pessoas chega em uma próxima versão.');
  });

  document.body.classList.remove('is-booting');
  return { user };
}
