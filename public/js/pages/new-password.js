// Troca obrigatória da senha provisória (gerada pelo gestor do grupo).
import { navigate } from '../firebase.js';
import { requireAuth, nextUrl, signOutUser } from '../auth.js';
import { changePassword, mustChangePassword } from '../auth-api.js';
import { renderIcons } from '../icons.js';
import { mountCredits } from '../version.js';
import { setupPasswordToggles, setupPasswordRules } from '../auth-ui.js';
import { isStrongPassword } from '../validators.js';
import {
  setLoading,
  setFieldError,
  clearFormErrors,
  clearErrorsWhileTyping,
  showFormAlert,
  firebaseErrorMessage,
} from '../ui.js';

renderIcons();
mountCredits();
const { user } = await requireAuth({ profileComplete: false, allowTemporaryPassword: true });

// Sem senha provisória: nada a fazer aqui
if (!(await mustChangePassword(user))) {
  navigate(nextUrl(), { replace: true });
  await new Promise(() => {});
}

const form = document.getElementById('form-new-password');
form.username.value = user.email ?? '';
setupPasswordToggles();
setupPasswordRules(form.password, document.getElementById('np-rules'), document.getElementById('np-meter'));
clearErrorsWhileTyping(form);
document.getElementById('np-logout').addEventListener('click', signOutUser);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFormErrors(form);
  const { current, password, confirm } = form;
  const errors = [];
  if (!current.value) errors.push([current, 'Informe a senha provisória.']);
  if (!isStrongPassword(password.value)) errors.push([password, 'A nova senha não atende aos requisitos acima.']);
  else if (password.value === current.value) errors.push([password, 'A nova senha precisa ser diferente da provisória.']);
  if (confirm.value !== password.value) errors.push([confirm, 'As senhas não conferem.']);
  if (errors.length) {
    errors.forEach(([input, message]) => setFieldError(input, message));
    errors[0][0].focus();
    return;
  }

  const button = form.querySelector('[type=submit]');
  setLoading(button, true);
  try {
    await changePassword(current.value, password.value);
    navigate(nextUrl(), { replace: true });
  } catch (error) {
    showFormAlert(form, firebaseErrorMessage(error));
    setLoading(button, false);
  }
});
