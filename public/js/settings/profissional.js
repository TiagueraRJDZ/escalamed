// Configurações > Informações profissionais: profissão (seletor com busca), especialidade
// e registro no conselho. Os gestores dos grupos veem estes dados no cartão de membro.
import { updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { PROFESSIONAL_CATEGORIES, SPECIALTIES, getCategory } from '/data/categories.js';
import { STATES } from '/data/states.js';
import { icon } from '../icons.js';
import { normalize } from '../validators.js';
import { syncMemberCards } from '../members.js';
import { escapeHtml, toast, setLoading, clearFormErrors, clearErrorsWhileTyping, showFormAlert, firebaseErrorMessage, setFieldError } from '../ui.js';
import { showErrors, trackChanges, rowLinkHtml, setRowLink, createDialog } from './shared.js';

function formHtml() {
  return `
  <form id="form-professional" novalidate>
    <div class="alert form-alert" role="alert" hidden></div>
    <div class="form-grid cols-2">
    <div class="field">
      <span class="label">Profissão</span>
      ${rowLinkHtml({ id: 'pro-category-button', label: 'Escolher profissão' })}
      <input type="hidden" name="categoryId" id="pro-category" />
      <span class="field-error"></span>
    </div>
    <div class="field" id="pro-specialty-field" hidden>
      <label class="label" for="pro-specialty">Especialidade</label>
      <input class="input" id="pro-specialty" name="specialty" type="text" maxlength="80" list="pro-specialties" placeholder="Ex.: Clínico Geral" />
      <datalist id="pro-specialties">${SPECIALTIES.map((s) => `<option value="${s}"></option>`).join('')}</datalist>
      <span class="field-error"></span>
    </div>
    </div>
    <div class="form-grid cols-2" id="pro-council-fields" hidden>
      <div class="field">
        <label class="label" for="pro-council-number" id="pro-council-label">Registro no conselho</label>
        <input class="input" id="pro-council-number" name="councilNumber" type="text" inputmode="numeric" maxlength="20" />
        <span class="field-error"></span>
      </div>
      <div class="field">
        <label class="label" for="pro-council-state">UF do registro</label>
        <select class="select" id="pro-council-state" name="councilState">
          <option value="">UF</option>${STATES.map((s) => `<option value="${s.uf}">${s.uf}</option>`).join('')}
        </select>
        <span class="field-error"></span>
      </div>
    </div>
    <p class="field-hint">Os gestores dos seus grupos veem estas informações no seu cartão de membro.</p>
    <button type="submit" class="btn btn-primary btn-block">Salvar</button>
  </form>`;
}

const PICKER_DIALOG = {
  id: 'modal-profession',
  title: 'Profissão',
  className: 'picker-modal',
  body: `
    <div class="input-icon picker-search">
      ${icon('search')}
      <input class="input" id="profession-search" type="search" placeholder="Buscar profissão" aria-label="Buscar profissão" autocomplete="off" />
    </div>
    <ul class="picker-list" id="profession-list" role="listbox" aria-label="Profissões"></ul>
    <p class="muted picker-empty" id="profession-empty" hidden>Nenhuma profissão encontrada.</p>`,
};

export default {
  hash: 'profissional',

  render(container, ctx) {
    const { user, profile } = ctx;
    container.innerHTML = formHtml();
    const form = container.querySelector('#form-professional');
    const submit = form.querySelector('[type=submit]');
    const categoryButton = container.querySelector('#pro-category-button');
    clearErrorsWhileTyping(form);

    function updateFields() {
      const category = getCategory(form.categoryId.value);
      setRowLink(categoryButton, category?.name ?? '');
      container.querySelector('#pro-specialty-field').hidden = !category?.specialty;
      container.querySelector('#pro-council-fields').hidden = !category?.council;
      if (category?.council) {
        const optional = category.councilRequired ? '' : ' <span class="field-hint">(opcional)</span>';
        container.querySelector('#pro-council-label').innerHTML = `Nº do ${category.council}${optional}`;
      }
    }

    form.categoryId.value = profile.categoryId ?? '';
    form.specialty.value = profile.specialty ?? '';
    form.councilNumber.value = profile.council?.number ?? '';
    form.councilState.value = profile.council?.state ?? '';
    updateFields();
    const changes = trackChanges(form, submit);

    // ---------- Seletor de profissão (modal com busca) ----------
    const dialog = createDialog(PICKER_DIALOG);
    const search = dialog.querySelector('#profession-search');
    const list = dialog.querySelector('#profession-list');

    function renderOptions() {
      const term = normalize(search.value);
      const shown = PROFESSIONAL_CATEGORIES.filter((c) => !term || normalize(c.name).includes(term));
      list.innerHTML = shown
        .map((c) => {
          const selected = c.id === form.categoryId.value;
          return `<li><button type="button" class="picker-option" role="option" aria-selected="${selected}" data-id="${c.id}">
            <span>${escapeHtml(c.name)}</span>${selected ? icon('check') : ''}</button></li>`;
        })
        .join('');
      dialog.querySelector('#profession-empty').hidden = shown.length > 0;
    }

    categoryButton.addEventListener('click', () => {
      search.value = '';
      renderOptions();
      dialog.showModal();
      search.focus();
    });
    search.addEventListener('input', renderOptions);
    // Enter na busca escolhe a primeira opção
    search.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      list.querySelector('.picker-option')?.click();
    });
    list.addEventListener('click', (event) => {
      const option = event.target.closest('.picker-option');
      if (!option) return;
      form.categoryId.value = option.dataset.id;
      setFieldError(categoryButton, '');
      updateFields();
      changes.update();
      dialog.close();
      categoryButton.focus();
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearFormErrors(form);
      const category = getCategory(form.categoryId.value);
      const specialty = category?.specialty ? form.specialty.value.trim().replace(/\s+/g, ' ') : '';
      const number = category?.council ? form.councilNumber.value.trim().toUpperCase() : '';
      const councilState = category?.council ? form.councilState.value : '';

      const errors = [];
      if (!category) errors.push([categoryButton, 'Escolha sua profissão.']);
      if (category?.councilRequired && !number) errors.push([form.councilNumber, `Informe o número do ${category.council}.`]);
      if (number && !/^[0-9A-Z.\-/]{1,20}$/.test(number)) errors.push([form.councilNumber, 'Use só números e letras.']);
      if (number && !councilState) errors.push([form.councilState, 'Escolha a UF.']);
      if (showErrors(errors)) return;

      changes.setBusy(true);
      setLoading(submit, true);
      try {
        const data = {
          categoryId: category.id,
          specialty: specialty || null,
          council: number ? { type: category.council, number, state: councilState } : null,
        };
        await updateDoc(ctx.userRef, { ...data, updatedAt: serverTimestamp() });
        Object.assign(profile, data);
        await syncMemberCards(user.uid, profile);
        ctx.changed();
        changes.reset();
        toast('Informações profissionais salvas.', 'success');
      } catch (error) {
        showFormAlert(form, firebaseErrorMessage(error));
      } finally {
        setLoading(submit, false);
        changes.setBusy(false);
      }
    });
  },
};
