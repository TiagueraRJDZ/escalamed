// Monta o layout das páginas internas: menu lateral, barra superior,
// menu da conta, gaveta de Notificações e modal do Google Agenda.
// Uso na página:  const { user } = await initLayout({ active: 'schedules' });
import { collection, doc, getDoc, getDocs, getDocsFromCache, query, where } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { auth, db } from './firebase.js';
import { requireAuth, signOutUser, readSessionSummary, saveSessionSummary as saveSummary } from './auth.js';
import { categoryName } from '/data/categories.js';
import { icon } from './icons.js';
import { escapeHtml, initials, toast, setupMenu } from './ui.js';
import { mountCredits } from './version.js';
import { setupPeopleSearch, personModalHtml } from './people-search.js';
import { syncMemberCards } from './members.js';
import { SETTINGS_SECTIONS, DEFAULT_SECTION } from './settings/menu.js';
import { whenActivated } from './prerender.js';
import { setupNotifications } from './notifications.js';

const NAV = [
  { id: 'schedules', label: 'Escalas', icon: 'calendar', href: '/schedules.html' },
  // Relatórios: só para quem é gestor de pelo menos um grupo (ver showManagerItems)
  { id: 'reports', label: 'Relatórios', icon: 'fileText', href: '/relatorios.html', managerOnly: true },
  { id: 'history', label: 'Histórico', icon: 'clock', href: '/historico.html' },
  // Abre e fecha; as seções das Configurações ficam como subitens
  { id: 'settings', label: 'Configurações', icon: 'settings', href: '/settings.html', children: SETTINGS_SECTIONS },
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

// Item com subitens (Configurações): clicar abre e fecha a lista. Começa aberto na
// própria página. Com o menu recolhido (só ícones), o clique leva direto para a página.
function navGroup(item, active, { admin }) {
  const open = isCurrent(item, active);
  const subitems = item.children
    .map(
      (child) => `<li${child.adminOnly && !admin ? ' hidden' : ''} data-admin-only="${Boolean(child.adminOnly)}">
        <a class="nav-subitem" href="${item.href}#${child.hash}" data-hash="${child.hash}" title="${child.title}">
          ${icon(child.icon)}<span>${child.title}</span>
        </a></li>`,
    )
    .join('');
  return `<li class="nav-group">
    <button type="button" class="nav-item nav-parent${open ? ' is-active' : ''}" data-href="${item.href}"
      aria-expanded="${open}" aria-controls="nav-sub-${item.id}" title="${item.label}">
      ${icon(item.icon)}<span class="nav-label">${item.label}</span>${icon('chevronDown', 'nav-chevron')}
    </button>
    <ul class="nav-sub" id="nav-sub-${item.id}"${open ? '' : ' hidden'}>${subitems}</ul>
  </li>`;
}

// Item ativo: o da página aberta (pelo endereço) ou o que a página informar
// (ex.: a tela do grupo marca "Escalas")
const isCurrent = (item, active) => item.id === active || item.href === location.pathname;

function navItem(item, active, options) {
  if (item.children) return navGroup(item, active, options);
  const badge = item.badge ? `<span class="badge badge-new">${item.badge}</span>` : '';
  const content = `${icon(item.icon)}<span class="nav-label">${item.label}</span>${badge}`;
  const common = `class="nav-item" title="${item.label}" aria-label="${item.label}"`;
  if (item.href) {
    const current = isCurrent(item, active) ? ' aria-current="page"' : '';
    const hidden = item.managerOnly && !options.manager ? ' hidden' : '';
    return `<li${hidden}${item.managerOnly ? ' data-manager-only' : ''}><a ${common} href="${item.href}"${current}>${content}</a></li>`;
  }
  return `<li><button type="button" ${common} data-open="${item.drawer}" aria-haspopup="dialog">${content}</button></li>`;
}

export function avatarHtml({ name, photoURL } = {}, className = 'avatar') {
  return photoURL
    ? `<span class="${className}"><img src="${escapeHtml(photoURL)}" alt="" referrerpolicy="no-referrer" /></span>`
    : `<span class="${className}">${escapeHtml(initials(name))}</span>`;
}

const toggleLabel = (collapsed) => (collapsed ? 'Expandir menu' : 'Recolher menu');

// "Tiago da Silva Martins" → "Tiago Martins" (cabe na pílula da conta)
function shortName(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Minha conta';
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]}` : parts[0];
}

// ---------- Cargo embaixo do nome: "Administrador" ou a profissão ----------
// Administrador da plataforma = uid em config/admins. A resposta fica guardada na
// sessão, para o cargo não piscar a cada troca de página.
const ADMIN_LABEL = 'Administrador';
const adminKey = (uid) => `escalamed:admin:${uid}`;

function cachedAdmin(uid) {
  try {
    return sessionStorage.getItem(adminKey(uid)) === '1';
  } catch {
    return false;
  }
}

// ---------- Gestor de algum grupo? (mostra "Relatórios") ----------
// Guardado na sessão; a tela de Escalas atualiza ao carregar os grupos.
const managerKey = (uid) => `escalamed:gestor:${uid}`;

function cachedManager(uid) {
  try {
    return sessionStorage.getItem(managerKey(uid));
  } catch {
    return null;
  }
}

// groups: grupos da pessoa (com managerIds). Atualiza o menu e a sessão.
export function setManagerFromGroups(uid, groups) {
  const manager = groups.some((g) => g.managerIds?.includes(uid));
  try {
    sessionStorage.setItem(managerKey(uid), manager ? '1' : '0');
  } catch {
    // sem armazenamento: só consulta de novo na próxima página
  }
  document.querySelectorAll('[data-manager-only]').forEach((li) => (li.hidden = !manager));
}

// Sem resposta guardada: consulta os grupos (pela lista de membros, que é o que as regras permitem)
async function showManagerItems(uid) {
  if (cachedManager(uid) !== null) return;
  const mine = query(collection(db, 'groups'), where('memberIds', 'array-contains', uid));
  // Primeiro o cache local (na hora), depois o servidor
  const cached = await getDocsFromCache(mine).catch(() => null);
  if (cached && !cached.empty) setManagerFromGroups(uid, cached.docs.map((d) => d.data()));
  const snapshot = await getDocs(mine).catch(() => null);
  if (snapshot) setManagerFromGroups(uid, snapshot.docs.map((d) => d.data()));
}

async function showAdminRole(app, uid, profile) {
  const snapshot = await getDoc(doc(db, 'config', 'admins')).catch(() => null);
  if (!snapshot) return; // sem resposta: mantém o que já está na tela
  const isAdmin = (snapshot.data()?.uids ?? []).includes(uid);
  try {
    sessionStorage.setItem(adminKey(uid), isAdmin ? '1' : '0');
  } catch {
    // sem armazenamento: só pergunta de novo na próxima página
  }
  app.querySelector('#account-role').textContent = isAdmin ? ADMIN_LABEL : categoryName(profile.categoryId);
  // Subitens só de administrador (Configurações > Usuários)
  app.querySelectorAll('.nav-sub [data-admin-only="true"]').forEach((li) => (li.hidden = !isAdmin));
}

// Marca no menu lateral a seção das Configurações aberta (chamado pela página)
export function setActiveSettingsSection(hash = DEFAULT_SECTION) {
  document.querySelectorAll('.nav-subitem').forEach((a) => {
    if (a.dataset.hash === hash) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

// Busca de pessoas no topo (fica de fora em páginas como Configurações)
const searchHtml = () => `
        <form class="topbar-search input-icon" role="search" id="global-search">
          ${icon('search')}
          <label class="sr-only" for="global-search-input">Buscar pessoas</label>
          <input class="input" id="global-search-input" type="search" placeholder="Quem gostaria de encontrar?" autocomplete="off" />
        </form>`;

function shellHtml(user, profile, active, collapsed, search) {
  return `
    <aside class="sidebar" id="sidebar" aria-label="Menu principal">
      <a class="sidebar-brand" href="/schedules.html">
        <img class="sidebar-brand-full" src="/assets/img/escalamed-hapvida-lado-a-lado.png" alt="EscalaMed - Hapvida" />
        <img class="sidebar-brand-icon" src="/img/escalamed-icon.svg" alt="EscalaMed" width="32" height="32" />
        <span class="sidebar-brand-divider" aria-hidden="true"></span>
        <img class="sidebar-brand-hapvida" src="/img/hapvida-flor.svg" alt="Hapvida" width="26" height="26" />
      </a>
      <nav aria-label="Navegação principal">
        <ul class="nav">${NAV.map((item) => navItem(item, active, { admin: cachedAdmin(user.uid), manager: cachedManager(user.uid) === '1' })).join('')}</ul>
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
${search ? searchHtml() : ''}

        <div class="topbar-actions">
          <button type="button" class="btn-icon gcal-button" data-open="modal-gcal" aria-haspopup="dialog" aria-label="Conectar Google Agenda" title="Google Agenda">
            ${icon('calendar', 'gcal-icon')}
          </button>
          <button type="button" class="btn-icon" id="notifications-button" data-open="drawer-notifications" aria-haspopup="dialog" aria-label="Notificações" title="Notificações">
            ${icon('bell')}
          </button>
          <div class="menu-anchor">
            <!-- Pílula da conta: foto, nome, cargo e setinha (no celular, só a foto) -->
            <button type="button" class="account-button" id="avatar-button" aria-haspopup="menu" aria-expanded="false" aria-controls="user-menu" aria-label="Menu da conta">
              ${avatarHtml(profile, 'avatar account-avatar')}
              <span class="account-text">
                <strong>${escapeHtml(shortName(profile.name))}</strong>
                <small id="account-role">${escapeHtml(cachedAdmin(user.uid) ? ADMIN_LABEL : categoryName(profile.categoryId))}</small>
              </span>
              ${icon('chevronDown', 'account-chevron')}
            </button>
            <div class="menu account-menu" id="user-menu" role="menu" aria-label="Conta" hidden>
              <div class="menu-header">
                <span id="account-menu-email">${escapeHtml(user.email || '')}</span>
              </div>
              <a class="menu-item" role="menuitem" href="/settings.html#conta">${icon('user')}Minha conta</a>
              <a class="menu-item" role="menuitem" href="/settings.html#perfil">${icon('edit')}Editar perfil</a>
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
        <!-- Convites e demais avisos, em tempo real (notifications.js) -->
        <div id="notifications-list" aria-live="polite"></div>
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
  // Subitem na mesma página (ex.: outra seção das Configurações): fecha a gaveta
  app.querySelectorAll('.nav-subitem').forEach((el) => el.addEventListener('click', () => setMenuOpen(false)));

  // Item com subitens: abre e fecha a lista. Com o menu recolhido no computador
  // (só ícones, sem espaço para os subitens), leva direto para a página.
  const mobile = window.matchMedia('(max-width: 899px)');
  app.querySelectorAll('.nav-parent').forEach((parent) => {
    parent.addEventListener('click', () => {
      if (app.classList.contains('is-collapsed') && !mobile.matches) {
        location.href = parent.dataset.href;
        return;
      }
      const open = parent.getAttribute('aria-expanded') !== 'true';
      parent.setAttribute('aria-expanded', String(open));
      document.getElementById(parent.getAttribute('aria-controls')).hidden = !open;
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && app.classList.contains('is-menu-open')) {
      setMenuOpen(false);
      openButton.focus();
    }
  });
}

// Pílula e menu da conta com o nome, a foto e o e-mail atuais. As Configurações chamam
// depois de salvar nome, foto, profissão ou e-mail (atualiza sem recarregar a página).
let shell = null;

function paintAccount({ app, user, profile }) {
  app.querySelector('.account-avatar').outerHTML = avatarHtml(profile, 'avatar account-avatar');
  app.querySelector('.account-text strong').textContent = shortName(profile.name);
  app.querySelector('#account-menu-email').textContent = auth.currentUser?.email ?? user.email ?? '';
}

export function refreshAccountButton() {
  if (!shell) return;
  paintAccount(shell);
  saveSummary(shell.user, shell.profile);
  showAdminRole(shell.app, shell.user.uid, shell.profile);
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

// Desenha menu lateral, barra do topo e modais. Enquanto a página não carrega, um
// esqueleto ocupa o lugar do conteúdo.
function mountShell(user, profile, active, search) {
  const page = document.getElementById('page');
  const collapsed = readCollapsed();

  const app = document.createElement('div');
  app.className = `app${collapsed ? ' is-collapsed' : ''}`;
  app.innerHTML = shellHtml(user, profile, active, collapsed, search);
  app.querySelector('.app-main').append(page);
  // Página sem busca: o título dela (data-topbar-title) fica na faixa branca do topo
  const topbarTitle = !search && page.querySelector('[data-topbar-title]');
  if (topbarTitle) app.querySelector('#menu-open').after(topbarTitle);
  page.insertAdjacentHTML('beforebegin', PAGE_SKELETON);
  app.querySelector('.app-main').insertAdjacentHTML('beforeend', '<footer class="app-footer app-credits" data-credits></footer>');
  document.body.prepend(app);
  document.body.insertAdjacentHTML('beforeend', dialogsHtml() + personModalHtml());
  document.body.classList.add('has-shell');

  setupSidebar(app);
  setupUserMenu(app);
  setupDialogs();
  return app;
}

// Esqueleto leve no lugar do conteúdo (some quando a página fica pronta)
const PAGE_SKELETON = `<div class="page-skeleton" aria-hidden="true">
  <div class="card"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div>
</div>`;

export async function initLayout({ active, search = true } = {}) {
  // Com o resumo da sessão, o layout aparece na hora; o login é conferido em seguida
  const cached = readSessionSummary();
  let app = cached ? mountShell(cached, cached.profile, active, search) : null;

  // Página pré-carregada: para aqui até a pessoa abrir. Assim login, leituras,
  // gravações e avisos da página só acontecem quando ela está de fato na tela.
  await whenActivated();

  const { user, profile } = await requireAuth();
  if (app && cached.uid !== user.uid) {
    // Outra conta entrou nesta aba: recarrega para montar tudo com a conta certa
    location.reload();
    return new Promise(() => {});
  }
  if (!app) app = mountShell(user, profile, active, search);
  shell = { app, user, profile };
  if (cached) paintAccount(shell); // nome ou foto podem ter mudado em outra aba
  // Perfil do servidor chegou depois do cache (ver requireAuth): atualiza a pílula
  window.addEventListener('escalamed:perfil', () => paintAccount(shell));

  if (search) setupPeopleSearch(app.querySelector('#global-search'), user.uid);
  syncCardEmail(user, profile);
  showAdminRole(app, user.uid, profile);
  showManagerItems(user.uid);
  setupNotifications(app, user, profile);

  mountCredits(app);
  app.querySelector('.page-skeleton')?.remove();
  document.body.classList.remove('is-booting');
  return { user, profile };
}
