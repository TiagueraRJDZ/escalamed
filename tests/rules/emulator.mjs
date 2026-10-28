// Acesso aos emuladores (Auth e Firestore) pela API REST, sem dependências.
// Usado só pelos testes das regras.

// O "firebase emulators:exec" informa projeto e portas por estas variáveis
export const PROJECT = process.env.GCLOUD_PROJECT || 'demo-escalamed-test';
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9199'}`;
const FS_HOST = `http://${process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8180'}`;
const DB = `projects/${PROJECT}/databases/(default)`;
const DOCS = `${FS_HOST}/v1/${DB}/documents`;

// ---------- Conversão de valores ----------
function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'object') return { mapValue: { fields: toFields(v) } };
  return { stringValue: String(v) };
}

const toFields = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, toValue(v)]));

// Valor especial: hora do servidor (para campos que as regras exigem == request.time)
export const NOW = Symbol('serverTime');

function splitServerTime(data) {
  const plain = {};
  const times = [];
  for (const [k, v] of Object.entries(data)) {
    if (v === NOW) times.push(k);
    else plain[k] = v;
  }
  return { plain, transforms: times.map((fieldPath) => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })) };
}

// ---------- Escritas (formato do :commit) ----------
const name = (path) => `${DB}/documents/${path}`;

export const w = {
  // Cria (ou substitui) o documento inteiro
  set(path, data) {
    const { plain, transforms } = splitServerTime(data);
    return { update: { name: name(path), fields: toFields(plain) }, updateTransforms: transforms };
  },
  // Altera só os campos informados; o documento precisa existir
  update(path, data) {
    const { plain, transforms } = splitServerTime(data);
    return {
      update: { name: name(path), fields: toFields(plain) },
      updateMask: { fieldPaths: Object.keys(plain).map((k) => (/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(k) ? k : `\`${k}\``)) },
      updateTransforms: transforms,
      currentDocument: { exists: true },
    };
  },
  delete(path) {
    return { delete: name(path) };
  },
};

const headers = (token) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? 'owner'}` });

// Lote atômico. Devolve true se as regras deixaram.
export async function commit(token, writes) {
  const res = await fetch(`${DOCS}:commit`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ writes }),
  });
  if (res.ok) return true;
  const body = await res.json().catch(() => ({}));
  if (body.error?.status !== 'PERMISSION_DENIED') throw new Error(`Erro inesperado: ${JSON.stringify(body)}`);
  return false;
}

// Escrita sem regras ("owner" só existe no emulador): monta os cenários
export const admin = (writes) => commit('owner', writes);

// Leitura. Devolve true se as regras deixaram (mesmo que o documento não exista).
export async function canRead(token, path) {
  const res = await fetch(`${DOCS}/${path}`, { headers: headers(token) });
  if (res.status === 403) return false;
  if (res.ok || res.status === 404) return true;
  throw new Error(`Erro inesperado: ${res.status} ${await res.text()}`);
}

// Consulta em todas as subcoleções com este nome (collectionGroup)
export async function canQueryGroup(token, collectionId, field, value) {
  const res = await fetch(`${DOCS}:runQuery`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId, allDescendants: true }],
        where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: toValue(value) } },
      },
    }),
  });
  if (res.status === 403) return false;
  if (res.ok) return true;
  throw new Error(`Erro inesperado: ${res.status} ${await res.text()}`);
}

// ---------- Limpeza ----------
export async function clearFirestore() {
  await fetch(`${FS_HOST}/emulator/v1/${DB}/documents`, { method: 'DELETE' });
}

export async function clearAuth() {
  await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
}

// ---------- Usuários ----------
async function authCall(endpoint, body, token) {
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/${endpoint}?key=fake-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) throw new Error(`${endpoint}: ${data.error.message}`);
  return data;
}

// Cria um usuário e devolve { uid, email, token } (token já com email_verified)
export async function createUser(email, { verified = true } = {}) {
  const password = 'Teste@123';
  const { localId } = await authCall('accounts:signUp', { email, password, returnSecureToken: true });
  if (verified) {
    await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`, {
      method: 'POST',
      headers: headers('owner'),
      body: JSON.stringify({ localId, emailVerified: true }),
    });
  }
  const { idToken } = await authCall('accounts:signInWithPassword', { email, password, returnSecureToken: true });
  return { uid: localId, email, token: idToken };
}
