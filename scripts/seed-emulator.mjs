// Preenche os EMULADORES locais com dados de teste.
// Uso (com os emuladores rodando):  node scripts/seed-emulator.mjs
// Não funciona no projeto real: só fala com localhost.

const PROJECT_ID = 'demo-escalamed';
const AUTH_URL = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const FIRESTORE_URL = `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// Unidades de exemplo (nomes fictícios)
const HEALTH_UNITS = [
  { id: 'hosp-municipal-central-ce', name: 'Hospital Municipal Central', city: 'Fortaleza', state: 'CE' },
  { id: 'upa-24h-centro-ce', name: 'UPA 24h Centro', city: 'Fortaleza', state: 'CE' },
  { id: 'clinica-vida-saude-ce', name: 'Clínica Vida & Saúde', city: 'Fortaleza', state: 'CE' },
  { id: 'hosp-sao-lucas-sp', name: 'Hospital São Lucas', city: 'São Paulo', state: 'SP' },
  { id: 'hosp-santa-clara-rj', name: 'Hospital Santa Clara', city: 'Rio de Janeiro', state: 'RJ' },
  { id: 'ps-regional-mg', name: 'Pronto-Socorro Regional', city: 'Belo Horizonte', state: 'MG' },
  { id: 'hosp-crianca-pe', name: 'Hospital da Criança', city: 'Recife', state: 'PE' },
  { id: 'maternidade-esperanca-ba', name: 'Maternidade Esperança', city: 'Salvador', state: 'BA' },
  { id: 'policlinica-norte-am', name: 'Policlínica Norte', city: 'Manaus', state: 'AM' },
  { id: 'hosp-universitario-rs', name: 'Hospital Universitário', city: 'Porto Alegre', state: 'RS' },
];

// Usuários de teste (senha igual para todos)
const PASSWORD = 'Teste@123';
const USERS = [
  { email: 'gestor@teste.com', name: 'Ana Gestora', categoryId: 'enfermeiro' },
  { email: 'plantonista@teste.com', name: 'Bruno Plantonista', categoryId: 'medico' },
];

// Mesmo critério de busca usado no app: minúsculas e sem acento
const normalize = (text) =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Converte um objeto JS para o formato de campos da API REST do Firestore
function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'object') return { mapValue: { fields: toFields(v) } };
  return { stringValue: String(v) };
}

function toFields(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, toValue(v)]));
}

async function setDoc(path, data) {
  // "Bearer owner" ignora as regras de segurança; só existe no emulador
  const res = await fetch(`${FIRESTORE_URL}/${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: toFields(data) }),
  });
  if (!res.ok) throw new Error(`Falha ao gravar ${path}: ${await res.text()}`);
}

async function authRequest(endpoint, body) {
  const res = await fetch(`${AUTH_URL}/${endpoint}?key=fake-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function ensureUser({ email, name }) {
  let data = await authRequest('accounts:signUp', { email, password: PASSWORD, returnSecureToken: true });
  if (data.error?.message === 'EMAIL_EXISTS') {
    data = await authRequest('accounts:signInWithPassword', { email, password: PASSWORD, returnSecureToken: true });
  }
  if (data.error) throw new Error(`Falha ao criar ${email}: ${data.error.message}`);
  await authRequest('accounts:update', { idToken: data.idToken, displayName: name });
  return data.localId;
}

async function main() {
  const now = new Date();

  for (const unit of HEALTH_UNITS) {
    const { id, ...rest } = unit;
    await setDoc(`healthUnits/${id}`, {
      ...rest,
      nameLower: normalize(unit.name),
      cityLower: normalize(unit.city),
      // palavras do nome e da cidade, para buscar por qualquer uma delas
      keywords: [...new Set(normalize(`${unit.name} ${unit.city}`).split(/[^a-z0-9]+/).filter((w) => w.length >= 2))],
      createdBy: 'seed',
      createdAt: now,
    });
  }
  console.log(`✔ ${HEALTH_UNITS.length} unidades de saúde`);

  for (const user of USERS) {
    const uid = await ensureUser(user);
    await setDoc(`users/${uid}`, {
      name: user.name,
      nameLower: normalize(user.name),
      photoURL: null,
      username: null,
      categoryId: user.categoryId,
      searchKeywords: normalize(user.name).split(/\s+/),
      createdAt: now,
      updatedAt: now,
    });
    await setDoc(`users/${uid}/private/data`, { email: user.email, phone: null, cpf: null, state: null, updatedAt: now });
    console.log(`✔ usuário ${user.email} (senha ${PASSWORD})`);
  }
}

main().catch((err) => {
  console.error('✖', err.message);
  console.error('Os emuladores estão rodando? Use: firebase emulators:start');
  process.exit(1);
});
