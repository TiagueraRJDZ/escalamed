// Utilitários de interface: avisos, estado de carregamento e erros de formulário.

// Evita que texto digitado pelo usuário vire HTML
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Iniciais para avatar: "Ana Maria Souza" -> "AS"
export function initials(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

// Aviso rápido no canto da tela
export function toast(message, type = 'info', duration = 4000) {
  let area = document.querySelector('.toast-area');
  if (!area) {
    area = document.createElement('div');
    area.className = 'toast-area';
    area.setAttribute('role', 'status');
    area.setAttribute('aria-live', 'polite');
    document.body.append(area);
  }
  const el = document.createElement('div');
  el.className = `toast${type === 'info' ? '' : ` toast-${type}`}`;
  el.textContent = message;
  area.append(el);
  setTimeout(() => el.remove(), duration);
}

export function setLoading(button, loading) {
  button.disabled = loading;
  button.classList.toggle('is-loading', loading);
  button.setAttribute('aria-busy', String(loading));
}

// Mostra o erro abaixo do campo e marca o campo como inválido
export function setFieldError(input, message) {
  const field = input.closest('.field');
  const errorEl = field?.querySelector('.field-error');
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
  if (errorEl) {
    errorEl.textContent = message || '';
    if (!errorEl.id) errorEl.id = `${input.id || input.name}-error`;
    input.setAttribute('aria-describedby', errorEl.id);
  }
}

// Apaga o erro de um campo assim que a pessoa começa a corrigi-lo
export function clearErrorsWhileTyping(form) {
  const handler = (event) => {
    const el = event.target;
    // Em campos de texto, "change" também dispara ao perder o foco; só "input" conta
    const isChoice = el.tagName === 'SELECT' || ['checkbox', 'radio'].includes(el.type);
    if (event.type === 'change' && !isChoice) return;
    if (el.getAttribute?.('aria-invalid') === 'true') setFieldError(el, '');
  };
  form.addEventListener('input', handler);
  form.addEventListener('change', handler);
}

export function clearFormErrors(form) {
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.setAttribute('aria-invalid', 'false'));
  form.querySelectorAll('.field-error').forEach((el) => (el.textContent = ''));
  form.querySelectorAll('.form-alert').forEach((el) => {
    el.hidden = true;
    el.textContent = '';
  });
}

export function showFormAlert(form, message, type = 'error') {
  const el = form.querySelector('.form-alert');
  if (!el) return toast(message, type);
  el.className = `alert alert-${type} form-alert`;
  el.textContent = message;
  el.hidden = false;
}

// Menu suspenso acessível: abre/fecha no botão, fecha com Esc ou clique fora,
// setas para navegar entre os itens.
export function setupMenu(button, menu) {
  const items = () => [...menu.querySelectorAll('[role=menuitem]')];
  const setOpen = (open, { focusButton = false } = {}) => {
    menu.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) items()[0]?.focus();
    else if (focusButton) button.focus();
  };

  button.addEventListener('click', () => setOpen(menu.hidden));
  document.addEventListener('click', (event) => {
    if (!menu.hidden && !button.contains(event.target) && !menu.contains(event.target)) setOpen(false);
  });
  menu.addEventListener('keydown', (event) => {
    const list = items();
    const index = list.indexOf(document.activeElement);
    if (event.key === 'Escape') setOpen(false, { focusButton: true });
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      list[(index + 1) % list.length].focus();
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      list[(index - 1 + list.length) % list.length].focus();
    }
  });
  return { close: () => setOpen(false) };
}

// Janela de confirmação. Uso: if (await confirmDialog({ ... })) { ... }
export function confirmDialog({ title, message, confirmText = 'Confirmar', cancelText = 'Cancelar', danger = false }) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'modal';
    dialog.setAttribute('aria-labelledby', 'confirm-title');
    dialog.innerHTML = `
      <div class="dialog-header" style="border:0"><h2 id="confirm-title">${escapeHtml(title)}</h2></div>
      <div class="dialog-body"><p class="muted">${escapeHtml(message)}</p></div>
      <div class="dialog-footer">
        <button type="button" class="btn btn-secondary" value="cancel">${escapeHtml(cancelText)}</button>
        <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" value="confirm">${escapeHtml(confirmText)}</button>
      </div>`;
    document.body.append(dialog);

    let confirmed = false;
    dialog.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (button) {
        confirmed = button.value === 'confirm';
        dialog.close();
      } else if (event.target === dialog) {
        dialog.close();
      }
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(confirmed);
    });
    dialog.showModal();
    dialog.querySelector('[value=cancel]').focus();
  });
}

// Traduz os erros do Firebase para mensagens em português (lista em auth-errors.js).
// Devolve null quando o erro não precisa ser mostrado (ex.: usuário fechou a janela).
export { errorMessage as firebaseErrorMessage } from './auth-errors.js';
