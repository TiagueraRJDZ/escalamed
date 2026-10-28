// Tela de Escalas: lista de grupos do usuário, menu "+", calendário e disponíveis.
import {
  collection,
  query,
  where,
  onSnapshot,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db, isLeaving } from '../firebase.js';
import { initLayout } from '../layout.js';
import { icon, renderIcons } from '../icons.js';
import { createCalendar } from '../calendar.js';
import { escapeHtml, initials, setupMenu, toast, setLoading, firebaseErrorMessage } from '../ui.js';
import { normalize } from '../validators.js';
import { ROLES, ROLE_ORDER, roleOf } from '../permissions.js';
import { myInvites, acceptInvite, cancelInvite, inviteKey } from '../members.js';

renderIcons();
const { user, profile } = await initLayout({ active: 'schedules' });

const listEl = document.getElementById('group-list');
const searchInput = document.getElementById('group-search');
let groups = [];
let loaded = false;

setupMenu(document.getElementById('new-button'), document.getElementById('new-menu'));
createCalendar(document.getElementById('calendar'));

// Aviso depois de concluir o wizard
const params = new URLSearchParams(location.search);
if (params.has('created')) {
  toast('Grupo criado com sucesso!', 'success');
  history.replaceState(null, '', location.pathname);
}

// ---------- Lista ----------
function skeleton() {
  const row = `<li class="group-skeleton" aria-hidden="true">
      <span class="skeleton"></span>
      <div><span class="skeleton" style="height:14px;width:55%"></span><span class="skeleton" style="height:12px;width:35%"></span></div>
    </li>`;
  return row.repeat(4);
}

function groupSubtitle(group) {
  if (group.type === 'personal') return 'Escala individual';
  if (!group.unit) return 'Sem unidade definida';
  return `${group.unit.name} · ${group.unit.city}/${group.unit.state}`;
}

function groupItem(group) {
  const pending = group.setupStep !== 'done';
  const href = pending ? `/group-new.html?id=${group.id}` : `/group.html?id=${group.id}`;
  const badges = pending ? '<span class="badge badge-warning">Configuração pendente</span>' : '';

  return `<li>
    <a class="group-item" href="${href}">
      <span class="group-avatar" style="background:${escapeHtml(group.color)}" aria-hidden="true">${escapeHtml(initials(group.name))}</span>
      <span class="group-info">
        <strong>${escapeHtml(group.name)}</strong>
        <span>${escapeHtml(groupSubtitle(group))}</span>
      </span>
      <span class="group-badges">${badges}</span>
      ${icon('chevronRight')}
    </a>
  </li>`;
}

// Seções pelo cargo do usuário em cada grupo (GESTOR, AUXILIAR...); escalas individuais por último
const SECTION_TITLES = {
  manager: 'Gestor',
  assistant: 'Auxiliar',
  analyst: 'Analista',
  observer: 'Observador',
  staff: 'Plantonista',
  personal: 'Escalas individuais',
};

function sectionsHtml(list) {
  const keyOf = (g) => (g.type === 'personal' ? 'personal' : roleOf(g, user.uid) ?? 'staff');
  return [...ROLE_ORDER, 'personal']
    .map((key) => {
      const items = list.filter((g) => keyOf(g) === key);
      if (!items.length) return '';
      return `<li class="group-section"><h2>${SECTION_TITLES[key]}</h2></li>${items.map(groupItem).join('')}`;
    })
    .join('');
}

function emptyState() {
  return `<li class="empty-state">
    ${icon('users')}
    <h3>Você ainda não participa de nenhum grupo</h3>
    <p>Crie um grupo para montar a escala da sua equipe ou uma escala individual para organizar seus plantões.</p>
    <div class="empty-actions">
      <a class="btn btn-primary" href="/group-new.html?type=team">${icon('plus')}Criar novo grupo</a>
      <a class="btn btn-secondary" href="/group-new.html?type=personal">Criar escala individual</a>
    </div>
  </li>`;
}

function render() {
  if (!loaded) {
    listEl.innerHTML = skeleton();
    return;
  }
  listEl.setAttribute('aria-busy', 'false');
  if (!groups.length) {
    listEl.innerHTML = emptyState();
    return;
  }

  const term = normalize(searchInput.value);
  const filtered = term
    ? groups.filter((g) => normalize(`${g.name} ${g.unit?.name ?? ''} ${g.unit?.city ?? ''}`).includes(term))
    : groups;

  listEl.innerHTML = filtered.length
    ? sectionsHtml(filtered)
    : `<li class="empty-state">${icon('search')}<h3>Nenhum grupo encontrado</h3>
        <p>Nenhum grupo corresponde a "${escapeHtml(searchInput.value.trim())}".</p></li>`;
}

searchInput.addEventListener('input', render);
render();

// Grupos em que o usuário é membro, atualizados em tempo real
const groupsQuery = query(collection(db, 'groups'), where('memberIds', 'array-contains', user.uid));
onSnapshot(
  groupsQuery,
  (snapshot) => {
    groups = snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    loaded = true;
    render();
  },
  (error) => {
    if (isLeaving()) return; // trocando de página: não é erro de verdade
    console.error(error);
    listEl.setAttribute('aria-busy', 'false');
    listEl.innerHTML = `<li class="empty-state">${icon('x')}<h3>Não foi possível carregar seus grupos</h3>
      <p>Verifique sua conexão e tente novamente.</p>
      <div class="empty-actions"><button type="button" class="btn btn-secondary" onclick="location.reload()">Tentar de novo</button></div></li>`;
  },
);

// ---------- Convites pendentes (para o e-mail de quem está logado) ----------
const invitesEl = document.getElementById('my-invites');
let pendingInvites = [];

function renderInvites() {
  invitesEl.hidden = !pendingInvites.length;
  invitesEl.innerHTML = pendingInvites
    .map(
      (invite, i) => `<div class="invite-card">
        <span class="group-avatar" style="background:var(--cor-primaria)" aria-hidden="true">${icon('mail')}</span>
        <div class="group-info" style="flex:1;min-width:200px">
          <strong>Convite para ${escapeHtml(invite.groupName)}</strong>
          <span>${escapeHtml(invite.invitedByName)} convidou você como ${ROLES[invite.role]}${
            invite.unitName ? ` · ${escapeHtml(invite.unitName)}` : ''
          }</span>
        </div>
        <div class="empty-actions" style="margin:0">
          <button type="button" class="btn btn-secondary" data-decline="${i}">Recusar</button>
          <button type="button" class="btn btn-primary" data-accept="${i}">Aceitar</button>
        </div>
      </div>`,
    )
    .join('');
}

invitesEl.addEventListener('click', async (event) => {
  const accept = event.target.closest('[data-accept]');
  const decline = event.target.closest('[data-decline]');
  const button = accept ?? decline;
  if (!button) return;
  const invite = pendingInvites[Number(button.dataset.accept ?? button.dataset.decline)];
  setLoading(button, true);
  try {
    if (accept) {
      await acceptInvite(invite.groupId, invite, user, profile);
      toast(`Você entrou no grupo ${invite.groupName}.`, 'success');
    } else {
      await cancelInvite(invite.groupId, inviteKey(invite));
      toast('Convite recusado.');
    }
    pendingInvites = pendingInvites.filter((i) => i !== invite);
    renderInvites();
  } catch (error) {
    setLoading(button, false);
    toast(
      accept && error.code === 'permission-denied'
        ? 'Não foi possível entrar: o cargo do convite pode ter atingido o limite. Peça um novo convite.'
        : firebaseErrorMessage(error),
      'error',
    );
  }
});

myInvites(user)
  .then((list) => {
    pendingInvites = list;
    renderInvites();
  })
  .catch((error) => console.error(error));
