// Validações e normalização de texto usadas nos formulários.

// Minúsculas e sem acento: usado nas buscas ("São Paulo" -> "sao paulo")
export function normalize(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

// Palavras usadas nas buscas (pessoas, unidades): cada palavra dos textos, sem repetir
export function searchKeywords(...texts) {
  const words = texts.flatMap((t) => normalize(t).split(/[^a-z0-9]+/)).filter((w) => w.length >= 2);
  return [...new Set(words)].slice(0, 30);
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email).trim());
}

// Regras de senha: mínimo 8 caracteres, com letras, números e caracteres especiais
export const PASSWORD_RULES = [
  { id: 'length', label: 'Pelo menos 8 caracteres', test: (p) => p.length >= 8 },
  { id: 'letter', label: 'Uma letra', test: (p) => /\p{L}/u.test(p) },
  { id: 'number', label: 'Um número', test: (p) => /\d/.test(p) },
  { id: 'special', label: 'Um caractere especial (!@#$…)', test: (p) => /[^\p{L}\d\s]/u.test(p) },
];

export function isStrongPassword(password) {
  return PASSWORD_RULES.every((rule) => rule.test(password));
}

export function isValidName(name) {
  const clean = String(name).trim();
  return clean.length >= 3 && clean.length <= 80 && /\p{L}/u.test(clean);
}

// Só os dígitos: "(85) 99999-0000" -> "85999990000"
export const onlyDigits = (value) => String(value ?? '').replace(/\D/g, '');

// Máscara de telefone enquanto digita: (99) 9999-9999 ou (99) 99999-9999
export function formatPhone(value) {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

// Fixo (10 dígitos) ou celular (11 dígitos, começando com 9), com DDD válido
export function isValidPhone(value) {
  const d = onlyDigits(value);
  if (!/^[1-9][1-9]/.test(d)) return false;
  return d.length === 10 || (d.length === 11 && d[2] === '9');
}

// Máscara de CPF: 999.999.999-99
export function formatCPF(value) {
  const d = onlyDigits(value).slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1-$2');
}

// CPF com dígitos verificadores
export function isValidCPF(value) {
  const cpf = String(value).replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (len) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}
