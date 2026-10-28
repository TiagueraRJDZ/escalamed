// Mensagens em português para os erros do Firebase (login, cadastro e banco).
// Com a proteção contra enumeração de e-mails ativa, o Firebase devolve
// "auth/invalid-credential" tanto para e-mail inexistente quanto para senha errada.
export const ERROR_MESSAGES = {
  'auth/invalid-credential': 'E-mail ou senha inválidos.',
  'auth/wrong-password': 'Senha incorreta.',
  'auth/user-not-found': 'E-mail ou senha inválidos.',
  'auth/invalid-email': 'E-mail inválido.',
  'auth/missing-password': 'Informe a senha.',
  'auth/email-already-in-use': 'Este e-mail já possui conta. Entre ou recupere a senha.',
  'auth/weak-password': 'Senha fraca. Use pelo menos 8 caracteres com letras, números e símbolos.',
  'auth/too-many-requests': 'Acesso bloqueado por muitas tentativas com senha errada. Peça uma senha provisória ao gestor do seu grupo.',
  'auth/network-request-failed': 'Sem conexão. Verifique sua internet e tente de novo.',
  'auth/user-disabled': 'Esta conta foi desativada.',
  'auth/requires-recent-login': 'Por segurança, confirme sua senha e tente de novo.',
  'auth/operation-not-allowed': 'Este método de login não está ativado no Firebase.',
  'auth/unauthorized-domain': 'Este endereço não está autorizado no Firebase.',
  'auth/unauthorized-continue-uri': 'Este endereço não está autorizado no Firebase.',
  'auth/firebase-app-check-token-is-invalid': 'Não foi possível confirmar que você não é um robô. Recarregue a página.',
  'permission-denied': 'Você não tem permissão para fazer isso.',
  unavailable: 'Sem conexão com o servidor. Tente de novo em instantes.',
};

// Erros que não precisam aparecer (ex.: a pessoa fechou uma janela)
const SILENT = ['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled'];

export function errorMessage(error) {
  // Erros do serviço de contas já vêm com a mensagem em português
  if (error?.name === 'AuthApiError' || error?.constructor?.name === 'AuthApiError') return error.message;
  const code = error?.code ?? '';
  if (SILENT.includes(code)) return null;
  if (!ERROR_MESSAGES[code]) console.error(error);
  return ERROR_MESSAGES[code] ?? 'Não foi possível concluir. Tente novamente.';
}
