// Configurações > Informações da conta: nome, e-mail (troca em modal), telefone, estado e CPF.
// Nome fica no perfil (users/{uid}); telefone, estado, CPF e e-mail nos dados pessoais
// (users/{uid}/private/data), que só a própria pessoa lê.
import { updateProfile } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { updateDoc, writeBatch, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db } from '../firebase.js';
import { changeEmail, hasPassword } from '../auth-api.js';
import { setupPasswordToggles } from '../auth-ui.js';
import { STATES } from '/data/states.js';
import {
  isValidEmail,
  isValidName,
  isValidPhone,
  isValidCPF,
  formatPhone,
  formatCPF,
  onlyDigits,
  normalize,
  searchKeywords,
} from '../validators.js';
import { syncMemberCards } from '../members.js';
import { toast, setLoading, clearFormErrors, clearErrorsWhileTyping, showFormAlert, firebaseErrorMessage } from '../ui.js';
import { showErrors, handleAuthError, trackChanges, rowLinkHtml, setRowLink, createDialog } from './shared.js';

function formHtml() {
  return `
  <form id="form-account" novalidate>
    <div class="alert form-alert" role="alert" hidden></div>
    <div class="form-grid cols-2">
    <div class="field">
      <label class="label" for="account-name">Nome completo</label>
      <input class="input" id="account-name" name="name" type="text" autocomplete="name" maxlength="80" required />
      <span class="field-error"></span>
    </div>
    <div class="field">
      <span class="label" id="account-email-label">E-mail</span>
      ${rowLinkHtml({ id: 'account-email', label: 'Alterar e-mail' })}
      <span class="field-hint" id="email-google-hint" hidden>Você entra com a conta Google deste e-mail. Para trocar o e-mail, crie antes uma senha em Alterar senha.</span>
      <span class="field-error"></span>
    </div>
    </div>
    <div class="form-grid cols-3">
      <div class="field">
        <label class="label" for="account-phone">Telefone</label>
        <input class="input" id="account-phone" name="phone" type="tel" inputmode="numeric" autocomplete="tel-national" placeholder="(00) 00000-0000" required />
        <span class="field-error"></span>
      </div>
      <div class="field">
        <label class="label" for="account-state">Estado</label>
        <select class="select" id="account-state" name="state" required>
          <option value="">Selecionar</option>
          ${STATES.map((s) => `<option value="${s.uf}">${s.name}</option>`).join('')}
        </select>
        <span class="field-error"></span>
      </div>
      <div class="field">
        <label class="label" for="account-cpf">CPF <span class="field-hint">(opcional)</span></label>
        <input class="input" id="account-cpf" name="cpf" type="text" inputmode="numeric" placeholder="000.000.000-00" />
        <span class="field-error"></span>
      </div>
    </div>
    <p class="field-hint">Só você vê seu CPF, telefone e e-mail.</p>
    <button type="submit" class="btn btn-primary btn-block">Salvar alterações</button>
  </form>`;
}

const EMAIL_DIALOG = {
  id: 'modal-email',
  formId: 'form-email',
  title: 'Alterar e-mail',
  body: `
    <div class="alert form-alert" role="alert" hidden></div>
    <p class="muted" style="margin-bottom:var(--esp-3)">O novo e-mail passa a valer no login na hora. Confirme com a sua senha atual.</p>
    <input type="email" name="username" autocomplete="username" hidden />
    <div class="field">
      <label class="label" for="email-password">Senha atual</label>
      <div class="password-wrap"><input class="input" id="email-password" name="password" type="password" autocomplete="current-password" required /></div>
      <span class="field-error"></span>
    </div>
    <div class="field">
      <label class="label" for="email-new">Novo e-mail</label>
      <input class="input" id="email-new" name="email" type="email" autocomplete="email" required />
      <span class="field-error"></span>
    </div>`,
  footer: `
    <button type="button" class="btn btn-secondary" data-close>Cancelar</button>
    <button type="submit" class="btn btn-primary">Alterar e-mail</button>`,
};

export default {
  hash: 'conta',

  render(container, ctx) {
    const { user, profile, privateRef } = ctx;
    container.innerHTML = formHtml();
    const form = container.querySelector('#form-account');
    const submit = form.querySelector('[type=submit]');
    const emailButton = container.querySelector('#account-email');
    clearErrorsWhileTyping(form);

    form.phone.addEventListener('input', (e) => (e.target.value = formatPhone(e.target.value)));
    form.cpf.addEventListener('input', (e) => (e.target.value = formatCPF(e.target.value)));

    function fill() {
      form.name.value = profile.name ?? '';
      form.phone.value = formatPhone(ctx.privateData.phone ?? '');
      form.state.value = ctx.privateData.state ?? '';
      form.cpf.value = formatCPF(ctx.privateData.cpf ?? '');
      setRowLink(emailButton, ctx.currentEmail());
    }
    fill();
    const changes = trackChanges(form, submit);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearFormErrors(form);
      const name = form.name.value.trim().replace(/\s+/g, ' ');
      const phone = onlyDigits(form.phone.value);
      const state = form.state.value;
      const cpf = onlyDigits(form.cpf.value);

      const errors = [];
      if (!isValidName(name) || !name.includes(' ')) errors.push([form.name, 'Informe seu nome completo.']);
      if (!isValidPhone(phone)) errors.push([form.phone, 'Informe um telefone com DDD.']);
      if (!state) errors.push([form.state, 'Escolha o estado.']);
      if (cpf && !isValidCPF(cpf)) errors.push([form.cpf, 'CPF inválido.']);
      if (showErrors(errors)) return;

      changes.setBusy(true);
      setLoading(submit, true);
      try {
        const batch = writeBatch(db);
        batch.update(ctx.userRef, { name, nameLower: normalize(name), searchKeywords: searchKeywords(name), updatedAt: serverTimestamp() });
        const personal = { email: ctx.currentEmail(), phone, cpf: cpf || null, state };
        batch.set(privateRef, { ...personal, updatedAt: serverTimestamp() });
        await batch.commit();
        Object.assign(ctx.privateData, personal);
        if (name !== profile.name) {
          profile.name = name;
          updateProfile(user, { displayName: name }).catch(() => {});
          await syncMemberCards(user.uid, profile);
          ctx.changed();
        }
        changes.reset();
        toast('Dados salvos.', 'success');
      } catch (error) {
        showFormAlert(form, firebaseErrorMessage(error));
      } finally {
        setLoading(submit, false);
        changes.setBusy(false);
      }
    });

    // ---------- Alterar e-mail: confere a senha e o serviço de contas troca na hora ----------
    const dialog = createDialog(EMAIL_DIALOG);
    const emailForm = dialog.querySelector('#form-email');
    setupPasswordToggles(dialog);
    clearErrorsWhileTyping(emailForm);

    // Conta só com Google (sem senha): o e-mail não muda por aqui
    function renderPasswordMode() {
      const google = !hasPassword();
      emailButton.disabled = google;
      container.querySelector('#email-google-hint').hidden = !google;
    }
    renderPasswordMode();

    emailButton.addEventListener('click', () => {
      emailForm.reset();
      clearFormErrors(emailForm);
      emailForm.username.value = ctx.currentEmail();
      dialog.showModal();
      emailForm.password.focus();
    });

    emailForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearFormErrors(emailForm);
      const newEmail = emailForm.email.value.trim();
      const errors = [];
      if (!emailForm.password.value) errors.push([emailForm.password, 'Informe sua senha atual.']);
      if (!isValidEmail(newEmail)) errors.push([emailForm.email, 'Informe um e-mail válido.']);
      else if (newEmail.toLowerCase() === ctx.currentEmail().toLowerCase()) errors.push([emailForm.email, 'Este já é o seu e-mail.']);
      if (showErrors(errors)) return;

      const button = emailForm.querySelector('[type=submit]');
      setLoading(button, true);
      try {
        await changeEmail(newEmail, emailForm.password.value);
        await updateDoc(privateRef, { email: ctx.currentEmail(), updatedAt: serverTimestamp() });
        ctx.privateData.email = ctx.currentEmail();
        syncMemberCards(user.uid, profile).catch(() => {}); // e-mail novo nos cartões dos grupos
        setRowLink(emailButton, ctx.currentEmail());
        dialog.close();
        ctx.changed();
        toast(`E-mail alterado para ${ctx.currentEmail()}. Use-o no próximo login.`, 'success', 6000);
      } catch (error) {
        handleAuthError(emailForm, error, emailForm.password);
      } finally {
        setLoading(button, false);
      }
    });

    // Depois de criar uma senha (seção Alterar senha), a troca de e-mail é liberada
    return { onShow: renderPasswordMode };
  },
};
