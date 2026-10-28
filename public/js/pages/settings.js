// Minha conta (dados, profissão, foto) e Configurações (senha, usuários da plataforma, exclusão):
// mesma página, abas por parte.
import { updateProfile, deleteUser } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch,
  updateDoc,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { auth, db } from '../firebase.js';
import { signOutUser, isProfileComplete } from '../auth.js';
import {
  changePassword,
  changeEmail,
  changeUsername,
  reauthenticate,
  hasPassword,
  adminAccounts,
  adminTemporaryPassword,
  adminSetAccess,
  adminDeleteAccount,
} from '../auth-api.js';
import { initLayout, avatarHtml } from '../layout.js';
import { renderIcons, icon } from '../icons.js';
import { setupPasswordToggles, setupPasswordRules } from '../auth-ui.js';
import { PROFESSIONAL_CATEGORIES, SPECIALTIES, getCategory, professionLabel, councilLabel } from '/data/categories.js';
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
import { syncMemberCards, removeMember } from '../members.js';
import {
  escapeHtml,
  toast,
  confirmDialog,
  setLoading,
  setFieldError,
  clearFormErrors,
  clearErrorsWhileTyping,
  showFormAlert,
  firebaseErrorMessage,
} from '../ui.js';

renderIcons();
const { user, profile } = await initLayout({ active: 'settings' });
const $ = (id) => document.getElementById(id);
const userRef = doc(db, 'users', user.uid);
const privateRef = doc(db, 'users', user.uid, 'private', 'data');

setupPasswordToggles();
['form-account', 'form-professional', 'form-password', 'form-delete', 'form-email'].forEach((id) =>
  clearErrorsWhileTyping($(id)),
);

// Mostra o erro nos campos e foca o primeiro. Devolve true se havia erro.
function showErrors(errors) {
  errors.forEach(([input, message]) => setFieldError(input, message));
  errors[0]?.[0].focus();
  return errors.length > 0;
}

// E-mail atual (muda depois de "Alterar e-mail")
const currentEmail = () => auth.currentUser?.email ?? user.email;

// Senha errada aparece no campo da senha; o resto, no alerta do formulário
function handleAuthError(form, error, passwordInput) {
  const message = firebaseErrorMessage(error);
  if (!message) return; // fechou a janela do Google
  if (['auth/wrong-password', 'auth/invalid-credential'].includes(error.code)) {
    setFieldError(passwordInput, 'Senha incorreta.');
    passwordInput.focus();
  } else {
    showFormAlert(form, message);
  }
}

// Conta só com Google (sem senha): confirma ações sensíveis pelo Google e a aba
// de senha vira "Criar senha". Atualiza de novo depois que a senha é criada.
function renderPasswordMode() {
  const google = !hasPassword();
  $('change-email').hidden = google;
  $('email-google-hint').hidden = !google;
  $('password-google-hint').hidden = !google;
  $('password-current-field').hidden = google;
  $('delete-password-field').hidden = google;
  document.querySelectorAll('[data-password-title]').forEach((el) => {
    el.textContent = google ? 'Criar senha' : 'Alterar senha';
  });
}
renderPasswordMode();

// ---------- Abas (verticais) ----------
// A página tem duas partes, abertas pelo menu da conta (canto superior direito):
// "Minha conta" (dados, profissão e foto) e "Configurações" (senha, usuários e exclusão).
// Só aparecem as abas da parte da aba escolhida. Abas com data-off ficam escondidas
// (ex.: "Usuários" para quem não é administrador da plataforma).
const SECTIONS = { account: 'Minha conta', settings: 'Configurações' };
const tabList = [...document.querySelectorAll('#settings-tabs .tab')];
const visibleTabs = () => tabList.filter((t) => !t.hidden);
const tabFromHash = () => tabList.find((t) => `#${t.dataset.hash}` === location.hash);

function selectTab(tab, { focus = false } = {}) {
  const { section } = tab.dataset;
  $('settings-title').textContent = SECTIONS[section];
  document.title = `${SECTIONS[section]} | EscalaMed`;
  tabList.forEach((t) => {
    const selected = t === tab;
    t.hidden = t.dataset.section !== section || t.hasAttribute('data-off');
    t.setAttribute('aria-selected', String(selected));
    t.tabIndex = selected ? 0 : -1;
    $(t.getAttribute('aria-controls')).hidden = !selected;
  });
  if (focus) tab.focus();
  history.replaceState(null, '', `#${tab.dataset.hash}`);
  tab.dispatchEvent(new Event('tab-selected'));
}

$('settings-tabs').addEventListener('click', (event) => {
  const tab = event.target.closest('.tab');
  if (tab) selectTab(tab);
});
$('settings-tabs').addEventListener('keydown', (event) => {
  const tabs = visibleTabs();
  const index = tabs.indexOf(document.activeElement);
  if (index < 0) return;
  const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
  if (!step) return;
  event.preventDefault();
  selectTab(tabs[(index + step + tabs.length) % tabs.length], { focus: true });
});
selectTab(tabFromHash() ?? tabList[0]);

// Link para uma aba com a página já aberta (ex.: "Configurações" no menu do topo)
window.addEventListener('hashchange', () => {
  const tab = tabFromHash();
  if (tab) selectTab(tab);
});
$('settings-tabs').addEventListener('keydown', (event) => {
  const index = tabList.indexOf(document.activeElement);
  if (index < 0) return;
  const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
  if (!step) return;
  event.preventDefault();
  selectTab(tabList[(index + step + tabList.length) % tabList.length], { focus: true });
});
selectTab(tabList.find((t) => `#${t.dataset.hash}` === location.hash) ?? tabList[0]);

// Link para uma aba com a página já aberta (ex.: "Minha conta" no menu do topo)
window.addEventListener('hashchange', () => {
  const tab = tabList.find((t) => `#${t.dataset.hash}` === location.hash);
  if (tab) selectTab(tab);
});

// ---------- Informações da conta ----------
const accountForm = $('form-account');
$('account-state').insertAdjacentHTML('beforeend', STATES.map((s) => `<option value="${s.uf}">${s.name}</option>`).join(''));
$('account-phone').addEventListener('input', (e) => (e.target.value = formatPhone(e.target.value)));
$('account-cpf').addEventListener('input', (e) => (e.target.value = formatCPF(e.target.value)));

const privateData = (await getDoc(privateRef).catch(() => null))?.data() ?? {};
accountForm.name.value = profile.name ?? '';
accountForm.username.value = profile.username ?? '';
$('account-email').value = currentEmail();
accountForm.phone.value = formatPhone(privateData.phone ?? '');
accountForm.state.value = privateData.state ?? '';
accountForm.cpf.value = formatCPF(privateData.cpf ?? '');

// Cópia do e-mail nos dados pessoais desatualizada: corrige
if (privateData.email !== currentEmail()) {
  updateDoc(privateRef, { email: currentEmail(), updatedAt: serverTimestamp() }).catch(() => {});
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

  const button = accountForm.querySelector('[type=submit]');
  setLoading(button, true);
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
    batch.set(privateRef, { email: currentEmail(), phone, cpf: cpf || null, state, updatedAt: serverTimestamp() });
    await batch.commit();
    profile.username = savedUsername;
    accountForm.username.value = savedUsername ?? '';
    if (name !== profile.name) {
      profile.name = name;
      updateProfile(user, { displayName: name }).catch(() => {});
      await syncMemberCards(user.uid, profile);
    }
    toast('Dados salvos.', 'success');
  } catch (error) {
    showFormAlert(accountForm, firebaseErrorMessage(error));
  } finally {
    setLoading(button, false);
  }
});

// Alterar e-mail: confere a senha e o serviço de contas troca na hora, sem link
const emailForm = $('form-email');
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
    $('account-email').value = currentEmail();
    $('modal-email').close();
    toast(`E-mail alterado para ${currentEmail()}. Use-o no próximo login.`, 'success', 6000);
  } catch (error) {
    handleAuthError(emailForm, error, emailForm.password);
  } finally {
    setLoading(button, false);
  }
});

// ---------- Informações profissionais ----------
const proForm = $('form-professional');
$('pro-category').insertAdjacentHTML(
  'beforeend',
  PROFESSIONAL_CATEGORIES.map((c) => `<option value="${c.id}">${c.name}</option>`).join(''),
);
$('pro-council-state').insertAdjacentHTML('beforeend', STATES.map((s) => `<option value="${s.uf}">${s.uf}</option>`).join(''));
$('pro-specialties').innerHTML = SPECIALTIES.map((s) => `<option value="${s}"></option>`).join('');

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

proForm.categoryId.value = profile.categoryId ?? '';
proForm.specialty.value = profile.specialty ?? '';
proForm.councilNumber.value = profile.council?.number ?? '';
proForm.councilState.value = profile.council?.state ?? '';
updateProFields();

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
    toast('Informações profissionais salvas.', 'success');
  } catch (error) {
    showFormAlert(proForm, firebaseErrorMessage(error));
  } finally {
    setLoading(button, false);
  }
});

// ---------- Foto ----------
// Sem Cloud Storage (pago em projetos novos), a foto fica no próprio perfil:
// recortada em quadrado e reduzida para 160 px (cerca de 10 KB).
const PHOTO_SIZE = 160;
const PHOTO_MAX_CHARS = 58000; // as regras aceitam até 60 mil caracteres

function renderPhoto() {
  $('photo-preview').innerHTML = avatarHtml(profile, 'avatar photo-avatar');
  $('photo-remove').hidden = !profile.photoURL;
}

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

async function savePhoto(photoURL) {
  await updateDoc(userRef, { photoURL, updatedAt: serverTimestamp() });
  profile.photoURL = photoURL;
  await syncMemberCards(user.uid, profile);
  renderPhoto();
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
    toast('Foto atualizada. Ela aparece no menu depois de recarregar a página.', 'success');
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

renderPhoto();

// ---------- Alterar senha ----------
const passwordForm = $('form-password');
passwordForm.username.value = currentEmail();
setupPasswordRules($('password-new'), $('password-rules'), $('strength-meter'));

passwordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFormErrors(passwordForm);
  const { current, password, confirm } = passwordForm;
  const errors = [];
  const google = !hasPassword();
  if (!google && !current.value) errors.push([current, 'Informe a senha atual.']);
  if (!isStrongPassword(password.value)) errors.push([password, 'A nova senha não atende aos requisitos acima.']);
  else if (password.value === current.value) errors.push([password, 'A nova senha precisa ser diferente da atual.']);
  if (confirm.value !== password.value) errors.push([confirm, 'As senhas não conferem.']);
  if (showErrors(errors)) return;

  const button = passwordForm.querySelector('[type=submit]');
  setLoading(button, true);
  try {
    await changePassword(current.value, password.value);
    passwordForm.reset();
    password.dispatchEvent(new Event('input'));
    if (google) {
      await auth.currentUser.reload(); // passa a constar o login por senha
      renderPasswordMode();
    }
    toast(google ? 'Senha criada. Agora você também entra com e-mail e senha.' : 'Senha alterada.', 'success');
  } catch (error) {
    handleAuthError(passwordForm, error, current);
  } finally {
    setLoading(button, false);
  }
});

// ---------- Excluir conta ----------
const deleteForm = $('form-delete');
deleteForm.username.value = currentEmail();

const myGroups = async () =>
  (await getDocs(query(collection(db, 'groups'), where('memberIds', 'array-contains', user.uid)))).docs.map((d) => ({
    id: d.id,
    ...d.data(),
  }));

// Gestor de grupo com outras pessoas precisa transferir a gestão antes
const blocking = (groups) =>
  groups.filter((g) => g.type === 'team' && g.managerIds.includes(user.uid) && g.memberIds.length > 1);

async function renderBlockers() {
  const blockers = blocking(await myGroups().catch(() => []));
  $('delete-blockers').innerHTML = blockers.length
    ? `<div class="alert alert-warning">Antes de excluir, transfira a gestão destes grupos (na aba Membros de cada um):
        <ul>${blockers
          .map((g) => `<li><a href="/group.html?id=${encodeURIComponent(g.id)}#membros">${escapeHtml(g.name)}</a></li>`)
          .join('')}</ul></div>`
    : '';
  deleteForm.querySelector('[type=submit]').disabled = blockers.length > 0;
}

// Apaga um grupo inteiro (escala individual, ou equipe em que só sobrou o usuário)
async function deleteWholeGroup(group) {
  const batch = writeBatch(db);
  for (const sub of ['shifts', 'invites', 'members']) {
    const snapshot = await getDocs(collection(db, 'groups', group.id, sub));
    snapshot.docs.forEach((d) => batch.delete(d.ref));
  }
  batch.delete(doc(db, 'groups', group.id));
  await batch.commit();
}

deleteForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFormErrors(deleteForm);
  const errors = [];
  if (deleteForm.confirmText.value.trim() !== 'EXCLUIR') errors.push([deleteForm.confirmText, 'Digite EXCLUIR, em maiúsculas.']);
  if (hasPassword() && !deleteForm.password.value) errors.push([deleteForm.password, 'Informe sua senha.']);
  if (showErrors(errors)) return;

  const button = deleteForm.querySelector('[type=submit]');
  setLoading(button, true);
  try {
    await reauthenticate(deleteForm.password.value);
    const groups = await myGroups();
    if (blocking(groups).length) {
      await renderBlockers();
      setLoading(button, false);
      return;
    }
    for (const group of groups) {
      const alone = group.memberIds.length === 1 && group.ownerId === user.uid;
      if (alone) await deleteWholeGroup(group);
      else await removeMember(group, user.uid);
    }
    const batch = writeBatch(db);
    batch.delete(privateRef);
    batch.delete(userRef);
    await batch.commit();
    if (profile.username) await changeUsername(''); // libera o nome de usuário
    await deleteUser(auth.currentUser);
    toast('Sua conta foi excluída.', 'success');
    await signOutUser();
  } catch (error) {
    handleAuthError(deleteForm, error, deleteForm.password);
    setLoading(button, false);
  }
});

renderBlockers();

// ---------- Usuários (administrador da plataforma) ----------
// Todas as contas da plataforma: o login (e-mail, usuário, situação) vem do serviço de
// contas e o perfil (nome, profissão, foto) do Firestore. As ações passam pelo serviço
// de contas, que confere em config/admins se quem pede é administrador.
const usersUi = {
  list: $('users-list'),
  empty: $('users-empty'),
  search: $('users-search'),
  alert: $('users-alert'),
  count: $('users-count'),
};
let platformUsers = null;

async function loadPlatformUsers() {
  const [accounts, profiles] = await Promise.allSettled([adminAccounts(), getDocs(collection(db, 'users'))]);
  if (accounts.status === 'rejected' && profiles.status === 'rejected') throw accounts.reason;

  const profileOf = new Map();
  if (profiles.status === 'fulfilled') profiles.value.docs.forEach((d) => profileOf.set(d.id, d.data()));

  const people = new Map();
  if (accounts.status === 'fulfilled') {
    usersUi.alert.hidden = true;
    accounts.value.forEach((a) => people.set(a.uid, { ...a, profile: profileOf.get(a.uid) ?? null }));
  } else {
    usersUi.alert.textContent = `${firebaseErrorMessage(accounts.reason)} A lista mostra só os perfis, sem e-mail e situação do acesso.`;
    usersUi.alert.hidden = false;
  }
  // Perfil sem login: só é marcado "Sem login" quando a lista de contas veio
  profileOf.forEach((profile, uid) => {
    if (people.has(uid)) return;
    people.set(uid, {
      uid,
      email: null,
      usuario: profile.username ?? null,
      inativa: false,
      profile,
      semLogin: accounts.status === 'fulfilled',
    });
  });

  return [...people.values()]
    .map((p) => ({ ...p, name: p.profile?.name || p.email || 'Sem nome' }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

function userRowHtml(p) {
  const me = p.uid === user.uid;
  const profile = p.profile;
  const login = [p.usuario ? `@${p.usuario}` : '', p.email ?? ''].filter(Boolean).join(' · ');
  const work = profile ? [professionLabel(profile), councilLabel(profile.council)].filter(Boolean).join(' · ') : '';
  const badges = [
    me ? '<span class="badge badge-primary">Você</span>' : '',
    p.inativa ? '<span class="badge badge-danger">Inativo</span>' : '',
    !isProfileComplete(profile) && !p.semLogin ? '<span class="badge badge-muted">Cadastro incompleto</span>' : '',
    p.semLogin ? '<span class="badge badge-muted">Sem login</span>' : '',
  ].join('');
  const off = me || p.semLogin ? ' disabled' : '';
  const name = escapeHtml(p.name);
  const accessButton = p.inativa
    ? `<button type="button" class="btn-icon" data-action="access" title="Reativar acesso" aria-label="Reativar acesso de ${name}"${off}>${icon('userCheck')}</button>`
    : `<button type="button" class="btn-icon" data-action="access" title="Inativar acesso" aria-label="Inativar acesso de ${name}"${off}>${icon('ban')}</button>`;
  return `<li class="member-item user-item${p.inativa ? ' is-inactive' : ''}" data-uid="${escapeHtml(p.uid)}">
    ${avatarHtml(profile ?? { name: p.name }, 'avatar member-avatar')}
    <div class="member-info">
      <strong>${name}${badges}</strong>
      <span>${escapeHtml([login, work].filter(Boolean).join(' · ') || 'Sem dados de login')}</span>
    </div>
    <div class="user-actions">
      <button type="button" class="btn-icon" data-action="password" title="Redefinir senha" aria-label="Redefinir senha de ${name}"${off}>${icon('keyRound')}</button>
      ${accessButton}
      <button type="button" class="btn-icon" data-action="delete" title="Excluir acesso" aria-label="Excluir acesso de ${name}"${me ? ' disabled' : ''}>${icon('trash')}</button>
    </div>
  </li>`;
}

function renderPlatformUsers() {
  const term = normalize(usersUi.search.value);
  const shown = platformUsers.filter(
    (p) => !term || normalize(`${p.name} ${p.usuario ?? ''} ${p.email ?? ''}`).includes(term),
  );
  usersUi.list.innerHTML = shown.map(userRowHtml).join('');
  usersUi.empty.hidden = shown.length > 0;
  usersUi.empty.textContent = platformUsers.length ? 'Ninguém encontrado.' : 'Nenhum usuário na plataforma.';
  const inactive = platformUsers.filter((p) => p.inativa).length;
  usersUi.count.textContent =
    `${platformUsers.length} ${platformUsers.length === 1 ? 'usuário' : 'usuários'}` +
    (inactive ? ` · ${inactive} ${inactive === 1 ? 'inativo' : 'inativos'}` : '');
}

async function openUsersTab() {
  if (platformUsers) return;
  usersUi.list.innerHTML = '<li class="muted">Carregando usuários…</li>';
  try {
    platformUsers = await loadPlatformUsers();
    renderPlatformUsers();
  } catch (error) {
    usersUi.list.innerHTML = '';
    usersUi.alert.textContent = firebaseErrorMessage(error);
    usersUi.alert.hidden = false;
  }
}

$('tab-users').addEventListener('tab-selected', openUsersTab);
usersUi.search.addEventListener('input', () => platformUsers && renderPlatformUsers());

async function resetUserPassword(person) {
  const ok = await confirmDialog({
    title: 'Redefinir senha?',
    message: `A senha atual de ${person.name} deixa de funcionar e as sessões abertas são encerradas. A pessoa entra com a senha provisória e cria uma nova.`,
    confirmText: 'Gerar senha provisória',
  });
  if (!ok) return;
  const password = await adminTemporaryPassword(person.uid);
  $('temp-password-text').innerHTML = `Passe esta senha para <strong>${escapeHtml(person.name)}</strong> por um canal seguro. Ela não fica guardada: anote antes de fechar.`;
  $('temp-password').value = password;
  $('modal-temp-password').showModal();
}

async function toggleUserAccess(person) {
  const activate = person.inativa;
  const ok = await confirmDialog(
    activate
      ? {
          title: 'Reativar acesso?',
          message: `${person.name} volta a conseguir entrar no EscalaMed com a senha de antes.`,
          confirmText: 'Reativar',
        }
      : {
          title: 'Inativar acesso?',
          message: `${person.name} não consegue mais entrar e as sessões abertas são encerradas. Os dados e os grupos continuam como estão, e dá para reativar depois.`,
          confirmText: 'Inativar',
          danger: true,
        },
  );
  if (!ok) return;
  await adminSetAccess(person.uid, activate);
  person.inativa = !activate;
  renderPlatformUsers();
  toast(activate ? `Acesso de ${person.name} reativado.` : `Acesso de ${person.name} inativado.`, 'success');
}

async function deleteUserAccess(person) {
  const ok = await confirmDialog({
    title: 'Excluir acesso?',
    message: `O login e o perfil de ${person.name} são apagados e não dá para desfazer. Nos grupos, o nome continua no histórico até o gestor remover. Se for por um tempo, prefira Inativar.`,
    confirmText: 'Excluir',
    danger: true,
  });
  if (!ok) return;
  // Primeiro o perfil (pelas regras: só o administrador ou a própria pessoa); depois o login
  if (person.profile) {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'users', person.uid, 'private', 'data'));
    batch.delete(doc(db, 'users', person.uid));
    await batch.commit();
  }
  if (!person.semLogin) await adminDeleteAccount(person.uid);
  platformUsers = platformUsers.filter((p) => p.uid !== person.uid);
  renderPlatformUsers();
  toast(`Acesso de ${person.name} excluído.`, 'success');
}

const USER_ACTIONS = { password: resetUserPassword, access: toggleUserAccess, delete: deleteUserAccess };

usersUi.list.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const person = platformUsers.find((p) => p.uid === button.closest('[data-uid]').dataset.uid);
  if (!person) return;
  setLoading(button, true);
  try {
    await USER_ACTIONS[button.dataset.action](person);
  } catch (error) {
    toast(firebaseErrorMessage(error) ?? 'Não foi possível concluir.', 'error', 6000);
  } finally {
    if (button.isConnected) setLoading(button, false);
  }
});

$('copy-temp-password').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('temp-password').value);
    toast('Senha copiada.', 'success');
  } catch {
    toast('Não foi possível copiar. Selecione a senha e use Ctrl+C.');
  }
});
$('modal-temp-password').addEventListener('close', () => ($('temp-password').value = ''));

// A aba só aparece para administradores da plataforma (uid em config/admins)
(async () => {
  const snapshot = await getDoc(doc(db, 'config', 'admins')).catch(() => null);
  const isAdmin = (snapshot?.data()?.uids ?? []).includes(user.uid);
  const tab = $('tab-users');
  const selected = tab.getAttribute('aria-selected') === 'true';
  if (!isAdmin) {
    if (selected) selectTab($('tab-password'));
    return;
  }
  tab.removeAttribute('data-off');
  selectTab(selected ? tab : tabList.find((t) => t.getAttribute('aria-selected') === 'true'));
})();
