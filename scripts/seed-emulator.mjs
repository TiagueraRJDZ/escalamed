// Preenche os EMULADORES locais com dados de teste.
// Uso (com os emuladores rodando):  node scripts/seed-emulator.mjs
// Não funciona no projeto real: só fala com localhost.

// Projeto e portas: os do firebase.json, ou os informados pelo "firebase emulators:exec".
// Só aceita projetos "demo-" (que não existem fora dos emuladores).
const PROJECT_ID = process.env.GCLOUD_PROJECT || 'demo-escalamed';
if (!PROJECT_ID.startsWith('demo-')) throw new Error(`Seed só roda em projetos demo-, não em "${PROJECT_ID}".`);
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const AUTH_URL = `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1`;
const FIRESTORE_URL = `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

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
  { id: 'hapvida-antonio-prudente-ce', name: 'HAPVIDA ANTONIO PRUDENTE', city: 'Fortaleza', state: 'CE' },
];

// Usuários de teste (senha igual para todos; nomes e registros fictícios)
// role = cargo no grupo de referência TELEAUDITORIA HAPVIDA (sem role = fora do grupo)
const PASSWORD = 'Teste@123';
const USERS = [
  { email: 'gestor@teste.com', name: 'Ana Gestora', categoryId: 'enfermeiro', council: ['COREN', '100200'], role: 'manager' },
  { email: 'auxiliar1@teste.com', name: 'Carla Auxiliar', categoryId: 'administrativo', role: 'assistant' },
  { email: 'auxiliar2@teste.com', name: 'Diego Auxiliar', categoryId: 'medico', specialty: 'Clínico Geral', council: ['CRM', '10001'], role: 'assistant' },
  { email: 'analista@teste.com', name: 'Elisa Analista', categoryId: 'administrativo', role: 'analyst' },
  { email: 'observador@teste.com', name: 'Fábio Observador', categoryId: 'administrativo', role: 'observer' },
  { email: 'plantonista@teste.com', name: 'Bruno Plantonista', categoryId: 'medico', specialty: 'Clínico Geral', council: ['CRM', '10002'], role: 'staff' },
  { email: 'plantonista2@teste.com', name: 'Gabriela Souza', categoryId: 'medico', specialty: 'Clínico Geral', council: ['CRM', '10003'], role: 'staff' },
  { email: 'plantonista3@teste.com', name: 'Henrique Lima', categoryId: 'medico', specialty: 'Medicina de Família', council: ['CRM', '10004'], role: 'staff' },
  { email: 'plantonista4@teste.com', name: 'Isabela Rocha', categoryId: 'medico', specialty: 'Pediatria', council: ['CRM', '10005'], role: 'staff' },
  { email: 'plantonista5@teste.com', name: 'João Pereira', categoryId: 'medico', specialty: 'Clínico Geral', council: ['CRM', '10006'], role: 'staff' },
  { email: 'plantonista6@teste.com', name: 'Larissa Mendes', categoryId: 'enfermeiro', council: ['COREN', '100300'], role: 'staff' },
  { email: 'plantonista7@teste.com', name: 'Marcos Alves', categoryId: 'tecnico-enfermagem', council: ['COREN', '100400'], role: 'staff' },
  { email: 'plantonista8@teste.com', name: 'Natália Costa', categoryId: 'medico', specialty: 'Emergência', council: ['CRM', '10007'], role: 'staff' },
  { email: 'novo@teste.com', name: 'Otávio Novo', categoryId: 'medico', specialty: 'Clínico Geral', council: ['CRM', '10008'] },
];

// Grupo de referência e seus turnos
const GROUP_ID = 'teleauditoria-hapvida';
const SHIFTS = [
  { id: 'm', title: 'M', start: '07:00', end: '13:00' },
  { id: 't', title: 'T', start: '13:00', end: '19:00' },
  { id: 'ref', title: 'REF', start: '16:00', end: '19:00' },
  { id: 'n', title: 'N', start: '19:00', end: '01:00' },
  { id: 'n1', title: 'N1', start: '19:00', end: '22:00' },
  { id: 'nf', title: 'NF', start: '22:00', end: '01:00' },
];
const toMinutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

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

// Cria (ou reaproveita) o usuário já com o e-mail confirmado
async function ensureUser({ email, name }) {
  let data = await authRequest('accounts:signUp', { email, password: PASSWORD, returnSecureToken: true });
  if (data.error?.message === 'EMAIL_EXISTS') {
    data = await authRequest('accounts:signInWithPassword', { email, password: PASSWORD, returnSecureToken: true });
  }
  if (data.error) throw new Error(`Falha ao criar ${email}: ${data.error.message}`);
  // "Bearer owner" age como administrador (só no emulador): confirma o e-mail
  await fetch(`${AUTH_URL}/projects/${PROJECT_ID}/accounts:update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ localId: data.localId, displayName: name, emailVerified: true }),
  });
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

  const ids = {};
  for (const user of USERS) {
    const uid = await ensureUser(user);
    ids[user.email] = uid;
    const council = user.council ? { type: user.council[0], number: user.council[1], state: 'CE' } : null;
    user.profile = {
      name: user.name,
      photoURL: null,
      categoryId: user.categoryId,
      specialty: user.specialty ?? null,
      council,
    };
    await setDoc(`users/${uid}`, {
      ...user.profile,
      nameLower: normalize(user.name),
      username: null,
      searchKeywords: normalize(user.name).split(/\s+/),
      signupStep: 4,
      termsAcceptedAt: now,
      termsVersion: '2026-10',
      createdAt: now,
      updatedAt: now,
    });
    await setDoc(`users/${uid}/private/data`, { email: user.email, phone: '85999990000', cpf: null, state: 'CE', updatedAt: now });
  }
  console.log(`✔ ${USERS.length} usuários (senha ${PASSWORD})`);

  // Grupo TELEAUDITORIA HAPVIDA com cargos variados
  const inGroup = USERS.filter((u) => u.role);
  const idsOf = (role) => inGroup.filter((u) => u.role === role).map((u) => ids[u.email]);
  const manager = inGroup.find((u) => u.role === 'manager');
  await setDoc(`groups/${GROUP_ID}`, {
    name: 'TELEAUDITORIA HAPVIDA',
    type: 'team',
    color: '#2563EB',
    unit: { id: 'hapvida-antonio-prudente-ce', name: 'HAPVIDA ANTONIO PRUDENTE', city: 'Fortaleza', state: 'CE' },
    categoryId: 'medico',
    timezone: 'America/Sao_Paulo',
    ownerId: ids[manager.email],
    memberIds: inGroup.map((u) => ids[u.email]),
    managerIds: idsOf('manager'),
    assistantIds: idsOf('assistant'),
    analystIds: idsOf('analyst'),
    observerIds: idsOf('observer'),
    setupStep: 'done',
    createdAt: now,
    updatedAt: now,
  });
  for (const user of inGroup) {
    await setDoc(`groups/${GROUP_ID}/members/${ids[user.email]}`, {
      ...user.profile,
      role: user.role,
      joinedAt: now,
      addedBy: ids[manager.email],
    });
  }
  for (const shift of SHIFTS) {
    await setDoc(`groups/${GROUP_ID}/shifts/${shift.id}`, {
      title: shift.title,
      startMinute: toMinutes(shift.start),
      endMinute: toMinutes(shift.end),
      createdAt: now,
      updatedAt: now,
    });
  }
  // Convite pendente para novo@teste.com
  await setDoc(`groups/${GROUP_ID}/invites/novo@teste.com`, {
    email: 'novo@teste.com',
    role: 'staff',
    groupName: 'TELEAUDITORIA HAPVIDA',
    unitName: 'HAPVIDA ANTONIO PRUDENTE',
    invitedBy: ids[manager.email],
    invitedByName: manager.name,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
  });
  console.log(`✔ grupo TELEAUDITORIA HAPVIDA: ${inGroup.length} membros, ${SHIFTS.length} turnos, 1 convite pendente (novo@teste.com)`);
}

main().catch((err) => {
  console.error('✖', err.message);
  console.error('Os emuladores estão rodando? Use: firebase emulators:start');
  process.exit(1);
});
