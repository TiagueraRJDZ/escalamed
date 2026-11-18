// Solicitações de plantão vago: groups/{g}/vacancyRequests/{mês}_{célula}_{uid}.
// O membro pede uma vaga aberta de escala publicada; o Gestor ou o coordenador do grupo aceita
// ou recusa. Aceitar é uma transação só: a pessoa entra no plantão, a vaga diminui, o pedido fica
// aceito e o histórico registra (vacant_taken). Quando a última vaga é preenchida, os outros
// pedidos do mesmo plantão ficam recusados ("filled"). Quem pediu recebe a resposta no sininho
// e no celular (push). As regras ficam no firestore.rules (vacancyRequests).
import {
  arrayUnion,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { auth, db } from './firebase.js';
import { listenWithRetry } from './live.js';
import { logMovement, shiftFields } from './movements.js';
import { loadShifts, scheduleRef, scheduleShifts } from './schedule-data.js';
import { findConflict, parseCellKey, requestId } from './schedule-math.js';
import { formatClock } from './shifts.js';
import { notifyPush } from './push.js';
import { confirmDialog, escapeHtml, firebaseErrorMessage, toast } from './ui.js';

const requestsRef = (groupId) => collection(db, 'groups', groupId, 'vacancyRequests');
const requestRef = (groupId, id) => doc(db, 'groups', groupId, 'vacancyRequests', id);

// Documento → pedido: docId (id no grupo), groupId e path (id único, para o sininho)
const requestFrom = (d) => ({ docId: d.id, groupId: d.ref.parent.parent.id, path: d.ref.path, ...d.data({ serverTimestamps: 'estimate' }) });

const byNewest = (a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0);

// Motivo de requestBlock (schedule-math.js) → frase para quem quer pedir
export const BLOCK_TEXT = {
  closed: 'A escala deste mês não está publicada.',
  full: 'As vagas deste plantão já foram preenchidas.',
  assigned: 'Você já está neste plantão.',
  past: 'Este plantão já começou.',
  conflict: 'Você já tem outro plantão nesse horário.',
};

// "Noturno de 07/11 (19h00 às 01h00)"
export function requestShiftText(r) {
  const [, mm, dd] = String(r.shiftDate ?? '').split('-');
  const clock = (t) => (t ? t.replace(':', 'h') : '');
  return `${escapeHtml(r.shiftTitle ?? 'Plantão')} de ${dd}/${mm}${r.shiftStart ? ` (${clock(r.shiftStart)} às ${clock(r.shiftEnd)})` : ''}`;
}

// Link para a gaveta do dia no grupo
export const requestDayLink = (r) => `/group.html?id=${encodeURIComponent(r.groupId)}&dia=${r.shiftDate}`;

// ---------- Quem pede ----------
export async function requestVacancy(group, month, key, shift, name) {
  const uid = auth.currentUser.uid;
  const id = requestId(month, key, uid);
  const { day, shiftId } = parseCellKey(key);
  await setDoc(requestRef(group.id, id), {
    uid,
    name: String(name || 'Membro').slice(0, 80),
    groupName: String(group.name).slice(0, 60),
    month,
    cell: key,
    ...shiftFields(month, day, shiftId, shift),
    status: 'pending',
    createdAt: serverTimestamp(),
  });
  notifyPush('vaga-pedido', group.id, id); // celular dos coordenadores do grupo
}

// Cancelar o pedido pendente ou dispensar a resposta
export const removeRequest = (groupId, docId) => deleteDoc(requestRef(groupId, docId));

// Pedidos da própria pessoa em todos os grupos, em tempo real (o mais novo primeiro)
export function watchMyRequests(uid, onChange) {
  return listenWithRetry(
    query(collectionGroup(db, 'vacancyRequests'), where('uid', '==', uid)),
    (snapshot) => onChange(snapshot.docs.map(requestFrom).sort(byNewest), { synced: !snapshot.metadata.fromCache }),
    'Pedidos de plantão vago',
    { metadata: true },
  );
}

// ---------- Quem responde (Gestor, coordenador do grupo) ----------
// Pedidos pendentes de um grupo, em tempo real
export function watchGroupRequests(groupId, onChange) {
  return listenWithRetry(
    query(requestsRef(groupId), where('status', '==', 'pending')),
    (snapshot) => onChange(snapshot.docs.map(requestFrom).sort(byNewest), { synced: !snapshot.metadata.fromCache }),
    'Pedidos de plantão vago do grupo',
    { metadata: true },
  );
}

class RequestError extends Error {}

const decision = (name) => ({ decidedBy: auth.currentUser.uid, decidedByName: String(name || 'Coordenação').slice(0, 80), decidedAt: serverTimestamp() });

// Aceita: transação (a vaga é conferida no servidor na hora; dois coordenadores aceitando ao
// mesmo tempo não preenchem a mesma vaga duas vezes). others: os outros pedidos pendentes do
// mesmo plantão, recusados se a última vaga acabar aqui. Devolve os ids recusados.
async function approve(request, deciderName, others) {
  const { groupId, month, cell, uid } = request;
  const scheduleDoc = scheduleRef(groupId, month);
  const refs = others.map((o) => requestRef(groupId, o.docId));
  const closed = await runTransaction(db, async (tx) => {
    const [scheduleSnap, requestSnap, ...otherSnaps] = await Promise.all([
      tx.get(scheduleDoc),
      tx.get(requestRef(groupId, request.docId)),
      ...refs.map((ref) => tx.get(ref)),
    ]);
    if (requestSnap.data()?.status !== 'pending') throw new RequestError('Esta solicitação já foi respondida.');
    const schedule = scheduleSnap.data();
    if (schedule?.assignments?.[cell]?.includes(uid)) throw new RequestError('A pessoa já está neste plantão.');
    const open = schedule?.vacancies?.[cell] ?? 0;
    if (schedule?.status !== 'published' || open < 1) throw new RequestError('Não há mais vaga aberta neste plantão.');

    const left = open - 1;
    tx.update(scheduleDoc, {
      [`assignments.${cell}`]: arrayUnion(uid),
      [`vacancies.${cell}`]: left,
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser.uid,
    });
    tx.update(requestSnap.ref, { status: 'approved', ...decision(deciderName) });
    const declined = left > 0 ? [] : otherSnaps.filter((s) => s.data()?.status === 'pending');
    declined.forEach((s) => tx.update(s.ref, { status: 'declined', reason: 'filled', ...decision(deciderName) }));
    // Histórico: quem aceitou (actor) e quem entrou no plantão (target)
    const { shiftId, shiftTitle, shiftDate, shiftStart, shiftEnd } = request;
    logMovement(tx, groupId, { type: 'vacant_taken', targetUid: uid, shiftId, shiftTitle, shiftDate, shiftStart, shiftEnd });
    return declined.map((s) => s.id);
  });
  // A Agenda Google de quem está escalado acompanha (gcal.js)
  window.dispatchEvent(new CustomEvent('escalamed:escala-alterada', { detail: { groupId, month } }));
  return closed;
}

// A pessoa já tem outro plantão nesse horário? (aviso antes de aceitar)
async function conflictOf(request) {
  try {
    const [snapshot, liveShifts] = await Promise.all([getDoc(scheduleRef(request.groupId, request.month)), loadShifts(request.groupId)]);
    const schedule = snapshot.data();
    const shifts = scheduleShifts(schedule, liveShifts);
    const { day, shiftId } = parseCellKey(request.cell);
    const cell = findConflict(schedule?.assignments, shifts, request.uid, day, shiftId);
    return cell ? shifts[cell.shiftId] && { ...cell, shift: shifts[cell.shiftId] } : null;
  } catch {
    return null; // sem conseguir conferir, a transação ainda confere a vaga
  }
}

// Aceita ou recusa, com confirmação, avisos na tela e o push para quem pediu.
// pending: os pedidos pendentes que a tela conhece (para recusar os outros do mesmo plantão
// quando a última vaga acabar). Devolve true se gravou.
export async function answerRequest(request, accept, { deciderName, pending = [] } = {}) {
  const who = request.name || 'A pessoa';
  if (accept) {
    const conflict = await conflictOf(request);
    if (conflict) {
      const { shift, day } = conflict;
      const ok = await confirmDialog({
        title: 'Plantão no mesmo horário',
        message: `${who} já está no plantão ${shift.title} do dia ${String(day).padStart(2, '0')} (${formatClock(shift.startMinute)} às ${formatClock(shift.endMinute)}), que bate com este horário. Aceitar mesmo assim?`,
        confirmText: 'Aceitar mesmo assim',
      });
      if (!ok) return false;
    }
  } else {
    const ok = await confirmDialog({
      title: 'Recusar a solicitação?',
      message: `${who} recebe o aviso de que o pedido foi recusado.`,
      confirmText: 'Recusar',
      danger: true,
    });
    if (!ok) return false;
  }
  try {
    if (accept) {
      const others = pending.filter(
        (o) => o.docId !== request.docId && o.groupId === request.groupId && o.month === request.month && o.cell === request.cell,
      );
      const closed = await approve(request, deciderName, others);
      notifyPush('vaga-resposta', request.groupId, request.docId);
      closed.forEach((id) => notifyPush('vaga-resposta', request.groupId, id));
      toast(`${who} entrou no plantão.${closed.length ? ' As vagas acabaram: os outros pedidos foram recusados.' : ''}`, 'success', 6000);
    } else {
      await updateDoc(requestRef(request.groupId, request.docId), { status: 'declined', ...decision(deciderName) });
      notifyPush('vaga-resposta', request.groupId, request.docId);
      toast('Solicitação recusada.');
    }
    return true;
  } catch (error) {
    toast(error instanceof RequestError ? error.message : firebaseErrorMessage(error), 'error', 6000);
    return false;
  }
}
