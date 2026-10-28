// Link de convite (/invite.html?g=<grupo>). Os guards já garantem login, e-mail
// confirmado e cadastro completo (e trazem a pessoa de volta para cá no fim).
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db, navigate } from '../firebase.js';
import { initLayout } from '../layout.js';
import { icon, renderIcons } from '../icons.js';
import { ROLES } from '../permissions.js';
import { acceptInvite, cancelInvite } from '../members.js';
import { escapeHtml, toast, setLoading, confirmDialog, firebaseErrorMessage } from '../ui.js';
import { signOutUser } from '../auth.js';

renderIcons();
const { user, profile } = await initLayout({ active: 'schedules' });

const content = document.getElementById('invite-content');
const groupId = new URLSearchParams(location.search).get('g');
const email = user.email.toLowerCase();
const groupUrl = `/group.html?id=${encodeURIComponent(groupId ?? '')}`;

function showMessage(iconName, title, text, actions = '') {
  content.innerHTML = `${icon(iconName)}<h1 id="invite-title" style="font-size:var(--texto-xl)">${title}</h1>
    <p>${text}</p><div class="empty-actions">${actions}</div>`;
}

const backButton = '<a class="btn btn-secondary" href="/schedules.html">Ir para minhas escalas</a>';

async function load() {
  if (!groupId) {
    showMessage('x', 'Link inválido', 'Este link de convite está incompleto. Peça um novo link a quem convidou você.', backButton);
    return;
  }

  // Já é membro? (só membros conseguem ler o grupo)
  const groupSnap = await getDoc(doc(db, 'groups', groupId)).catch(() => null);
  if (groupSnap?.exists()) {
    navigate(groupUrl, { replace: true });
    return;
  }

  const inviteSnap = await getDoc(doc(db, 'groups', groupId, 'invites', email)).catch(() => null);
  const invite = inviteSnap?.exists() ? inviteSnap.data() : null;
  if (!invite || invite.expiresAt.toMillis() < Date.now()) {
    showMessage(
      'mail',
      invite ? 'Convite vencido' : 'Convite não encontrado',
      `${invite ? 'Este convite venceu.' : `Não há convite para <strong>${escapeHtml(email)}</strong> neste grupo.`}
       Se você foi convidado(a) com outro e-mail, entre com ele. Se não, peça um novo convite ao gestor do grupo.`,
      `${backButton}<button type="button" class="btn btn-ghost" id="switch-account">Entrar com outro e-mail</button>`,
    );
    document.getElementById('switch-account').addEventListener('click', signOutUser);
    return;
  }

  const unit = invite.unitName ? ` · ${escapeHtml(invite.unitName)}` : '';
  showMessage(
    'users',
    'Você foi convidado(a)!',
    `<strong>${escapeHtml(invite.invitedByName)}</strong> convidou você para o grupo
     <strong>${escapeHtml(invite.groupName)}</strong>${unit}, como <strong>${ROLES[invite.role]}</strong>.`,
    `<button type="button" class="btn btn-secondary" id="decline">Recusar</button>
     <button type="button" class="btn btn-primary" id="accept">${icon('check')}Aceitar convite</button>`,
  );

  document.getElementById('accept').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    setLoading(button, true);
    try {
      await acceptInvite(groupId, invite, user, profile);
      toast(`Bem-vindo(a) ao grupo ${invite.groupName}!`, 'success');
      navigate(groupUrl, { replace: true });
    } catch (error) {
      setLoading(button, false);
      // Cargo cheio desde o convite: as regras recusam a entrada
      toast(
        error.code === 'permission-denied'
          ? 'Não foi possível entrar: o cargo do convite pode ter atingido o limite. Peça um novo convite.'
          : firebaseErrorMessage(error),
        'error',
      );
    }
  });

  document.getElementById('decline').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Recusar convite?',
      message: `Você não vai entrar no grupo ${invite.groupName}.`,
      confirmText: 'Recusar',
      danger: true,
    });
    if (!ok) return;
    try {
      await cancelInvite(groupId, email);
      toast('Convite recusado.');
      navigate('/schedules.html', { replace: true });
    } catch (error) {
      toast(firebaseErrorMessage(error), 'error');
    }
  });
}

load();
