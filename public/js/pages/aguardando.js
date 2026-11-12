// Tela de espera: quem pediu Gestor, Coordenador de escala ou Administrativo fica aqui (sem
// entrar na plataforma) até um Gestor ou o administrador aprovar o cargo. A aprovação chega
// em tempo real (access/{uid}) e a pessoa segue para a página que tinha aberto.
import { doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db, navigate } from '../firebase.js';
import { requireAuth, nextUrl, signOutUser } from '../auth.js';
import { loadMyAccess, myApprovalState, isBarred } from '../access.js';
import { categoryName } from '/data/categories.js';
import { renderIcons } from '../icons.js';
import { mountCredits } from '../version.js';
import { escapeHtml } from '../ui.js';

renderIcons();
mountCredits();
const { user, profile } = await requireAuth();
const $ = (id) => document.getElementById(id);
$('pending-logout').addEventListener('click', signOutUser);

let access = await loadMyAccess(user.uid);
let leaving = false;

const TEXT = {
  pending: {
    title: 'Aguardando aprovação',
    text: (role) =>
      `Seu cadastro como <strong>${role}</strong> precisa ser aprovado por um Gestor ou pelo administrador da plataforma. Assim que for aprovado, você entra automaticamente.`,
  },
  declined: {
    title: 'Cargo não aprovado',
    text: (role) =>
      `Seu pedido para o cargo de <strong>${role}</strong> não foi aprovado. Fale com um Gestor ou com o administrador da plataforma.`,
  },
};

// Liberado (aprovado, cargo sem aprovação, administrador): segue para a página pedida
function enterIfAllowed() {
  if (leaving || isBarred(profile, access)) return false;
  leaving = true;
  navigate(nextUrl(), { replace: true });
  return true;
}

function paint() {
  const state = myApprovalState(profile, access) === 'declined' ? 'declined' : 'pending';
  const { title, text } = TEXT[state];
  $('pending-title').textContent = title;
  $('pending-text').innerHTML = text(escapeHtml(categoryName(profile.categoryId)));
  $('pending-note').hidden = state === 'declined';
  $('pending-icon').dataset.state = state;
  document.title = `${title} | EscalaMed`;
}

if (!enterIfAllowed()) {
  paint();

  // O documento access/{uid} muda quando um Gestor ou o administrador decide
  onSnapshot(
    doc(db, 'access', user.uid),
    async () => {
      if (leaving) return;
      access = await loadMyAccess(user.uid);
      if (!enterIfAllowed()) paint();
    },
    () => {}, // sem conexão ou saindo da conta: ao entrar de novo, a conferência se repete
  );
}
