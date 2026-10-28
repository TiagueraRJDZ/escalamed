// Cadastro em 4 etapas: e-mail e termos → senha (cria a conta) → dados pessoais → dados profissionais.
// Se a pessoa fechar no meio, users/{uid}.signupStep guarda a última etapa concluída
// e os guards trazem ela de volta para cá no próximo acesso.
// Pelo Google, a conta já vem criada: começa nos dados pessoais, com o aceite dos termos ali.
import { updateProfile } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  doc,
  getDoc,
  writeBatch,
  updateDoc,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { auth, db, navigate } from '../firebase.js';
import { currentUser, loadProfile, isProfileComplete, nextUrl, nextParam } from '../auth.js';
import { signUp } from '../auth-api.js';
import { renderIcons } from '../icons.js';
import { mountCredits } from '../version.js';
import { setupCarousel, setupPasswordToggles, setupPasswordRules, setupGoogleButtons } from '../auth-ui.js';
import { PROFESSIONAL_CATEGORIES, SPECIALTIES, getCategory } from '/data/categories.js';
import { STATES } from '/data/states.js';
import {
  isValidEmail,
  isValidName,
  isStrongPassword,
  isValidPhone,
  isValidCPF,
  formatPhone,
  formatCPF,
  onlyDigits,
  normalize,
  searchKeywords,
} from '../validators.js';
import {
  escapeHtml,
  setLoading,
  setFieldError,
  clearFormErrors,
  clearErrorsWhileTyping,
  showFormAlert,
  firebaseErrorMessage,
} from '../ui.js';

// Versão dos Termos de Uso e do Aviso de Privacidade aceitos no cadastro
const TERMS_VERSION = '2026-10';

const $ = (id) => document.getElementById(id);
let email = '';
let user = await currentUser();
let profile = null;
let termsAccepted = false; // marcado na etapa 1 (quem entra pelo Google confirma na etapa 3)

// ---------- Etapas ----------
function goTo(step, { focus = true } = {}) {
  for (let i = 1; i <= 4; i++) $(`step-${i}`).hidden = i !== step;
  $('signup-progress').hidden = false;
  $('progress-label').textContent = `Etapa ${step} de 4`;
  $('progress-fill').style.width = `${step * 25}%`;
  document.querySelector('.signup-progress-bar').setAttribute('aria-valuenow', String(step));
  if (focus) {
    const heading = $(`step-${step}-title`);
    heading.tabIndex = -1;
    heading.focus();
  }
}

document.querySelectorAll('[data-go]').forEach((button) =>
  button.addEventListener('click', () => goTo(Number(button.dataset.go))),
);

// Cadastro completo: segue para onde a pessoa ia (ou para a tela Escalas)
const finish = () => navigate(nextUrl(), { replace: true });

// ---------- Etapa 1: e-mail e termos ----------
// O e-mail repetido só é avisado na etapa 2, quando o serviço de contas tenta criar a conta.
$('form-email').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.target;
  clearFormErrors(form);
  const value = form.email.value.trim();

  let valid = true;
  if (!isValidEmail(value)) {
    setFieldError(form.email, 'Informe um e-mail válido.');
    valid = false;
  }
  if (!form.terms.checked) {
    setFieldError(form.terms, 'Para continuar, aceite os Termos de Uso e o Aviso de Privacidade.');
    valid = false;
  }
  if (!valid) return;

  email = value;
  termsAccepted = true;
  $('step-2-email').innerHTML = `Conta para <strong>${escapeHtml(email)}</strong>`;
  $('signup-username').value = email;
  goTo(2);
});

// ---------- Etapa 2: senha (cria a conta no serviço de contas) ----------
setupPasswordRules($('signup-password'), $('password-rules'), $('strength-meter'));

$('form-password').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  clearFormErrors(form);
  const password = form.password.value;

  const errors = [];
  if (!isStrongPassword(password)) errors.push([form.password, 'A senha não atende aos requisitos acima.']);
  if (form.confirm.value !== password) errors.push([form.confirm, 'As senhas não conferem.']);
  if (errors.length) {
    errors.forEach(([input, message]) => setFieldError(input, message));
    errors[0][0].focus();
    return;
  }

  const button = form.querySelector('[type=submit]');
  setLoading(button, true);
  try {
    await signUp(email, password);
    user = auth.currentUser;
    goTo(3);
  } catch (error) {
    showFormAlert(form, firebaseErrorMessage(error));
  } finally {
    setLoading(button, false);
  }
});

// ---------- Etapa 3: dados pessoais ----------
// Foto da conta Google, se houver (as regras aceitam endereço https)
function googlePhoto() {
  const url = user.photoURL;
  return url && url.startsWith('https://') && url.length <= 2000 ? url : null;
}

$('signup-state').insertAdjacentHTML(
  'beforeend',
  STATES.map((s) => `<option value="${s.uf}">${s.name}</option>`).join(''),
);
$('signup-phone').addEventListener('input', (e) => (e.target.value = formatPhone(e.target.value)));
$('signup-cpf').addEventListener('input', (e) => (e.target.value = formatCPF(e.target.value)));

$('form-personal').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
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
  if (!$('personal-terms').hidden && !form.terms.checked) {
    errors.push([form.terms, 'Para continuar, aceite os Termos de Uso e o Aviso de Privacidade.']);
  }
  if (errors.length) {
    errors.forEach(([input, message]) => setFieldError(input, message));
    errors[0][0].focus();
    return;
  }

  const button = form.querySelector('[type=submit]');
  setLoading(button, true);
  try {
    const userRef = doc(db, 'users', user.uid);
    const publicData = {
      name,
      nameLower: normalize(name),
      searchKeywords: searchKeywords(name),
      updatedAt: serverTimestamp(),
    };
    const batch = writeBatch(db);
    if (profile) {
      batch.update(userRef, publicData);
    } else {
      batch.set(userRef, {
        ...publicData,
        photoURL: googlePhoto(),
        username: null,
        categoryId: null,
        specialty: null,
        council: null,
        signupStep: 3,
        termsAcceptedAt: serverTimestamp(),
        termsVersion: TERMS_VERSION,
        createdAt: serverTimestamp(),
      });
    }
    batch.set(doc(db, 'users', user.uid, 'private', 'data'), {
      email: user.email,
      phone,
      cpf: cpf || null,
      state,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    profile = { ...profile, name, signupStep: profile?.signupStep ?? 3 };
    $('personal-terms').hidden = true;
    updateProfile(user, { displayName: name }).catch(() => {});
    goTo(4);
  } catch (error) {
    showFormAlert(form, firebaseErrorMessage(error));
  } finally {
    setLoading(button, false);
  }
});

// ---------- Etapa 4: dados profissionais ----------
$('signup-category').insertAdjacentHTML(
  'beforeend',
  PROFESSIONAL_CATEGORIES.map((c) => `<option value="${c.id}">${c.name}</option>`).join(''),
);
$('signup-council-state').insertAdjacentHTML(
  'beforeend',
  STATES.map((s) => `<option value="${s.uf}">${s.uf}</option>`).join(''),
);
$('specialty-options').innerHTML = SPECIALTIES.map((s) => `<option value="${s}"></option>`).join('');

// Mostra especialidade e registro conforme a profissão
function updateProfessionalFields() {
  const category = getCategory($('signup-category').value);
  $('specialty-field').hidden = !category?.specialty;
  $('council-fields').hidden = !category?.council;
  if (category?.council) {
    const optional = category.councilRequired ? '' : ' <span class="field-hint">(opcional)</span>';
    $('council-label').innerHTML = `Nº do ${category.council}${optional}`;
  }
}
$('signup-category').addEventListener('change', updateProfessionalFields);

$('form-professional').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  clearFormErrors(form);
  const category = getCategory(form.categoryId.value);
  const specialty = category?.specialty ? form.specialty.value.trim().replace(/\s+/g, ' ') : '';
  const number = category?.council ? form.councilNumber.value.trim().toUpperCase() : '';
  const councilState = category?.council ? form.councilState.value : '';

  const errors = [];
  if (!category) errors.push([form.categoryId, 'Escolha sua profissão.']);
  if (category?.councilRequired && !number) errors.push([form.councilNumber, `Informe o número do ${category.council}.`]);
  if (number && !/^[0-9A-Z.\-/]{1,20}$/.test(number)) errors.push([form.councilNumber, 'Use só números e letras.']);
  if (number && !councilState) errors.push([form.councilState, 'Escolha a UF.']);
  if (errors.length) {
    errors.forEach(([input, message]) => setFieldError(input, message));
    errors[0][0].focus();
    return;
  }

  const button = form.querySelector('[type=submit]');
  setLoading(button, true);
  try {
    await updateDoc(doc(db, 'users', user.uid), {
      categoryId: category.id,
      specialty: specialty || null,
      council: number ? { type: category.council, number, state: councilState } : null,
      signupStep: 4,
      updatedAt: serverTimestamp(),
    });
    finish();
  } catch (error) {
    showFormAlert(form, firebaseErrorMessage(error));
    setLoading(button, false);
  }
});

// ---------- Início ----------
renderIcons();
setupCarousel();
mountCredits();
setupPasswordToggles();
setupGoogleButtons();
['form-email', 'form-password', 'form-personal', 'form-professional'].forEach((id) =>
  clearErrorsWhileTyping($(id)),
);
$('login-link').href = `/${nextParam()}#entrar`;

// Retomada: conta já criada (fechou no meio) → continua de onde parou
if (user) {
  profile = await loadProfile(user.uid).catch(() => null);
  if (isProfileComplete(profile)) {
    navigate(nextUrl(), { replace: true });
  } else if (profile) {
    const privateSnap = await getDoc(doc(db, 'users', user.uid, 'private', 'data')).catch(() => null);
    const extra = privateSnap?.data() ?? {};
    const form = $('form-personal');
    form.name.value = profile.name ?? '';
    form.phone.value = formatPhone(extra.phone ?? '');
    form.state.value = extra.state ?? '';
    form.cpf.value = formatCPF(extra.cpf ?? '');
    goTo(4, { focus: false });
  } else {
    $('form-personal').name.value = user.displayName ?? '';
    $('personal-terms').hidden = false; // conta criada fora da etapa 1 (ex.: Google): confirma os termos aqui
    goTo(3, { focus: false });
  }
} else {
  goTo(1, { focus: false });
}
