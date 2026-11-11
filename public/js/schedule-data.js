// Escala mensal no Firestore: leitura dos turnos e do mês, alocação, vagas, publicação
// e replicação (cada gravação registra o histórico no mesmo lote). Os cálculos ficam em schedule-math.js (sem Firebase).
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  writeBatch,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { auth, db } from './firebase.js';
import { logMovement } from './movements.js';

export const scheduleRef = (groupId, month) => doc(db, 'groups', groupId, 'schedules', month);

const stamp = () => ({ updatedAt: serverTimestamp(), updatedBy: auth.currentUser.uid });

// Turnos do grupo: { id: { title, startMinute, endMinute } }
export async function loadShifts(groupId) {
  const snapshot = await getDocs(collection(db, 'groups', groupId, 'shifts'));
  return Object.fromEntries(
    snapshot.docs.map((d) => {
      const { title, startMinute, endMinute } = d.data();
      return [d.id, { title, startMinute, endMinute }];
    }),
  );
}

// Turnos para mostrar uma escala: os de hoje + os congelados na publicação
// (assim um turno apagado depois continua aparecendo na escala antiga)
export const scheduleShifts = (schedule, liveShifts) => ({ ...liveShifts, ...(schedule?.shifts ?? {}) });

// Mês da escala, ou null se não existe (ou ainda é rascunho para quem não pode ver)
export async function loadSchedule(groupId, month) {
  try {
    const snapshot = await getDoc(scheduleRef(groupId, month));
    return snapshot.exists() ? snapshot.data() : null;
  } catch (error) {
    if (error.code === 'permission-denied') return null;
    throw error;
  }
}

// Escala em tempo real. callback(dados | null)
export function watchSchedule(groupId, month, callback, onError) {
  return onSnapshot(
    scheduleRef(groupId, month),
    (snapshot) => callback(snapshot.exists() ? snapshot.data() : null),
    (error) => (error.code === 'permission-denied' ? callback(null) : onError?.(error)),
  );
}

// Cada gravação vai num lote junto com o registro do histórico (movement: dados do log,
// ver movements.js). Sem movement, grava só a escala.
function commitWithLog(groupId, write, movement) {
  const batch = writeBatch(db);
  write(batch);
  if (movement) logMovement(batch, groupId, movement);
  return batch.commit();
}

// Quem está em cada plantão mudou: avisa a Agenda Google (gcal.js), que atualiza a
// agenda de quem está escalado
const announceChange = (groupId, month) => () =>
  window.dispatchEvent(new CustomEvent('escalamed:escala-alterada', { detail: { groupId, month } }));

// Campos de um mês novo, em rascunho (primeira alocação ou vaga)
const newSchedule = (fields) => ({
  status: 'draft',
  assignments: {},
  vacancies: {},
  createdAt: serverTimestamp(),
  ...stamp(),
  ...fields,
});

// Aloca (add = true) ou desaloca a pessoa na célula. exists: o mês já tem documento?
export function setAssignment(groupId, month, key, uid, add, exists, movement) {
  const ref = scheduleRef(groupId, month);
  return commitWithLog(
    groupId,
    (batch) =>
      exists
        ? batch.update(ref, { [`assignments.${key}`]: add ? arrayUnion(uid) : arrayRemove(uid), ...stamp() })
        : batch.set(ref, newSchedule({ assignments: add ? { [key]: [uid] } : {} })),
    movement,
  ).then(announceChange(groupId, month));
}

export function setVacancies(groupId, month, key, count, exists, movement) {
  const ref = scheduleRef(groupId, month);
  return commitWithLog(
    groupId,
    (batch) =>
      exists
        ? batch.update(ref, { [`vacancies.${key}`]: count, ...stamp() })
        : batch.set(ref, newSchedule({ vacancies: count ? { [key]: count } : {} })),
    movement,
  );
}

// Publica: grava a escala fixa (cópia da dinâmica) e congela os turnos
export function publishSchedule(groupId, month, schedule, shifts, movement) {
  const ref = scheduleRef(groupId, month);
  const fields = {
    status: 'published',
    fixed: schedule?.assignments ?? {},
    shifts,
    publishedAt: serverTimestamp(),
    publishedBy: auth.currentUser.uid,
  };
  return commitWithLog(
    groupId,
    (batch) => (schedule ? batch.update(ref, { ...fields, ...stamp() }) : batch.set(ref, newSchedule(fields))),
    movement,
  ).then(announceChange(groupId, month));
}

// Volta para rascunho (some para membros e Administrativos até publicar de novo)
export const unpublishSchedule = (groupId, month, movement) =>
  commitWithLog(groupId, (batch) => batch.update(scheduleRef(groupId, month), { status: 'draft', ...stamp() }), movement).then(
    announceChange(groupId, month),
  );

// Grava o resultado de uma replicação no mês de destino, em rascunho
export function writeReplica(groupId, month, { assignments, vacancies }, targetExists, movement) {
  const ref = scheduleRef(groupId, month);
  return commitWithLog(
    groupId,
    (batch) =>
      targetExists
        ? batch.update(ref, { status: 'draft', assignments, vacancies, ...stamp() })
        : batch.set(ref, newSchedule({ assignments, vacancies })),
    movement,
  ).then(announceChange(groupId, month));
}
