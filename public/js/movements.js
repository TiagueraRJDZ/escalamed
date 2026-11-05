// Histórico de movimentações de um grupo: groups/{g}/movements/{id}.
// Log imutável, gravado pelo próprio app NO MESMO LOTE (writeBatch) da ação que ele
// descreve, para nunca existir ação sem registro (ou registro sem ação).
// Guarda só uids; os nomes vêm dos cartões de membro na hora de mostrar.
//
// monthKey = mês em que a ação aconteceu (é por ele que o Histórico filtra).
// public = false: ação da gestão numa escala em rascunho (só gestor, auxiliar e analista veem).
import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  where,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { auth, db } from './firebase.js';
import { toTime } from './shifts.js';

// Tipos de movimentação: ícone e grupo do filtro "tipo" da página Histórico
export const MOVEMENT_TYPES = {
  swap: { icon: 'arrowRightLeft', filter: 'swap' },
  cession: { icon: 'arrowRight', filter: 'cession' },
  vacant_open: { icon: 'star', filter: 'vacant' },
  vacant_closed: { icon: 'x', filter: 'vacant' },
  vacant_taken: { icon: 'userCheck', filter: 'vacant' },
  assigned: { icon: 'userPlus', filter: 'editor' },
  unassigned: { icon: 'userMinus', filter: 'editor' },
  published: { icon: 'checkCircle', filter: 'editor' },
  unpublished: { icon: 'eyeOff', filter: 'editor' },
  replicated: { icon: 'copy', filter: 'editor' },
};

// Opções do botão de tipo (na ordem do menu)
export const TYPE_FILTERS = [
  { id: 'all', label: 'Todas as movimentações', icon: 'menu' },
  { id: 'swap', label: 'Apenas trocas', icon: 'arrowRightLeft' },
  { id: 'cession', label: 'Apenas cessões', icon: 'arrowRight' },
  { id: 'vacant', label: 'Apenas plantões vagos', icon: 'star' },
  { id: 'editor', label: 'Alterações na escala', icon: 'edit' },
];

const pad = (n) => String(n).padStart(2, '0');
export const monthOfDate = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;

// Campos de um plantão para o log (mês "2026-11", dia 7, turno { title, startMinute, endMinute })
export function shiftFields(month, day, shiftId, shift) {
  if (!shift) return { shiftId, shiftDate: `${month}-${pad(day)}` };
  return {
    shiftId,
    shiftTitle: String(shift.title ?? '').slice(0, 40),
    shiftDate: `${month}-${pad(day)}`,
    shiftStart: toTime(shift.startMinute),
    shiftEnd: toTime(shift.endMinute),
  };
}

const OPTIONAL = [
  'shiftId', 'shiftTitle', 'shiftDate', 'shiftStart', 'shiftEnd',
  'counterShiftId', 'counterShiftDate', 'counterShiftStart', 'counterShiftEnd',
  'count', 'scheduleMonth', 'fromMonth',
];

// Acrescenta o registro ao lote. data: { type, targetUid?, public?, ...campos do plantão }
export function logMovement(batch, groupId, data) {
  const actorUid = auth.currentUser.uid;
  const targetUid = data.targetUid ?? null;
  const record = {
    type: data.type,
    groupId,
    actorUid,
    targetUid,
    memberUids: [...new Set([actorUid, targetUid].filter(Boolean))],
    public: data.public ?? true,
    monthKey: monthOfDate(),
    createdAt: serverTimestamp(),
  };
  // Só os campos informados (as regras não aceitam campo a mais nem "undefined")
  for (const key of OPTIONAL) if (data[key] !== undefined && data[key] !== null) record[key] = data[key];
  batch.set(doc(collection(db, 'groups', groupId, 'movements')), record);
}

// Movimentações de um grupo num mês, da mais recente para a mais antiga.
// Quem não vê rascunhos só pode consultar as públicas (as regras exigem o filtro).
export async function loadMovements(groupId, month, { seesDrafts = false } = {}) {
  const constraints = [where('monthKey', '==', month), orderBy('createdAt', 'desc'), limit(500)];
  if (!seesDrafts) constraints.unshift(where('public', '==', true));
  const snapshot = await getDocs(query(collection(db, 'groups', groupId, 'movements'), ...constraints));
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}
