// Modal "Minha conta", aberto pelo menu da conta em qualquer página:
// dados da conta, informações profissionais e foto, em abas à esquerda.
// É carregado só na primeira vez que a pessoa abre o modal (import dinâmico no layout).
import { updateProfile } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { doc, getDoc, updateDoc, writeBatch, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { auth, db } from './firebase.js';
import { changeEmail, changeUsername, hasPassword } from './auth-api.js';
import { avatarHtml } from './layout.js';
import { icon } from './icons.js';
import { setupPasswordToggles } from './auth-ui.js';
import { PROFESSIONAL_CATEGORIES, SPECIALTIES, getCategory } from '/data/categories.js';
import { STATES } from '/data/states.js';
import { isValidEmail, isValidName, isValidPhone, isValidCPF, formatPhone, formatCPF, onlyDigits, normalize, searchKeywords } from './validators.js';
import { syncMemberCards } from './members.js';
import {
  toast,
  setLoading,
  setFieldError,
  clearFormErrors,
  clearErrorsWhileTyping,
  showFormAlert,
  firebaseErrorMessage,
} from './ui.js';

const TABS = [
  { id: 'account', label: 'Dados da conta', icon: 'user' },
  { id: 'professional', label: 'Dados profissionais', icon: 'stethoscope' },
  { id: 'photo', label: 'Foto do perfil', icon: 'camera' },
];

const closeButton = `<button type="button" class="btn-icon" data-close aria-label="Fechar">${icon('x')}</button>`;
const options = (list, value, label) => list.map((item) => `<option value="${item[value]}">${item[label]}</option>`).join('');

function modalHtml() {
  const tabs = TABS.map(
    (t) => `<button type="button" class="account-tab" role="tab" id="account-tab-${t.id}" data-tab="${t.id}"
      aria-controls="account-panel-${t.id}" aria-selected="false" tabindex="-1">${icon(t.icon)}<span>${t.label}</span></button>`,
  ).join('');

  return `
  <dialog class="modal account-modal" id="modal-account" aria-labelledby="modal-account-title">
    <div class="dialog-header">
      <h2 id="modal-account-title">Minha conta</h2>
      ${closeButton}
    </div>
    <div class="account-modal-body">
      <nav class="account-nav">
        <div class="account-identity" id="account-identity"></div>
        <div class="account-tabs" role="tablist" aria-label="Partes da conta" aria-orientation="vertical">${tabs}</div>
      </nav>

      <!-- Dados da conta -->
      <section class="account-panel" role="tabpanel" id="account-panel-account" aria-labelledby="account-tab-account" hidden>
        <form id="form-account" novalidate>
          <div class="account-panel-body">
            <div class="alert form-alert" role="alert" hidden></div>
            <div class="field">
              <label class="label" for="account-name">Nome completo</label>
              <input class="input" id="account-name" name="name" type="text" autocomplete="name" maxlength="80" required />
              <span class="field-error"></span>
            </div>
            <div class="field">
              <label class="label" for="account-email">E-mail de acesso</label>
              <div class="email-row">
                <input class="input" id="account-email" type="email" readonly />
                <button type="button" class="btn btn-secondary" id="change-email">Alterar</button>
              </div>
              <span class="field-hint" id="email-google-hint" hidden>Você entra com a conta Google deste e-mail. Para trocar o e-mail, crie antes uma senha em Configurações.</span>
            </div>
            <div class="field">
              <label class="label" for="account-username">Nome de usuário <span class="field-hint">(opcional)</span></label>
              <input class="input" id="account-username" name="username" type="text" maxlength="30" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="ex.: ana.souza" />
              <span class="field-hint">Para entrar com ele no lugar do e-mail. Letras sem acento, números, ponto ou _.</span>
              <span class="field-error"></span>
            </div>
            <div class="form-row">
              <div class="field">
                <label class="label" for="account-phone">Telefone</label>
                <input class="input" id="account-phone" name="phone" type="tel" inputmode="numeric" autocomplete="tel-national" placeholder="(99) 99999-9999" required />
                <span class="field-error"></span>
              </div>
              <div class="field">
                <label class="label" for="account-state">Estado</label>
                <select class="select" id="account-state" name="state" required><option value="">Selecione</option>${options(STATES, 'uf', 'name')}</select>
                <span class="field-error"></span>
              </div>
            </div>
            <div class="field">
              <label class="label" for="account-cpf">CPF <span class="field-hint">(opcional)</span></label>
              <input class="input" id="account-cpf" name="cpf" type="text" inputmode="numeric" placeholder="000.000.000-00" />
              <span class="field-error"></span>
            </div>
            <p class="field-hint account-privacy">${icon('lock')}Só você vê seu CPF, telefone e e-mail.</p>
          </div>
          <div class="account-panel-footer"><button type="submit" class="btn btn-primary">Salvar alterações</button></div>
        </form>
      </section>

      <!-- Dados profissionais -->
      <section class="account-panel" role="tabpanel" id="account-panel-professional" aria-labelledby="account-tab-professional" hidden>
        <form id="form-professional" novalidate>
          <div class="account-panel-body">
            <div class="alert form-alert" role="alert" hidden></div>
            <div class="field">
              <label class="label" for="pro-category">Profissão</label>
              <select class="select" id="pro-category" name="categoryId" required><option value="">Selecione</option>${options(PROFESSIONAL_CATEGORIES, 'id', 'name')}</select>
              <span class="field-error"></span>
            </div>
            <div class="field" id="pro-specialty-field" hidden>
              <label class="label" for="pro-specialty">Especialidade</label>
              <input class="input" id="pro-specialty" name="specialty" type="text" maxlength="80" list="pro-specialties" placeholder="Ex.: Clínico Geral" />
              <datalist id="pro-specialties">${SPECIALTIES.map((s) => `<option value="${s}"></option>`).join('')}</datalist>
              <span class="field-error"></span>
            </div>
            <div class="form-row" id="pro-council-fields" hidden>
              <div class="field">
                <label class="label" for="pro-council-number" id="pro-council-label">Registro no conselho</label>
                <input class="input" id="pro-council-number" name="councilNumber" type="text" inputmode="numeric" maxlength="20" />
                <span class="field-error"></span>
              </div>
              <div class="field">
                <label class="label" for="pro-council-state">UF do registro</label>
                <select class="select" id="pro-council-state" name="councilState"><option value="">UF</option>${options(STATES, 'uf', 'uf')}</select>
                <span class="field-error"></span>
              </div>
            </div>
            <p class="field-hint account-privacy">${icon('users')}Os gestores dos seus grupos veem estas informações no seu cartão de membro.</p>
          </div>
          <div class="account-panel-footer"><button type="submit" class="btn btn-primary">Salvar alterações</button></div>
        </form>
      </section>

      <!-- Foto do perfil -->
      <section class="account-panel" role="tabpanel" id="account-panel-photo" aria-labelledby="account-tab-photo" hidden>
        <div class="account-panel-body">
          <div class="photo-editor">
            <div class="photo-preview" id="photo-preview"></div>
            <div class="photo-actions">
              <p class="muted">Use uma foto de rosto, de frente. Ela aparece para os membros dos seus grupos.</p>
              <div class="form-actions" style="justify-content:flex-start">
                <label class="btn btn-primary" for="photo-input">${icon('camera')}Escolher foto</label>
                <input type="file" id="photo-input" accept="image/jpeg,image/png,image/webp" class="sr-only" />
                <button type="button" class="btn btn-ghost is-danger" id="photo-remove">Remover foto</button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </dialog>

  <!-- Alterar e-mail (abre por cima de Minha conta) -->
  <dialog class="modal" id="modal-email" aria-labelledby="modal-email-title">
    <form id="form-email" novalidate>
      <div class="dialog-header">
        <h2 id="modal-email-title">Alterar e-mail</h2>
        ${closeButton}
      </div>
      <div class="dialog-body">
        <div class="alert form-alert" role="alert" hidden></div>
        <p class="muted" style="margin-bottom:var(--esp-3)">O novo e-mail passa a valer no login na hora. Confirme com a sua senha.</p>
        <div class="field">
          <label class="label" for="email-new">Novo e-mail</label>
          <input class="input" id="email-new" name="email" type="email" autocomplete="email" required />
          <span class="field-error"></span>
        </div>
        <div class="field">
          <label class="label" for="email-password">Senha atual</label>
          <div class="password-wrap"><input class="input" id="email-password" name="password" type="password" autocomplete="current-password" required /></div>
          <span class="field-error"></span>
        </div>
      </div>
      <div class="dialog-footer">
        <button type="button" class="btn btn-secondary" data-close>Cancelar</button>
        <button type="submit" class="btn btn-primary">Alterar e-mail</button>
      </div>
    </form>
  </dialog>`;
}

// Mostra o erro nos campos e foca o primeiro. Devolve true se havia erro.
function showErrors(errors) {
  errors.forEach(([input, message]) => setFieldError(input, message));
  errors[0]?.[0].focus();
  return errors.length > 0;
}

// Sem Cloud Storage (pago em projetos novos), a foto fica no próprio perfil:
// recortada em quadrado e reduzida para 160 px (cerca de 10 KB).
const PHOTO_SIZE = 160;
const PHOTO_MAX_CHARS = 58000; // as regras aceitam até 60 mil caracteres

async function resizePhoto(file) {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = PHOTO_SIZE;
  canvas.height = PHOTO_SIZE;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // fundo branco para PNG com transparência
  ctx.fillRect(0, 0, PHOTO_SIZE, PHOTO_SIZE);
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
  bitmap.close();
  for (const quality of [0.85, 0.7, 0.5]) {
    const url = canvas.toDataURL('image/jpeg', quality);
    if (url.length <= PHOTO_MAX_CHARS) return url;
  }
  throw new Error('Foto grande demais.');
}

// Monta o modal uma vez. ctx: { user, profile, onChange } — onChange atualiza a
// pílula da conta no topo depois de salvar nome, foto ou e-mail.
function createAccountModal({ user, profile, onChange }) {
  document.body.insertAdjacentHTML('beforeend', modalHtml());
  const $ = (id) => document.getElementById(id);
  const dialog = $('modal-account');
  const userRef = doc(db, 'users', user.uid);
  const privateRef = doc(db, 'users', user.uid, 'private', 'data');
  const currentEmail = () => auth.currentUser?.email ?? user.email;
  const accountForm = $('form-account');
  const proForm = $('form-professional');
  const emailForm = $('form-email');

  setupPasswordToggles(document.getElementById('modal-email'));
  [accountForm, proForm, emailForm].forEach(clearErrorsWhileTyping);
  $('modal-email').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  });

  // ---------- Abas ----------
  const tabs = [...dialog.querySelectorAll('.account-tab')];
  function selectTab(id, { focus = false } = {}) {
    tabs.forEach((tab) => {
      const selected = tab.dataset.tab === id;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      $(tab.getAttribute('aria-controls')).hidden = !selected;
      if (selected && focus) tab.focus();
    });
  }
  dialog.querySelector('.account-tabs').addEventListener('click', (event) => {
    const tab = event.target.closest('.account-tab');
    if (tab) selectTab(tab.dataset.tab);
  });
  dialog.querySelector('.account-tabs').addEventListener('keydown', (event) => {
    const index = tabs.indexOf(document.activeElement);
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    if (index < 0 || !step) return;
    event.preventDefault();
    selectTab(tabs[(index + step + tabs.length) % tabs.length].dataset.tab, { focus: true });
  });

  // Foto, nome e e-mail no topo das abas (e na pílula da conta, via onChange)
  function renderIdentity() {
    $('account-identity').innerHTML = `${avatarHtml(profile, 'avatar account-identity-avatar')}
      <span><strong></strong><small></small></span>`;
    $('account-identity').querySelector('strong').textContent = profile.name || 'Sem nome';
    $('account-identity').querySelector('small').textContent = currentEmail();
    $('photo-preview').innerHTML = avatarHtml(profile, 'avatar photo-avatar');
    $('photo-remove').hidden = !profile.photoURL;
  }
  const changed = () => {
    renderIdentity();
    onChange?.();
  };

  // Conta só com Google (sem senha): o e-mail não pode ser trocado por aqui
  function renderPasswordMode() {
    const google = !hasPassword();
    $('change-email').hidden = google;
    $('email-google-hint').hidden = !google;
  }

  // ---------- Dados da conta ----------
  let privateData = null; // dados pessoais (users/{uid}/private/data), lidos na primeira abertura
  const accountSubmit = accountForm.querySelector('[type=submit]');
  $('account-phone').addEventListener('input', (e) => (e.target.value = formatPhone(e.target.value)));
  $('account-cpf').addEventListener('input', (e) => (e.target.value = formatCPF(e.target.value)));

  function fillAccountForm() {
    accountForm.name.value = profile.name ?? '';
    accountForm.username.value = profile.username ?? '';
    $('account-email').value = currentEmail();
    accountForm.phone.value = formatPhone(privateData?.phone ?? '');
    accountForm.state.value = privateData?.state ?? '';
    accountForm.cpf.value = formatCPF(privateData?.cpf ?? '');
  }

  async function loadPrivateData() {
    accountSubmit.disabled = true;
    try {
      privateData = (await getDoc(privateRef)).data() ?? {};
      fillAccountForm();
      accountSubmit.disabled = false;
      // Cópia do e-mail nos dados pessoais desatualizada: corrige
      if (privateData.email !== currentEmail()) {
        updateDoc(privateRef, { email: currentEmail(), updatedAt: serverTimestamp() }).catch(() => {});
      }
    } catch (error) {
      privateData = null;
      showFormAlert(accountForm, firebaseErrorMessage(error) ?? 'Não foi possível carregar seus dados. Tente de novo.');
    }
  }

  accountForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormErrors(accountForm);
    const name = accountForm.name.value.trim().replace(/\s+/g, ' ');
    const phone = onlyDigits(accountForm.phone.value);
    const state = accountForm.state.value;
    const cpf = onlyDigits(accountForm.cpf.value);
    const username = accountForm.username.value.trim().toLowerCase();

    const errors = [];
    if (!isValidName(name) || !name.includes(' ')) errors.push([accountForm.name, 'Informe seu nome completo.']);
    if (username && !/^[a-z0-9._]{3,30}$/.test(username)) {
      errors.push([accountForm.username, 'Use de 3 a 30 caracteres: letras sem acento, números, ponto ou _.']);
    }
    if (!isValidPhone(phone)) errors.push([accountForm.phone, 'Informe um telefone com DDD.']);
    if (!state) errors.push([accountForm.state, 'Escolha o estado.']);
    if (cpf && !isValidCPF(cpf)) errors.push([accountForm.cpf, 'CPF inválido.']);
    if (showErrors(errors)) return;

    setLoading(accountSubmit, true);
    try {
      // O nome de usuário é conferido (e reservado) no serviço de contas; aqui fica só a cópia
      let savedUsername = profile.username ?? null;
      if (username !== (profile.username ?? '')) {
        try {
          savedUsername = await changeUsername(username);
        } catch (error) {
          setFieldError(accountForm.username, firebaseErrorMessage(error));
          accountForm.username.focus();
          return;
        }
      }
      const batch = writeBatch(db);
      batch.update(userRef, {
        name,
        nameLower: normalize(name),
        username: savedUsername,
        searchKeywords: searchKeywords(name),
        updatedAt: serverTimestamp(),
      });
      const personal = { email: currentEmail(), phone, cpf: cpf || null, state };
      batch.set(privateRef, { ...personal, updatedAt: serverTimestamp() });
      await batch.commit();
      privateData = personal;
      profile.username = savedUsername;
      accountForm.username.value = savedUsername ?? '';
      if (name !== profile.name) {
        profile.name = name;
        updateProfile(user, { displayName: name }).catch(() => {});
        await syncMemberCards(user.uid, profile);
        changed();
      }
      toast('Dados salvos.', 'success');
    } catch (error) {
      showFormAlert(accountForm, firebaseErrorMessage(error));
    } finally {
      setLoading(accountSubmit, false);
    }
  });

  // Alterar e-mail: confere a senha e o serviço de contas troca na hora, sem link
  $('change-email').addEventListener('click', () => {
    emailForm.reset();
    clearFormErrors(emailForm);
    $('modal-email').showModal();
    emailForm.email.focus();
  });

  emailForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormErrors(emailForm);
    const newEmail = emailForm.email.value.trim();
    const errors = [];
    if (!isValidEmail(newEmail)) errors.push([emailForm.email, 'Informe um e-mail válido.']);
    else if (newEmail.toLowerCase() === currentEmail().toLowerCase()) errors.push([emailForm.email, 'Este já é o seu e-mail.']);
    if (!emailForm.password.value) errors.push([emailForm.password, 'Informe sua senha.']);
    if (showErrors(errors)) return;

    const button = emailForm.querySelector('[type=submit]');
    setLoading(button, true);
    try {
      await changeEmail(newEmail, emailForm.password.value);
      await updateDoc(privateRef, { email: currentEmail(), updatedAt: serverTimestamp() });
      if (privateData) privateData.email = currentEmail();
      syncMemberCards(user.uid, profile).catch(() => {}); // e-mail novo nos cartões dos grupos
      $('account-email').value = currentEmail();
      $('modal-email').close();
      changed();
      toast(`E-mail alterado para ${currentEmail()}. Use-o no próximo login.`, 'success', 6000);
    } catch (error) {
      const message = firebaseErrorMessage(error);
      if (!message) return;
      if (['auth/wrong-password', 'auth/invalid-credential'].includes(error.code)) {
        setFieldError(emailForm.password, 'Senha incorreta.');
        emailForm.password.focus();
      } else {
        showFormAlert(emailForm, message);
      }
    } finally {
      setLoading(button, false);
    }
  });

  // ---------- Dados profissionais ----------
  function updateProFields() {
    const category = getCategory(proForm.categoryId.value);
    $('pro-specialty-field').hidden = !category?.specialty;
    $('pro-council-fields').hidden = !category?.council;
    if (category?.council) {
      const optional = category.councilRequired ? '' : ' <span class="field-hint">(opcional)</span>';
      $('pro-council-label').innerHTML = `Nº do ${category.council}${optional}`;
    }
  }
  proForm.categoryId.addEventListener('change', updateProFields);

  function fillProForm() {
    proForm.categoryId.value = profile.categoryId ?? '';
    proForm.specialty.value = profile.specialty ?? '';
    proForm.councilNumber.value = profile.council?.number ?? '';
    proForm.councilState.value = profile.council?.state ?? '';
    updateProFields();
  }

  proForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormErrors(proForm);
    const category = getCategory(proForm.categoryId.value);
    const specialty = category?.specialty ? proForm.specialty.value.trim().replace(/\s+/g, ' ') : '';
    const number = category?.council ? proForm.councilNumber.value.trim().toUpperCase() : '';
    const councilState = category?.council ? proForm.councilState.value : '';

    const errors = [];
    if (!category) errors.push([proForm.categoryId, 'Escolha sua profissão.']);
    if (category?.councilRequired && !number) errors.push([proForm.councilNumber, `Informe o número do ${category.council}.`]);
    if (number && !/^[0-9A-Z.\-/]{1,20}$/.test(number)) errors.push([proForm.councilNumber, 'Use só números e letras.']);
    if (number && !councilState) errors.push([proForm.councilState, 'Escolha a UF.']);
    if (showErrors(errors)) return;

    const button = proForm.querySelector('[type=submit]');
    setLoading(button, true);
    try {
      const data = {
        categoryId: category.id,
        specialty: specialty || null,
        council: number ? { type: category.council, number, state: councilState } : null,
      };
      await updateDoc(userRef, { ...data, updatedAt: serverTimestamp() });
      Object.assign(profile, data);
      await syncMemberCards(user.uid, profile);
      changed();
      toast('Dados profissionais salvos.', 'success');
    } catch (error) {
      showFormAlert(proForm, firebaseErrorMessage(error));
    } finally {
      setLoading(button, false);
    }
  });

  // ---------- Foto ----------
  async function savePhoto(photoURL) {
    await updateDoc(userRef, { photoURL, updatedAt: serverTimestamp() });
    profile.photoURL = photoURL;
    await syncMemberCards(user.uid, profile);
    changed();
  }

  $('photo-input').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      toast('Escolha uma imagem de até 15 MB.', 'error');
      return;
    }
    try {
      await savePhoto(await resizePhoto(file));
      toast('Foto atualizada.', 'success');
    } catch (error) {
      toast(error.code ? firebaseErrorMessage(error) : 'Não foi possível usar esta imagem. Tente outra (JPG ou PNG).', 'error');
    }
  });

  $('photo-remove').addEventListener('click', async () => {
    try {
      await savePhoto(null);
      toast('Foto removida.', 'success');
    } catch (error) {
      toast(firebaseErrorMessage(error), 'error');
    }
  });

  // Cada abertura começa do que está salvo (descarta o que ficou sem salvar)
  return function open(tabId = 'account') {
    [accountForm, proForm].forEach(clearFormErrors);
    renderPasswordMode();
    renderIdentity();
    fillProForm();
    fillAccountForm();
    if (!privateData) loadPrivateData();
    selectTab(TABS.some((t) => t.id === tabId) ? tabId : 'account');
    dialog.showModal();
    dialog.querySelector('.account-tab[aria-selected="true"]').focus();
  };
}

let openModal = null;

export function openAccountModal(ctx, tabId) {
  openModal ??= createAccountModal(ctx);
  openModal(tabId);
}
