// Configurações > Editar perfil: capa com as iniciais, foto, "Me chame de…", nome de usuário,
// mini bio, Lattes e listas (certificações, formações, experiências, ligas e cooperativas).
// Tudo fica no perfil (users/{uid}), no campo "about"; o nome de usuário é reservado no
// serviço de contas (é com ele que a pessoa pode entrar no lugar do e-mail).
import { updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { changeUsername } from '../auth-api.js';
import { avatarHtml } from '../layout.js';
import { icon } from '../icons.js';
import { isValidUrl } from '../validators.js';
import { syncMemberCards } from '../members.js';
import {
  escapeHtml,
  initials,
  toast,
  setLoading,
  setFieldError,
  clearFormErrors,
  clearErrorsWhileTyping,
  showFormAlert,
  firebaseErrorMessage,
  confirmDialog,
} from '../ui.js';
import { showErrors, trackChanges, createDialog } from './shared.js';

const BIO_MAX = 160;
const LIST_MAX = 20; // mesmo limite do firestore.rules
const TEXT_MAX = 100;

// Cada item é { title, place, start, end }; muda só o que cada lista chama de quê.
// ongoing: como mostrar um item sem ano de fim (ex.: "2021 – atual").
const LISTS = [
  {
    key: 'certifications',
    title: 'Certificações',
    add: 'Adicionar certificação',
    labels: { title: 'Certificação', place: 'Instituição emissora', start: 'Ano' },
  },
  {
    key: 'education',
    title: 'Formações acadêmicas',
    add: 'Adicionar formação',
    labels: { title: 'Curso', place: 'Instituição', start: 'Ano de início', end: 'Ano de conclusão' },
    ongoing: 'em andamento',
  },
  {
    key: 'experiences',
    title: 'Experiências',
    add: 'Adicionar experiência',
    labels: { title: 'Cargo ou função', place: 'Local', start: 'Ano de início', end: 'Ano de saída' },
    ongoing: 'atual',
  },
  {
    key: 'academicLeagues',
    title: 'Liga acadêmica',
    add: 'Adicionar liga',
    labels: { title: 'Nome da liga', place: 'Instituição', start: 'Ano de início', end: 'Ano de saída' },
    ongoing: 'atual',
  },
  {
    key: 'cooperatives',
    title: 'Cooperativas',
    add: 'Adicionar cooperativa',
    labels: { title: 'Cooperativa', place: 'Cidade / UF', start: 'Cooperado desde (ano)' },
  },
];

const YEAR = /^(19[5-9]\d|20\d\d)$/;

function period(item, list) {
  if (!item.start) return item.end ?? '';
  if (!list.labels.end) return item.start;
  return `${item.start} – ${item.end || list.ongoing}`;
}

function formHtml() {
  return `
  <div class="profile-cover" aria-hidden="true"><span class="profile-cover-initials" id="profile-cover-initials"></span></div>
  <div class="profile-photo">
    <div class="profile-avatar-wrap">
      <span id="profile-avatar"></span>
      <label class="profile-photo-button" for="photo-input" title="Trocar foto">${icon('camera')}<span class="sr-only">Trocar foto</span></label>
      <input type="file" id="photo-input" accept="image/jpeg,image/png,image/webp" class="sr-only" />
    </div>
    <button type="button" class="btn-link is-danger" id="photo-remove">Remover foto</button>
  </div>

  <form id="form-profile" novalidate>
    <div class="alert form-alert" role="alert" hidden></div>
    <div class="form-grid cols-2">
    <div class="field">
      <label class="label" for="profile-nickname">Me chame de…</label>
      <input class="input" id="profile-nickname" name="nickname" type="text" maxlength="40" placeholder="Como prefere ser chamado(a)" />
      <span class="field-error"></span>
    </div>
    <div class="field">
      <label class="label" for="profile-username">Nome de usuário</label>
      <div class="input-prefix">
        <span aria-hidden="true">@</span>
        <input class="input" id="profile-username" name="username" type="text" maxlength="30" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="ana.souza" />
      </div>
      <span class="field-hint">Dá para entrar com ele no lugar do e-mail. Letras sem acento, números, ponto ou _.</span>
      <span class="field-error"></span>
    </div>
    </div>
    <div class="form-grid cols-2">
    <div class="field">
      <label class="label" for="profile-bio">Mini bio</label>
      <textarea class="textarea" id="profile-bio" name="bio" maxlength="${BIO_MAX}" rows="3" placeholder="Conte em poucas palavras sobre você"></textarea>
      <span class="field-hint char-count" id="profile-bio-count" aria-live="polite"></span>
      <span class="field-error"></span>
    </div>
    <div class="field">
      <label class="label" for="profile-lattes">Link do Currículo Lattes</label>
      <input class="input" id="profile-lattes" name="lattesUrl" type="url" inputmode="url" maxlength="200" placeholder="http://lattes.cnpq.br/0000000000000000" />
      <span class="field-hint">Endereço completo do seu currículo na Plataforma Lattes.</span>
      <span class="field-error"></span>
    </div>
    </div>

    <div class="profile-lists">
    ${LISTS.map(
      (list) => `
    <section class="profile-list" data-list="${list.key}" aria-labelledby="list-${list.key}-title">
      <h3 class="profile-list-title" id="list-${list.key}-title">${list.title}</h3>
      <ul class="profile-items"></ul>
      <button type="button" class="btn-link" data-add="${list.key}">${icon('plus')}${list.add}</button>
    </section>`,
    ).join('')}
    </div>

    <button type="submit" class="btn btn-primary btn-block">Salvar alterações</button>
  </form>`;
}

const ITEM_DIALOG = {
  id: 'modal-profile-item',
  formId: 'form-profile-item',
  title: 'Adicionar',
  body: `
    <div class="field">
      <label class="label" for="item-title"></label>
      <input class="input" id="item-title" name="title" type="text" maxlength="${TEXT_MAX}" required />
      <span class="field-error"></span>
    </div>
    <div class="field">
      <label class="label" for="item-place"></label>
      <input class="input" id="item-place" name="place" type="text" maxlength="${TEXT_MAX}" />
      <span class="field-error"></span>
    </div>
    <div class="form-row">
      <div class="field">
        <label class="label" for="item-start"></label>
        <input class="input" id="item-start" name="start" type="text" inputmode="numeric" maxlength="4" placeholder="AAAA" />
        <span class="field-error"></span>
      </div>
      <div class="field" id="item-end-field">
        <label class="label" for="item-end"></label>
        <input class="input" id="item-end" name="end" type="text" inputmode="numeric" maxlength="4" placeholder="AAAA" />
        <span class="field-hint" id="item-end-hint"></span>
        <span class="field-error"></span>
      </div>
    </div>`,
  footer: `
    <button type="button" class="btn btn-secondary" data-close>Cancelar</button>
    <button type="submit" class="btn btn-primary">Salvar</button>`,
};

// Foto: sem Cloud Storage (pago em projetos novos), fica no próprio perfil,
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

// Item vindo do banco: só os campos conhecidos, em texto
const cleanItem = (item) => ({
  title: String(item?.title ?? '').slice(0, TEXT_MAX),
  place: String(item?.place ?? '').slice(0, TEXT_MAX),
  start: String(item?.start ?? ''),
  end: String(item?.end ?? ''),
});

export default {
  hash: 'perfil',

  render(container, ctx) {
    const { user, profile } = ctx;
    container.innerHTML = formHtml();
    const $ = (selector) => container.querySelector(selector);
    const form = $('#form-profile');
    const submit = form.querySelector('[type=submit]');
    clearErrorsWhileTyping(form);

    // Listas em memória até salvar
    const lists = Object.fromEntries(LISTS.map((l) => [l.key, (profile.about?.[l.key] ?? []).map(cleanItem)]));

    // ---------- Capa, foto e iniciais ----------
    function renderIdentity() {
      $('#profile-cover-initials').textContent = initials(profile.name);
      $('#profile-avatar').innerHTML = avatarHtml(profile, 'avatar profile-avatar');
      $('#photo-remove').hidden = !profile.photoURL;
    }
    renderIdentity();

    async function savePhoto(photoURL) {
      await updateDoc(ctx.userRef, { photoURL, updatedAt: serverTimestamp() });
      profile.photoURL = photoURL;
      await syncMemberCards(user.uid, profile);
      renderIdentity();
      ctx.changed();
    }

    $('#photo-input').addEventListener('change', async (event) => {
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

    $('#photo-remove').addEventListener('click', async () => {
      try {
        await savePhoto(null);
        toast('Foto removida.', 'success');
      } catch (error) {
        toast(firebaseErrorMessage(error), 'error');
      }
    });

    // ---------- Campos ----------
    const bioCount = $('#profile-bio-count');
    const updateBioCount = () => (bioCount.textContent = `${form.bio.value.length}/${BIO_MAX}`);
    form.bio.addEventListener('input', updateBioCount);

    form.nickname.value = profile.about?.nickname ?? '';
    form.username.value = profile.username ?? '';
    form.bio.value = profile.about?.bio ?? '';
    form.lattesUrl.value = profile.about?.lattesUrl ?? '';
    updateBioCount();

    // ---------- Listas ----------
    function renderList(list) {
      const section = container.querySelector(`[data-list="${list.key}"]`);
      const items = lists[list.key];
      section.querySelector('.profile-items').innerHTML = items
        .map(
          (item, index) => `
        <li class="profile-item">
          <div>
            <strong>${escapeHtml(item.title)}</strong>
            <span>${escapeHtml([item.place, period(item, list)].filter(Boolean).join(' · '))}</span>
          </div>
          <div class="profile-item-actions">
            <button type="button" class="btn-icon" data-edit="${index}" aria-label="Editar ${escapeHtml(item.title)}" title="Editar">${icon('edit')}</button>
            <button type="button" class="btn-icon is-danger" data-remove="${index}" aria-label="Remover ${escapeHtml(item.title)}" title="Remover">${icon('trash')}</button>
          </div>
        </li>`,
        )
        .join('');
      section.querySelector('[data-add]').hidden = items.length >= LIST_MAX;
    }
    LISTS.forEach(renderList);

    const snapshot = () => JSON.stringify([[...new FormData(form)], lists]);
    const changes = trackChanges(form, submit, snapshot);

    // Modal de item (o mesmo para todas as listas)
    const dialog = createDialog(ITEM_DIALOG);
    const itemForm = dialog.querySelector('#form-profile-item');
    clearErrorsWhileTyping(itemForm);
    let editing = null; // { list, index } (index null = novo)

    function openItem(list, index = null) {
      editing = { list, index };
      const item = index === null ? cleanItem({}) : lists[list.key][index];
      itemForm.reset();
      clearFormErrors(itemForm);
      dialog.querySelector('h2').textContent = index === null ? list.add : `Editar ${list.labels.title.toLowerCase()}`;
      ['title', 'place', 'start', 'end'].forEach((name) => {
        const label = list.labels[name];
        dialog.querySelector(`label[for="item-${name}"]`).textContent = label ?? '';
        itemForm[name].value = item[name] ?? '';
      });
      dialog.querySelector('#item-end-field').hidden = !list.labels.end;
      dialog.querySelector('#item-end-hint').textContent = list.ongoing ? `Deixe em branco se está ${list.ongoing === 'atual' ? 'lá até hoje' : 'em andamento'}.` : '';
      dialog.showModal();
      itemForm.title.focus();
    }

    itemForm.addEventListener('submit', (event) => {
      event.preventDefault();
      clearFormErrors(itemForm);
      const { list, index } = editing;
      const value = (name) => itemForm[name].value.trim().replace(/\s+/g, ' ');
      const item = { title: value('title'), place: value('place'), start: value('start'), end: list.labels.end ? value('end') : '' };

      const errors = [];
      if (item.title.length < 2) errors.push([itemForm.title, `Informe ${list.labels.title.toLowerCase()}.`]);
      if (item.start && !YEAR.test(item.start)) errors.push([itemForm.start, 'Use o ano com 4 dígitos.']);
      if (item.end && !YEAR.test(item.end)) errors.push([itemForm.end, 'Use o ano com 4 dígitos.']);
      else if (item.start && item.end && Number(item.end) < Number(item.start)) errors.push([itemForm.end, 'Não pode ser antes do início.']);
      if (showErrors(errors)) return;

      if (index === null) lists[list.key].push(item);
      else lists[list.key][index] = item;
      renderList(list);
      changes.update();
      dialog.close();
    });

    form.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-add], [data-edit], [data-remove]');
      if (!button) return;
      const list = LISTS.find((l) => l.key === (button.dataset.add ?? button.closest('[data-list]').dataset.list));
      if (button.dataset.add) return openItem(list);
      if (button.dataset.edit) return openItem(list, Number(button.dataset.edit));
      const item = lists[list.key][Number(button.dataset.remove)];
      const ok = await confirmDialog({
        title: 'Remover item?',
        message: `"${item.title}" sai da lista quando você salvar as alterações.`,
        confirmText: 'Remover',
        danger: true,
      });
      if (!ok) return;
      lists[list.key].splice(Number(button.dataset.remove), 1);
      renderList(list);
      changes.update();
    });

    // ---------- Salvar ----------
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearFormErrors(form);
      const nickname = form.nickname.value.trim().replace(/\s+/g, ' ');
      const username = form.username.value.trim().replace(/^@/, '').toLowerCase();
      const bio = form.bio.value.trim();
      const lattesUrl = form.lattesUrl.value.trim();

      const errors = [];
      if (username && !/^[a-z0-9._]{3,30}$/.test(username)) {
        errors.push([form.username, 'Use de 3 a 30 caracteres: letras sem acento, números, ponto ou _.']);
      }
      if (bio.length > BIO_MAX) errors.push([form.bio, `Use no máximo ${BIO_MAX} caracteres.`]);
      if (lattesUrl && !isValidUrl(lattesUrl)) errors.push([form.lattesUrl, 'Informe o endereço completo, começando com http:// ou https://.']);
      if (showErrors(errors)) return;

      changes.setBusy(true);
      setLoading(submit, true);
      try {
        // O nome de usuário é conferido (e reservado) no serviço de contas; aqui fica só a cópia
        let savedUsername = profile.username ?? null;
        if (username !== (profile.username ?? '')) {
          try {
            savedUsername = await changeUsername(username);
          } catch (error) {
            setFieldError(form.username, firebaseErrorMessage(error));
            form.username.focus();
            return;
          }
        }
        const about = {
          nickname: nickname || null,
          bio: bio || null,
          lattesUrl: lattesUrl || null,
          ...Object.fromEntries(LISTS.map((l) => [l.key, lists[l.key]])),
        };
        await updateDoc(ctx.userRef, { username: savedUsername, about, updatedAt: serverTimestamp() });
        profile.username = savedUsername;
        profile.about = about;
        form.username.value = savedUsername ?? '';
        changes.reset();
        ctx.changed();
        toast('Perfil salvo.', 'success');
      } catch (error) {
        showFormAlert(form, firebaseErrorMessage(error));
      } finally {
        setLoading(submit, false);
        changes.setBusy(false);
      }
    });

    // O nome pode ter mudado em Informações da conta
    return { onShow: renderIdentity };
  },
};
