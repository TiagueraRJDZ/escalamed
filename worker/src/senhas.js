/* =====================================================================
 * EscalaMed - validações do serviço de contas
 * Sem dependências: roda no Worker e no Node (testes em tests/worker.test.mjs).
 * ===================================================================== */

// Sem letras e números que se confundem (O/0, I/l/1). Com um "@" no fim para
// atender à regra de senha do app (letra, número e caractere especial).
const LETRAS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
const NUMEROS = '23456789';

const sortear = (texto, quantos) =>
  [...crypto.getRandomValues(new Uint32Array(quantos))].map((n) => texto[n % texto.length]).join('');

// Ex.: "kQmTzp47@" (6 letras, 2 números e @)
export function gerarSenhaProvisoria() {
  return `${sortear(LETRAS, 6)}${sortear(NUMEROS, 2)}@`;
}

export function emailValido(email) {
  const texto = String(email ?? '');
  return texto.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(texto);
}

// Nome de usuário: 3 a 30 caracteres, letras minúsculas sem acento, números, ponto e _.
// Não pode ser só números nem ter "@" (para não confundir com e-mail).
export function motivoUsuarioInvalido(usuario) {
  const texto = String(usuario ?? '');
  if (!/^[a-z0-9._]{3,30}$/.test(texto)) {
    return 'Use de 3 a 30 caracteres: letras sem acento, números, ponto ou _.';
  }
  if (/^\d+$/.test(texto)) return 'O nome de usuário não pode ter só números.';
  if (/^[.]|[.]$|\.\./.test(texto)) return 'O nome de usuário não pode começar ou terminar com ponto, nem ter dois pontos seguidos.';
  return '';
}
