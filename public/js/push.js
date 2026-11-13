// Notificações push no celular: os avisos do sininho chegam no aparelho, mesmo com o app fechado.
// O navegador se inscreve no serviço de push dele (Google, Apple, Mozilla, Microsoft) e a
// inscrição vai para o serviço de contas (Worker, worker/src/push.js), que manda as mensagens.
//
// iPhone/iPad: o push só existe no app adicionado à Tela de Início (iOS 16.4 ou mais novo).
// No Safari comum, a gaveta de notificações ensina a adicionar.
//
// Escolha por conta e por aparelho (localStorage "escalamed:push:<uid>"): "1" ativado e
// "0" dispensado/desativado. Outra pessoa entrando no mesmo aparelho começa sem push.
import { vapidPublicKey } from './config.js';
import { callAccountService } from './auth-api.js';

const RESYNC_MS = 24 * 60 * 60 * 1000; // reconfirma a inscrição no Worker no máximo 1 vez por dia
const SYNC_KEY = 'escalamed:push-sync'; // { uid, endpoint, at } da última confirmação

const choiceKey = (uid) => `escalamed:push:${uid}`;

function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // aba anônima/sem armazenamento: só não lembra a escolha
  }
}

export const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// 'ok' | 'ios-install' (adicionar à Tela de Início) | 'ios-old' (iOS antigo) | 'unsupported'
export function pushSupport() {
  const ios = isIos();
  const hasApi = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (ios && !isStandalone()) return hasApi || 'serviceWorker' in navigator ? 'ios-install' : 'ios-old';
  if (!hasApi) return ios ? 'ios-old' : 'unsupported';
  return 'ok';
}

// O service worker é registrado em todas as telas internas (layout.js)
let registration = null;
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || registration) return registration;
  registration = navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error) => {
    console.warn('Notificações: o service worker não foi registrado.', error);
    registration = null;
    return null;
  });
  return registration;
}

async function readyRegistration() {
  const reg = await registerServiceWorker();
  if (!reg) throw new Error('Este navegador não deixou ativar as notificações.');
  return navigator.serviceWorker.ready;
}

function vapidBytes() {
  const base64 = vapidPublicKey.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

// A inscrição do navegador foi feita com a nossa chave? (troca de chave = refazer)
function sameKey(subscription) {
  const key = subscription?.options?.applicationServerKey;
  if (!key) return true; // navegador não informa: confia
  const a = new Uint8Array(key);
  const b = vapidBytes();
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function currentSubscription({ create = false } = {}) {
  const reg = await readyRegistration();
  let subscription = await reg.pushManager.getSubscription();
  if (subscription && !sameKey(subscription)) {
    await subscription.unsubscribe().catch(() => {});
    subscription = null;
  }
  if (!subscription && create) {
    subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidBytes() });
  }
  return subscription;
}

// "iPhone", "Android · Chrome", "Windows · Edge"... (aparece só no banco do Worker)
function deviceLabel() {
  const ua = navigator.userAgent;
  const system = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || isIos() ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Outro';
  const browser = /SamsungBrowser/.test(ua) ? 'Samsung' : /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return isStandalone() ? `${system} · app` : browser ? `${system} · ${browser}` : system;
}

async function sendSubscription(uid, subscription) {
  await callAccountService('push/inscrever', { inscricao: subscription.toJSON(), aparelho: deviceLabel() });
  writeStorage(SYNC_KEY, JSON.stringify({ uid, endpoint: subscription.endpoint, at: Date.now() }));
}

// Situação neste aparelho: { support, permission, enabled, dismissed }
export async function pushStatus(uid) {
  const support = pushSupport();
  if (support !== 'ok') return { support, permission: 'default', enabled: false, dismissed: readStorage(choiceKey(uid)) === '0' };
  const permission = Notification.permission;
  const choice = readStorage(choiceKey(uid));
  let subscription = null;
  if (permission === 'granted' && choice === '1') subscription = await currentSubscription().catch(() => null);
  return { support, permission, enabled: Boolean(subscription), dismissed: choice === '0' };
}

// Ativar (precisa vir de um toque/clique: o navegador só pergunta assim)
export async function enablePush(uid) {
  if (pushSupport() !== 'ok') throw new Error('Este aparelho não recebe notificações do EscalaMed.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'As notificações foram bloqueadas. Libere nas configurações do navegador para o EscalaMed.'
        : 'Para receber os avisos, toque em "Permitir" quando o aparelho perguntar.',
    );
  }
  const subscription = await currentSubscription({ create: true });
  await sendSubscription(uid, subscription);
  writeStorage(choiceKey(uid), '1');
}

// Desativar neste aparelho (a permissão do navegador continua; só deixa de receber)
export async function disablePush(uid) {
  writeStorage(choiceKey(uid), '0');
  writeStorage(SYNC_KEY, null);
  const subscription = await currentSubscription().catch(() => null);
  if (!subscription) return;
  await callAccountService('push/cancelar', { endpoint: subscription.endpoint }).catch(() => {});
  await subscription.unsubscribe().catch(() => {});
}

// "Agora não": guarda a escolha (o convite grande vira uma linha discreta)
export const dismissPush = (uid) => writeStorage(choiceKey(uid), '0');
// Volta a mostrar o convite grande (ex.: "Como fazer" no iPhone)
export const resetPushChoice = (uid) => writeStorage(choiceKey(uid), null);

export const sendTestPush = () => callAccountService('push/teste', {});

// Só Dev: teste para todos os aparelhos ativos da plataforma (o Worker manda em lotes).
// Devolve { aparelhos, contas, enviados }.
export async function sendTestPushToAll() {
  const total = { aparelhos: 0, contas: 0, enviados: 0 };
  let depois = null;
  do {
    const resposta = await callAccountService('push/teste-geral', depois ? { depois } : {});
    if (!depois) Object.assign(total, { aparelhos: resposta.totalAparelhos ?? 0, contas: resposta.totalContas ?? 0 });
    total.enviados += resposta.enviados ?? 0;
    depois = resposta.proximo;
  } while (depois);
  return total;
}

// Ao abrir o app: com o push ativado, confere a inscrição (o navegador pode ter trocado o
// endereço, ou outra conta usou este aparelho) e reconfirma no Worker no máximo 1 vez por dia.
export async function syncPush(uid) {
  if (pushSupport() !== 'ok' || readStorage(choiceKey(uid)) !== '1' || Notification.permission !== 'granted') return;
  try {
    const subscription = await currentSubscription({ create: true });
    let last = null;
    try {
      last = JSON.parse(readStorage(SYNC_KEY) || 'null');
    } catch {
      last = null;
    }
    const fresh = last?.uid === uid && last.endpoint === subscription.endpoint && Date.now() - last.at < RESYNC_MS;
    if (!fresh) await sendSubscription(uid, subscription);
  } catch (error) {
    console.warn('Notificações: não foi possível confirmar a inscrição.', error);
  }
}

// Ao sair da conta: este aparelho para de receber as notificações dela (a escolha fica
// guardada: se a mesma pessoa entrar de novo, volta a receber sozinha)
export async function forgetPushOnSignOut() {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration('/').catch(() => null);
  const subscription = await reg?.pushManager?.getSubscription().catch(() => null);
  writeStorage(SYNC_KEY, null);
  if (subscription) await callAccountService('push/cancelar', { endpoint: subscription.endpoint }).catch(() => {});
}

// Avisa o Worker de algo que entra no sininho de outra pessoa (convite, recusa...).
// O Worker confere no Firestore antes de mandar. Não atrasa nem quebra a ação: falhou, paciência.
export function notifyPush(tipo, grupo, chave) {
  callAccountService('push/avisar', { tipo, grupo, chave }).catch((error) => console.warn('Notificações: aviso não enviado.', error));
}

// Número no ícone do app (o mesmo do sininho), onde o sistema suporta
export function setAppBadge(count) {
  if (!navigator.setAppBadge) return;
  (count ? navigator.setAppBadge(count) : navigator.clearAppBadge()).catch(() => {});
}
