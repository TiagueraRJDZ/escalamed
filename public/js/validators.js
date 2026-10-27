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
