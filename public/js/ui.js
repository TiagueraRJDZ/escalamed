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

// Traduz os erros do Firebase para mensagens em português.
// Devolve null quando o erro não precisa ser mostrado (ex.: usuário fechou a janela).
export function firebaseErrorMessage(error) {
  const code = error?.code ?? '';
  const messages = {
    'auth/invalid-credential': 'E-mail ou senha incorretos.',
    'auth/wrong-password': 'E-mail ou senha incorretos.',
    'auth/user-not-found': 'E-mail ou senha incorretos.',
    'auth/invalid-email': 'E-mail inválido.',
    'auth/email-already-in-use': 'Este e-mail já está cadastrado. Tente entrar.',
    'auth/weak-password': 'Senha fraca. Use pelo menos 8 caracteres com letras, números e símbolos.',
    'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
    'auth/network-request-failed': 'Sem conexão. Verifique sua internet e tente de novo.',
    'auth/user-disabled': 'Esta conta foi desativada.',
    'auth/account-exists-with-different-credential':
      'Já existe uma conta com este e-mail. Entre com e-mail e senha.',
    'auth/operation-not-allowed': 'Este método de login não está ativado no Firebase.',
    'auth/unauthorized-domain': 'Este endereço não está autorizado no Firebase.',
    'permission-denied': 'Você não tem permissão para fazer isso.',
    unavailable: 'Sem conexão com o servidor. Tente de novo em instantes.',
  };
  if (['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled'].includes(code)) {
    return null;
  }
  if (!messages[code]) console.error(error);
  return messages[code] ?? 'Não foi possível concluir. Tente novamente.';
}
