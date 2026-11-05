// Configurações > Alterar senha (ou "Criar senha", para quem entrou só pelo Google).
// Esqueceu a senha: quem gera uma senha provisória é o administrador da plataforma.
import { auth } from '../firebase.js';
import { changePassword, hasPassword } from '../auth-api.js';
import { setupPasswordToggles, setupPasswordRules } from '../auth-ui.js';
import { isStrongPassword } from '../validators.js';
import { toast, setLoading, clearFormErrors, clearErrorsWhileTyping, showFormAlert } from '../ui.js';
import { showErrors, handleAuthError } from './shared.js';

function formHtml() {
  return `
  <form id="form-password" novalidate>
    <div class="alert form-alert" role="alert" hidden></div>
    <p class="muted" id="password-help">Sua senha deve ter no mínimo 8 caracteres, com letras, números e caracteres especiais.</p>
    <p class="muted" id="password-google-hint" hidden>Você entra com a conta Google. Crie uma senha para entrar também com e-mail ou nome de usuário. Vamos pedir para confirmar pelo Google.</p>
    <input type="email" name="username" autocomplete="username" hidden />
    <div class="form-grid cols-3">
    <div class="field" id="password-current-field">
      <label class="label" for="password-current">Senha atual</label>
      <div class="password-wrap"><input class="input" id="password-current" name="current" type="password" autocomplete="current-password" required /></div>
      <span class="field-error"></span>
    </div>
    <div class="field">
      <label class="label" for="password-new">Nova senha</label>
      <div class="password-wrap"><input class="input" id="password-new" name="password" type="password" autocomplete="new-password" aria-describedby="password-rules" required /></div>
      <div class="strength-meter" id="strength-meter" aria-live="polite"><i></i><i></i><i></i><i></i><span></span></div>
      <ul class="password-rules" id="password-rules" aria-label="Requisitos da senha"></ul>
      <span class="field-error"></span>
    </div>
    <div class="field">
      <label class="label" for="password-confirm">Repita a nova senha</label>
      <div class="password-wrap"><input class="input" id="password-confirm" name="confirm" type="password" autocomplete="new-password" required /></div>
      <span class="field-error"></span>
    </div>
    </div>
    <p class="password-forgot" id="password-forgot">Esqueceu sua senha? <button type="button" class="btn-link" id="password-recover">Recuperar</button></p>
    <button type="submit" class="btn btn-primary btn-block">Alterar senha</button>
  </form>`;
}

export default {
  hash: 'senha',

  render(container, ctx) {
    container.innerHTML = formHtml();
    const form = container.querySelector('#form-password');
    const submit = form.querySelector('[type=submit]');
    setupPasswordToggles(container);
    setupPasswordRules(form.password, container.querySelector('#password-rules'), container.querySelector('#strength-meter'));
    clearErrorsWhileTyping(form);

    // Conta só com Google: a seção vira "Criar senha", sem a senha atual
    function renderMode() {
      const google = !hasPassword();
      container.querySelector('#password-google-hint').hidden = !google;
      container.querySelector('#password-current-field').hidden = google;
      container.querySelector('#password-forgot').hidden = google;
      submit.textContent = google ? 'Criar senha' : 'Alterar senha';
      ctx.setTitle(google ? 'Criar senha' : 'Alterar senha');
      form.username.value = ctx.currentEmail();
    }
    renderMode();

    // Sem e-mail de redefinição: a senha provisória sai do administrador (regra desde a 1.0.19)
    container.querySelector('#password-recover').addEventListener('click', () => {
      showFormAlert(
        form,
        'Peça uma senha provisória ao administrador do EscalaMed. Depois de entrar com ela, você cria uma senha nova.',
        'warning',
      );
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearFormErrors(form);
      const { current, password, confirm } = form;
      const google = !hasPassword();
      const errors = [];
      if (!google && !current.value) errors.push([current, 'Informe a senha atual.']);
      if (!isStrongPassword(password.value)) errors.push([password, 'A nova senha não atende aos requisitos acima.']);
      else if (password.value === current.value) errors.push([password, 'A nova senha precisa ser diferente da atual.']);
      if (confirm.value !== password.value) errors.push([confirm, 'As senhas não conferem.']);
      if (showErrors(errors)) return;

      setLoading(submit, true);
      try {
        // Reautentica com a senha atual (ou pelo Google) e troca a senha
        await changePassword(current.value, password.value);
        form.reset();
        password.dispatchEvent(new Event('input'));
        if (google) {
          await auth.currentUser.reload(); // passa a constar o login por senha
          renderMode();
        }
        toast(google ? 'Senha criada. Agora você também entra com e-mail e senha.' : 'Senha alterada.', 'success');
      } catch (error) {
        handleAuthError(form, error, current);
      } finally {
        setLoading(submit, false);
      }
    });

    return { onShow: renderMode };
  },
};
