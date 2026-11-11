// Configurações: uma seção por vez no painel, escolhida pelos subitens de "Configurações"
// no menu lateral. A troca é sem recarregar a página e fica no endereço (#conta,
// #profissional, #perfil, #senha, #usuarios), para dar link direto
// e o botão Voltar funcionar. Cada seção fica em js/settings/<hash>.js e é montada na
// primeira vez que aparece; a lista (títulos e ícones) fica em js/settings/menu.js.
import { doc, getDoc, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { auth, db } from '../firebase.js';
import { initLayout, refreshAccountButton, setActiveSettingsSection } from '../layout.js';
import { toast } from '../ui.js';
import { SETTINGS_SECTIONS, DEFAULT_SECTION } from '../settings/menu.js';
import { loadMyAccess } from '../access.js';
import { canApprove } from '../permissions.js';
import conta from '../settings/conta.js';
import profissional from '../settings/profissional.js';
import perfil from '../settings/perfil.js';
import senha from '../settings/senha.js';
import usuarios from '../settings/usuarios.js';
import banco from '../settings/banco.js';

const MODULES = Object.fromEntries([conta, profissional, perfil, senha, usuarios, banco].map((m) => [m.hash, m]));
const initialHash = location.hash; // "#usuarios" e "#banco" só valem depois de confirmar o cargo

// Sem login, initLayout manda para a tela de entrada
const { user, profile, access } = await initLayout({ active: 'settings', search: false });
const $ = (id) => document.getElementById(id);
const panels = $('settings-sections');
const title = $('settings-section-title');

// Dados pessoais (telefone, estado, CPF): lidos uma vez e compartilhados entre as seções
const privateRef = doc(db, 'users', user.uid, 'private', 'data');
let privateData = {};
try {
  privateData = (await getDoc(privateRef)).data() ?? {};
} catch {
  toast('Não foi possível carregar seus dados pessoais. Recarregue a página para tentar de novo.', 'error', 6000);
}

let current = null; // hash da seção aberta
const ctx = {
  user,
  profile,
  privateData,
  privateRef,
  userRef: doc(db, 'users', user.uid),
  currentEmail: () => auth.currentUser?.email ?? user.email,
  // Nome, foto ou e-mail mudou: atualiza a pílula da conta no topo
  changed: refreshAccountButton,
  // Cargo aprovado de quem está logado ({ isAdmin, access, role }); atualizado abaixo
  access,
  // Título do painel (ex.: "Criar senha" para quem entra só pelo Google)
  setTitle(text) {
    if (current === senha.hash) title.textContent = text;
  },
};

// Cópia do e-mail nos dados pessoais desatualizada: corrige
if (privateData.email && privateData.email !== ctx.currentEmail()) {
  updateDoc(privateRef, { email: ctx.currentEmail(), updatedAt: serverTimestamp() }).catch(() => {});
}

// Usuários: administrador da plataforma ou Gestor aprovado
const isApprover = (value) => Boolean(value?.isAdmin || canApprove(value?.role));
let approver = isApprover(access);
// Apagar dados: só Dev
let dev = Boolean(access?.isDev);
const visible = () => SETTINGS_SECTIONS.filter((s) => (!s.approverOnly || approver) && (!s.devOnly || dev));
const mounted = new Map(); // hash → { el, onShow }

function show(section) {
  const module = MODULES[section.hash];
  if (!mounted.has(section.hash)) {
    const el = document.createElement('div');
    el.className = 'settings-section';
    el.dataset.section = section.hash;
    panels.append(el);
    mounted.set(section.hash, { el, ...(module.render(el, ctx) ?? {}) });
  }
  current = section.hash;
  mounted.forEach(({ el }, hash) => (el.hidden = hash !== section.hash));
  title.textContent = section.title;
  document.title = `${section.title} | EscalaMed`;
  setActiveSettingsSection(section.hash);
  mounted.get(section.hash).onShow?.();
}

function route() {
  const section = visible().find((s) => `#${s.hash}` === location.hash);
  if (section) {
    if (section.hash !== current) show(section);
    return;
  }
  // Endereço sem seção (ou com uma que a pessoa não pode ver): vai para a padrão
  history.replaceState(null, '', `#${DEFAULT_SECTION}`);
  if (current !== DEFAULT_SECTION) show(SETTINGS_SECTIONS.find((s) => s.hash === DEFAULT_SECTION));
}

// Os subitens do menu lateral mudam o hash (entra no histórico); o hashchange mostra a seção
window.addEventListener('hashchange', route);
route();

// Confere o cargo no servidor (o da sessão pode estar velho): libera ou esconde "Usuários"
loadMyAccess(user.uid).then((value) => {
  ctx.access = value;
  const before = `${approver}/${dev}`;
  const openedHidden = !visible().some((s) => `#${s.hash}` === initialHash);
  approver = isApprover(value);
  dev = Boolean(value?.isDev);
  // Abriu direto em #usuarios ou #banco e o cargo só agora foi confirmado: volta para lá
  if (openedHidden && current === DEFAULT_SECTION && visible().some((s) => `#${s.hash}` === initialHash)) {
    history.replaceState(null, '', initialHash);
  }
  if (`${approver}/${dev}` !== before) route();
});
