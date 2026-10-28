// Confirmação do e-mail: reenviar o link, conferir se já confirmou ou trocar de conta.
import { sendEmailVerification } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { navigate } from '../firebase.js';
import { useEmulators } from '../config.js';
import { requireAuth, nextUrl, signOutUser } from '../auth.js';
import { renderIcons } from '../icons.js';
import { setLoading, firebaseErrorMessage } from '../ui.js';

renderIcons();
const { user } = await requireAuth({ verified: false, profileComplete: false });

const $ = (id) => document.getElementById(id);
const alertEl = $('verify-alert');
const resendButton = $('verify-resend');
const COOLDOWN = 60; // segundos entre reenvios

function showAlert(message, type = 'error') {
  alertEl.className = `alert alert-${type} form-alert`;
  alertEl.textContent = message;
  alertEl.hidden = !message;
}

// Já confirmou (ex.: em outra aba)? Segue em frente. Os guards da próxima página
// mandam para o cadastro se ele ainda não terminou.
async function checkVerified() {
  await user.reload();
  if (!user.emailVerified) return false;
  await user.getIdToken(true); // token novo: o banco passa a ver o e-mail como confirmado
  navigate(nextUrl(), { replace: true });
  return true;
}

$('verify-email').textContent = user.email;
$('dev-hint').hidden = !useEmulators;
if (await checkVerified().catch(() => false)) await new Promise(() => {});

$('verify-done').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  setLoading(button, true);
  try {
    if (!(await checkVerified())) {
      showAlert('Ainda não recebemos a confirmação. Clique no link do e-mail e tente de novo.');
      setLoading(button, false);
    }
  } catch (error) {
    showAlert(firebaseErrorMessage(error));
    setLoading(button, false);
  }
});

function startCooldown(seconds = COOLDOWN) {
  resendButton.disabled = true;
  let left = seconds;
  const tick = () => {
    resendButton.textContent = `Reenviar e-mail (${left}s)`;
    if (left-- <= 0) {
      clearInterval(timer);
      resendButton.disabled = false;
      resendButton.textContent = 'Reenviar e-mail';
    }
  };
  const timer = setInterval(tick, 1000);
  tick();
}

resendButton.addEventListener('click', async () => {
  resendButton.disabled = true;
  try {
    await sendEmailVerification(user);
    showAlert(`Enviamos um novo link para ${user.email}.`, 'success');
    startCooldown();
  } catch (error) {
    showAlert(firebaseErrorMessage(error));
    // Excesso de tentativas: espera o tempo cheio antes de liberar
    startCooldown(error.code === 'auth/too-many-requests' ? COOLDOWN : 5);
  }
});

$('verify-other').addEventListener('click', signOutUser);

// O link foi enviado no cadastro: espera um pouco antes de liberar o reenvio
startCooldown(30);

// Volta para esta aba depois de clicar no link: confere sozinho
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkVerified().catch(() => {});
});
