// Peças usadas por várias seções das Configurações.
import { icon } from '../icons.js';
import { setFieldError, showFormAlert, firebaseErrorMessage } from '../ui.js';

// Mostra o erro nos campos e foca o primeiro. Devolve true se havia erro.
export function showErrors(errors) {
  errors.forEach(([input, message]) => setFieldError(input, message));
  errors[0]?.[0].focus();
  return errors.length > 0;
}

// Senha errada aparece no campo da senha; o resto, no alerta do formulário
export function handleAuthError(form, error, passwordInput) {
  const message = firebaseErrorMessage(error);
  if (!message) return; // fechou a janela do Google
  if (['auth/wrong-password', 'auth/invalid-credential'].includes(error.code)) {
    setFieldError(passwordInput, 'Senha incorreta.');
    passwordInput.focus();
  } else {
    showFormAlert(form, message);
  }
}

// "Salvar" só fica habilitado quando algo mudou. snapshot(): texto com o estado do
// formulário (padrão: os campos). Depois de salvar, chame reset().
export function trackChanges(form, button, snapshot = () => JSON.stringify([...new FormData(form)])) {
  let saved = snapshot();
  let busy = false;
  const update = () => {
    if (!busy) button.disabled = snapshot() === saved;
  };
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  update();
  return {
    update,
    reset() {
      saved = snapshot();
      update();
    },
    // Durante o salvamento o botão fica desabilitado (setLoading cuida disso)
    setBusy(value) {
      busy = value;
      if (!value) update();
    },
  };
}

// Campo que parece um input, mas abre outra tela (seta ">" à direita)
export function rowLinkHtml({ id, label, value = '', placeholder = 'Selecionar' }) {
  return `<button type="button" class="row-link" id="${id}" aria-label="${label}">
    <span class="row-link-value" data-placeholder="${placeholder}">${value}</span>${icon('chevronRight')}
  </button>`;
}

// Mostra o texto no campo-linha (ou o placeholder, em cinza)
export function setRowLink(button, text) {
  const value = button.querySelector('.row-link-value');
  value.textContent = text || value.dataset.placeholder;
  value.classList.toggle('is-placeholder', !text);
}

const closeButton = `<button type="button" class="btn-icon" data-close aria-label="Fechar">${icon('x')}</button>`;

// Cria um <dialog> no fim da página (fecha no X, no Esc e no fundo escurecido).
// formId: o conteúdo fica dentro de um <form> (o botão de enviar pode ir no rodapé).
export function createDialog({ id, title, body, footer = '', className = '', formId = '' }) {
  const content = `
      <div class="dialog-header"><h2 id="${id}-title">${title}</h2>${closeButton}</div>
      <div class="dialog-body">${body}</div>
      ${footer ? `<div class="dialog-footer">${footer}</div>` : ''}`;
  document.body.insertAdjacentHTML(
    'beforeend',
    `<dialog class="modal ${className}" id="${id}" aria-labelledby="${id}-title">
      ${formId ? `<form id="${formId}" novalidate>${content}</form>` : content}
    </dialog>`,
  );
  const dialog = document.getElementById(id);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  return dialog;
}
