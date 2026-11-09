// Agenda Google: conectar, escolher o lembrete, atualizar e desconectar (modal do ícone de
// calendário na barra do topo) e manter os plantões em dia na agenda "EscalaMed" do Google.
// A autorização do Google fica no serviço de contas (Worker, worker/src/agenda.js); o app
// só manda os plantões:
//   - os da própria pessoa, ao abrir o app (no máximo a cada 30 minutos) e em "Atualizar agora";
//   - os de todo o grupo, quando gestor ou auxiliar altera uma escala (aviso de schedule-data.js).
import { googleClientId } from './config.js';
import { callAccountService } from './auth-api.js';
import { loadMyGroups } from './my-groups.js';
import { loadSchedule, loadShifts, scheduleShifts } from './schedule-data.js';
import {
  CALENDAR_SCOPE,
  CALENDAR_REMINDERS,
  syncMonths,
  calendarCells,
  calendarShifts,
  calendarSchedule,
  needsLiveShifts,
  syncedLabel,
} from './gcal-data.js';
import { icon } from './icons.js';
import { escapeHtml, toast, setLoading, confirmDialog } from './ui.js';

const GIS_URL = 'https://accounts.google.com/gsi/client';
const AUTO_SYNC_MS = 30 * 60 * 1000; // ao abrir o app, no máximo a cada 30 minutos
const GROUP_DELAY_MS = 2000; // junta várias alterações seguidas na escala num envio só

let ctx = null; // { uid, button, modal, state }
let mineRunning = null;
const groupTimers = new Map();

// Modal (montado pelo layout.js junto com as gavetas)
export function googleCalendarModalHtml() {
  return `
    <dialog class="modal modal-center" id="modal-gcal" aria-labelledby="modal-gcal-title">
      <div class="dialog-header" style="border:0;justify-content:flex-end">
        <button type="button" class="btn-icon" data-close aria-label="Fechar">${icon('x')}</button>
      </div>
      <div id="gcal-content">${contentHtml(null)}</div>
    </dialog>`;
}

function contentHtml(state) {
  if (!state?.conectado) {
    return `
      <div class="dialog-body">
        <div class="gcal-hero"><img src="/img/google-agenda.svg" alt="" width="64" height="64" /></div>
        <h2 id="modal-gcal-title">Conecte sua Agenda Google</h2>
        <p class="muted" style="margin-top:var(--esp-2)">
          Seus plantões aparecem automaticamente no seu calendário do Google, com lembretes antes de cada um.
        </p>
        <p class="field-hint gcal-note">O EscalaMed cria uma agenda só dele, chamada "EscalaMed", e não vê nem altera as suas outras agendas.</p>
      </div>
      <div class="dialog-footer">
        <button type="button" class="btn btn-secondary" data-close>Agora não</button>
        <button type="button" class="btn btn-primary" data-gcal="connect">Conectar</button>
      </div>`;
  }
  const options = CALENDAR_REMINDERS.map(
    ({ minutes, label }) => `<option value="${minutes}"${minutes === state.lembrete ? ' selected' : ''}>${escapeHtml(label)}</option>`,
  ).join('');
  return `
    <div class="dialog-body">
      <div class="gcal-hero">
        <img src="/img/google-agenda.svg" alt="" width="64" height="64" />
        <span class="gcal-hero-check">${icon('check')}</span>
      </div>
      <h2 id="modal-gcal-title">Agenda Google conectada</h2>
      <p class="muted" style="margin-top:var(--esp-2)">
        Seus plantões publicados ficam na agenda "EscalaMed" do seu Google e se atualizam sozinhos quando a escala muda.
      </p>
      <div class="field gcal-settings">
        <label class="label" for="gcal-reminder">Lembrete antes de cada plantão</label>
        <select class="select" id="gcal-reminder">${options}</select>
      </div>
      <p class="field-hint gcal-status" aria-live="polite">${escapeHtml(statusText(state))}</p>
    </div>
    <div class="dialog-footer gcal-footer">
      <button type="button" class="btn btn-ghost is-danger" data-gcal="disconnect">Desconectar</button>
      <button type="button" class="btn btn-primary" data-gcal="sync">Atualizar agora</button>
    </div>`;
}

const statusText = (state) =>
  state.pendente ? 'Enviando seus plantões ao Google. Termina em alguns minutos.' : syncedLabel(state.sincronizadoEm);

// ---------- Estado (guardado no navegador para o botão e o modal aparecerem na hora) ----------
const storageKey = (uid) => `escalamed:agenda:${uid}`;

function readState(uid) {
  try {
    return JSON.parse(localStorage.getItem(storageKey(uid)));
  } catch {
    return null;
  }
}

function saveState(state) {
  const connectedBefore = Boolean(ctx.state?.conectado);
  ctx.state = { ...state, checkedAt: Date.now() };
  try {
    localStorage.setItem(storageKey(ctx.uid), JSON.stringify(ctx.state));
  } catch {
    // sem armazenamento: só não lembra
  }
  paint(connectedBefore !== Boolean(state.conectado));
}

// Botão do topo (bolinha verde quando conectada) e conteúdo do modal
function paint(changed = true) {
  const connected = Boolean(ctx.state?.conectado);
  ctx.button.classList.toggle('is-connected', connected);
  const label = connected ? 'Google Agenda conectada' : 'Conectar Google Agenda';
  ctx.button.setAttribute('aria-label', label);
  ctx.button.title = label;
  if (changed || !ctx.modal.open) {
    ctx.modal.querySelector('#gcal-content').innerHTML = contentHtml(ctx.state);
  } else {
    const status = ctx.modal.querySelector('.gcal-status');
    if (status) status.textContent = statusText(ctx.state);
    const select = ctx.modal.querySelector('#gcal-reminder');
    if (select && document.activeElement !== select) select.value = String(ctx.state.lembrete);
  }
}

// ---------- Início (chamado pelo layout.js em toda página interna) ----------
export function setupGoogleCalendar(app, user) {
  ctx = {
    uid: user.uid,
    button: app.querySelector('.gcal-button'),
    modal: document.getElementById('modal-gcal'),
    state: readState(user.uid),
  };
  paint();

  // O modal abre pelo data-open (layout.js); aqui só carrega o Google e confere o estado
  ctx.button.addEventListener('click', () => {
    loadGis().catch(() => {});
    refreshState();
  });
  ctx.modal.addEventListener('click', onModalClick);
  ctx.modal.addEventListener('change', onModalChange);

  // Escala alterada pelo gestor ou auxiliar (schedule-data.js)
  window.addEventListener('escalamed:escala-alterada', (event) => queueGroupSync(event.detail.groupId, event.detail.month));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushGroupSyncs();
  });

  autoSync();
}

async function refreshState() {
  try {
    saveState(await callAccountService('agenda/estado', {}));
  } catch (error) {
    console.warn('Agenda Google:', error.message);
  }
}

// Ao abrir o app: confere se está conectada e manda os plantões (no máximo a cada 30 min)
async function autoSync() {
  if (ctx.state && Date.now() - (ctx.state.checkedAt || 0) < AUTO_SYNC_MS) return;
  try {
    const state = await callAccountService('agenda/estado', {});
    saveState(state);
    if (state.conectado) await syncMine();
  } catch (error) {
    console.warn('Agenda Google:', error.message);
  }
}

// ---------- Ações do modal ----------
function onModalClick(event) {
  const button = event.target.closest('[data-gcal]');
  if (!button) return;
  const action = button.dataset.gcal;
  if (action === 'connect') connect(button);
  else if (action === 'sync') syncNow(button);
  else if (action === 'disconnect') disconnect(button);
}

async function onModalChange(event) {
  if (event.target.id !== 'gcal-reminder') return;
  const select = event.target;
  select.disabled = true;
  try {
    saveState(await callAccountService('agenda/lembrete', { minutos: Number(select.value) }));
    toast('Lembrete atualizado nos seus plantões.', 'success');
  } catch (error) {
    toast(error.message, 'error');
    select.value = String(ctx.state?.lembrete ?? 60);
  } finally {
    select.disabled = false;
  }
}

// Script do Google Identity Services (carregado ao abrir o modal, para a janela do Google
// abrir no clique em Conectar sem ser barrada como pop-up)
let gisPromise = null;
function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  gisPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_URL;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => {
      gisPromise = null;
      reject(new Error('Google Identity Services não carregou'));
    };
    document.head.append(script);
  });
  return gisPromise;
}

function connect(button) {
  if (!googleClientId) {
    toast('A conexão com o Google Agenda ainda não foi configurada. Fale com o administrador do EscalaMed.', 'error');
    return;
  }
  const oauth = window.google?.accounts?.oauth2;
  if (!oauth) {
    toast('Carregando o Google. Tente de novo em instantes.');
    loadGis().catch(() => toast('Não foi possível falar com o Google. Verifique sua conexão.', 'error'));
    return;
  }
  setLoading(button, true);
  // Modo "código": o Worker troca o código pelo token e o guarda (o app nunca vê o token)
  const client = oauth.initCodeClient({
    client_id: googleClientId,
    scope: CALENDAR_SCOPE,
    ux_mode: 'popup',
    callback: (response) => finishConnect(response, button),
    error_callback: (error) => {
      setLoading(button, false);
      if (error?.type === 'popup_failed_to_open') {
        toast('O navegador bloqueou a janela do Google. Libere pop-ups para este site e tente de novo.', 'error');
      }
    },
  });
  client.requestCode();
}

async function finishConnect(response, button) {
  if (response.error || !response.code) {
    setLoading(button, false);
    toast(response.error === 'access_denied' ? 'Conexão cancelada.' : 'O Google não autorizou a conexão. Tente de novo.', 'error');
    return;
  }
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    saveState(await callAccountService('agenda/conectar', { codigo: response.code, fuso: timezone }));
    if (!ctx.state.conectado) throw new Error('O Google não liberou o acesso à agenda. Tente de novo.');
    toast('Agenda Google conectada. Seus plantões já estão indo para o seu calendário.', 'success');
    await syncMine();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setLoading(button, false);
  }
}

async function syncNow(button) {
  setLoading(button, true);
  try {
    const state = await syncMine();
    if (!state.conectado) toast('A Agenda Google foi desconectada. Conecte de novo para continuar.', 'error');
    else toast(state.pendente ? 'Plantões enviados. O restante chega ao Google em alguns minutos.' : 'Agenda Google atualizada.', 'success');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setLoading(button, false);
  }
}

async function disconnect(button) {
  const ok = await confirmDialog({
    title: 'Desconectar a Agenda Google?',
    message: 'A agenda "EscalaMed" e os plantões dela saem do seu Google. Você pode conectar de novo quando quiser.',
    confirmText: 'Desconectar',
    danger: true,
  });
  if (!ok) return;
  setLoading(button, true);
  try {
    saveState(await callAccountService('agenda/desconectar', {}));
    toast('Agenda Google desconectada.', 'success');
  } catch (error) {
    toast(error.message, 'error');
    setLoading(button, false);
  }
}

// ---------- Plantões da própria pessoa ----------
// Plantões publicados dos meses de syncMonths(), em todos os grupos. Meses sem plantão
// também vão (o Worker tira da agenda o que saiu da escala).
function syncMine() {
  mineRunning ??= (async () => {
    const months = syncMonths();
    const groups = await loadMyGroups(ctx.uid);
    const lists = await Promise.all(groups.map((group) => mySchedules(group, months)));
    const state = await callAccountService('agenda/meus-plantoes', { meses: months, escalas: lists.flat() });
    saveState(state);
    return state;
  })().finally(() => {
    mineRunning = null;
  });
  return mineRunning;
}

async function mySchedules(group, months) {
  const schedules = await Promise.all(months.map((month) => loadSchedule(group.id, month)));
  const items = months
    .map((month, i) => {
      const schedule = schedules[i];
      const cells = schedule?.status === 'published' ? calendarCells(schedule.assignments, ctx.uid) : {};
      return { month, schedule, cells };
    })
    .filter((item) => Object.keys(item.cells).length);
  if (!items.length) return [];
  const live = items.some((item) => needsLiveShifts(item.schedule, item.cells)) ? await loadShifts(group.id) : {};
  return items.map(({ month, schedule, cells }) =>
    calendarSchedule({ group, month, cells, shifts: scheduleShifts(schedule, live) }),
  );
}

// ---------- Escala do grupo alterada (gestor ou auxiliar) ----------
function queueGroupSync(groupId, month) {
  const key = `${groupId}|${month}`;
  clearTimeout(groupTimers.get(key));
  groupTimers.set(key, setTimeout(() => runGroupSync(key), GROUP_DELAY_MS));
}

// Saindo da página: manda na hora o que estava esperando
function flushGroupSyncs() {
  for (const [key, timer] of groupTimers) {
    clearTimeout(timer);
    runGroupSync(key);
  }
}

async function runGroupSync(key) {
  groupTimers.delete(key);
  const [groupId, month] = key.split('|');
  try {
    const schedule = await loadSchedule(groupId, month);
    const published = schedule?.status === 'published';
    // Rascunho que nunca foi publicado: não está na agenda de ninguém
    if (!published && !schedule?.publishedAt) return;
    const cells = published ? calendarCells(schedule.assignments) : {};
    const shifts = needsLiveShifts(schedule, cells) ? scheduleShifts(schedule, await loadShifts(groupId)) : (schedule?.shifts ?? {});
    await callAccountService('agenda/grupo', {
      grupoId: groupId,
      mes: month,
      publicada: published,
      turnos: calendarShifts(shifts, cells),
      celulas: cells,
    });
  } catch (error) {
    console.warn('Agenda Google (escala do grupo):', error.message);
  }
}
