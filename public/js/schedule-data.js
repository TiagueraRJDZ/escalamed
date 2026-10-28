// Escala mensal no Firestore: leitura dos turnos e do mês, alocação, vagas, publicação
// e replicação. Os cálculos ficam em schedule-math.js (sem Firebase).
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  onSnapshot,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { auth, db } from './firebase.js';

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

// Cria o mês em rascunho (primeira alocação ou vaga)
function createSchedule(groupId, month, fields) {
  return setDoc(scheduleRef(groupId, month), {
    status: 'draft',
    assignments: {},
    vacancies: {},
    createdAt: serverTimestamp(),
    ...stamp(),
    ...fields,
  });
}

// Aloca (add = true) ou desaloca a pessoa na célula. exists: o mês já tem documento?
export function setAssignment(groupId, month, key, uid, add, exists) {
  if (!exists) return createSchedule(groupId, month, { assignments: add ? { [key]: [uid] } : {} });
  return updateDoc(scheduleRef(groupId, month), {
    [`assignments.${key}`]: add ? arrayUnion(uid) : arrayRemove(uid),
    ...stamp(),
  });
}

export function setVacancies(groupId, month, key, count, exists) {
  if (!exists) return createSchedule(groupId, month, { vacancies: count ? { [key]: count } : {} });
  return updateDoc(scheduleRef(groupId, month), { [`vacancies.${key}`]: count, ...stamp() });
}

// Publica: grava a escala fixa (cópia da dinâmica) e congela os turnos
export function publishSchedule(groupId, month, schedule, shifts) {
  const fields = {
    status: 'published',
    fixed: schedule?.assignments ?? {},
    shifts,
    publishedAt: serverTimestamp(),
    publishedBy: auth.currentUser.uid,
  };
  if (!schedule) return createSchedule(groupId, month, fields);
  return updateDoc(scheduleRef(groupId, month), { ...fields, ...stamp() });
}

// Volta para rascunho (some para plantonistas e observadores até publicar de novo)
export const unpublishSchedule = (groupId, month) =>
  updateDoc(scheduleRef(groupId, month), { status: 'draft', ...stamp() });

// Grava o resultado de uma replicação no mês de destino, em rascunho
export function writeReplica(groupId, month, { assignments, vacancies }, targetExists) {
  if (!targetExists) return createSchedule(groupId, month, { assignments, vacancies });
  return updateDoc(scheduleRef(groupId, month), { status: 'draft', assignments, vacancies, ...stamp() });
}
