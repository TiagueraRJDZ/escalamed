// Cessão direcionada: groups/{g}/cessionRequests/{mês}_{célula}_{uid de quem cede}.
// Quem está num plantão de escala publicada escolhe um colega do grupo para ficar com ele; o
// Gestor ou o coordenador do grupo aprova ou recusa. Aprovar é uma transação: o plantão passa
// de uma pessoa para a outra, o pedido fica aprovado e o histórico registra (cession, com
// fromUid = quem cedeu). O colega é avisado do pedido e da aprovação; quem cedeu, da resposta.
// As regras ficam no firestore.rules (cessionRequests).
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
import { confirmDialog, firebaseErrorMessage, toast } from './ui.js';

const cessionsRef = (groupId) => collection(db, 'groups', groupId, 'cessionRequests');
const cessionRef = (groupId, id) => doc(db, 'groups', groupId, 'cessionRequests', id);

const cessionFrom = (d) => ({ docId: d.id, groupId: d.ref.parent.parent.id, path: d.ref.path, ...d.data({ serverTimestamps: 'estimate' }) });
const byNewest = (a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0);

// Motivo de cessionBlock / receiverBlock (schedule-math.js) → frase
export const CESSION_BLOCK_TEXT = {
  closed: 'A escala deste mês não está publicada.',
  'not-mine': 'Você não está mais neste plantão.',
  past: 'Este plantão já começou.',
};
export const RECEIVER_BLOCK_TEXT = {
  assigned: 'já está neste plantão',
  conflict: 'tem outro plantão nesse horário',
};

// ---------- Quem cede ----------
export async function requestCession(group, month, key, shift, name, to) {
  const uid = auth.currentUser.uid;
  const id = requestId(month, key, uid);
  const { day, shiftId } = parseCellKey(key);
  await setDoc(cessionRef(group.id, id), {
    uid,
    name: String(name || 'Membro').slice(0, 80),
    toUid: to.id,
    toName: String(to.name || 'Colega').slice(0, 80),
    groupName: String(group.name).slice(0, 60),
    month,
    cell: key,
    ...shiftFields(month, day, shiftId, shift),
    status: 'pending',
    createdAt: serverTimestamp(),
  });
  notifyPush('cessao-pedido', group.id, id); // coordenadores do grupo e o colega
}

// Cancelar o pedido (quem cede)
export const cancelCession = (groupId, docId) => deleteDoc(cessionRef(groupId, docId));

// Dispensar a notificação: some só da lista de quem dispensou
export const dismissCession = (groupId, docId) =>
  updateDoc(cessionRef(groupId, docId), { dismissedBy: arrayUnion(auth.currentUser.uid) });

// Cessões que a pessoa pediu (mine) e que foram pedidas para ela (toMe), em todos os grupos
export function watchMyCessions(uid, onChange) {
  const results = { mine: null, toMe: null };
  const emit = () => {
    if (!results.mine || !results.toMe) return;
    onChange(
      { mine: results.mine.list, toMe: results.toMe.list },
      { synced: !results.mine.fromCache && !results.toMe.fromCache },
    );
  };
  const listen = (field, slot) =>
    listenWithRetry(
      query(collectionGroup(db, 'cessionRequests'), where(field, '==', uid)),
      (snapshot) => {
        results[slot] = { list: snapshot.docs.map(cessionFrom).sort(byNewest), fromCache: snapshot.metadata.fromCache };
        emit();
      },
      'Cessões',
      { metadata: true, onError: () => ((results[slot] ??= { list: [], fromCache: true }), emit()) },
    );
  const stops = [listen('uid', 'mine'), listen('toUid', 'toMe')];
  return () => stops.forEach((stop) => stop());
}

// ---------- Quem responde (Gestor, coordenador do grupo) ----------
export function watchGroupCessions(groupId, onChange) {
  return listenWithRetry(
    query(cessionsRef(groupId), where('status', '==', 'pending')),
    (snapshot) => onChange(snapshot.docs.map(cessionFrom).sort(byNewest), { synced: !snapshot.metadata.fromCache }),
    'Cessões do grupo',
    { metadata: true },
  );
}

class CessionError extends Error {}

const decision = (name) => ({ decidedBy: auth.currentUser.uid, decidedByName: String(name || 'Coordenação').slice(0, 80), decidedAt: serverTimestamp() });

// Aprova: confere no servidor (transação) que quem cede ainda está no plantão e o colega não
async function approve(cession, deciderName) {
  const { groupId, month, cell, uid, toUid } = cession;
  const scheduleDoc = scheduleRef(groupId, month);
  await runTransaction(db, async (tx) => {
    const [scheduleSnap, cessionSnap] = await Promise.all([tx.get(scheduleDoc), tx.get(cessionRef(groupId, cession.docId))]);
    if (cessionSnap.data()?.status !== 'pending') throw new CessionError('Este pedido de cessão já foi respondido.');
    const schedule = scheduleSnap.data();
    const people = schedule?.assignments?.[cell] ?? [];
    if (schedule?.status !== 'published') throw new CessionError('A escala deste mês não está publicada.');
    if (!people.includes(uid)) throw new CessionError(`${cession.name} não está mais neste plantão.`);
    if (people.includes(toUid)) throw new CessionError(`${cession.toName} já está neste plantão.`);
    // Um campo só aceita uma operação por gravação: grava a lista nova (lida nesta transação)
    tx.update(scheduleDoc, {
      [`assignments.${cell}`]: [...people.filter((id) => id !== uid), toUid],
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser.uid,
    });
    tx.update(cessionSnap.ref, { status: 'approved', ...decision(deciderName) });
    const { shiftId, shiftTitle, shiftDate, shiftStart, shiftEnd } = cession;
    logMovement(tx, groupId, { type: 'cession', targetUid: toUid, fromUid: uid, shiftId, shiftTitle, shiftDate, shiftStart, shiftEnd });
  });
  // As Agendas Google de quem saiu e de quem entrou acompanham (gcal.js)
  window.dispatchEvent(new CustomEvent('escalamed:escala-alterada', { detail: { groupId, month } }));
}

// O colega já tem outro plantão nesse horário? (aviso antes de aprovar)
async function conflictOf(cession) {
  try {
    const [snapshot, liveShifts] = await Promise.all([getDoc(scheduleRef(cession.groupId, cession.month)), loadShifts(cession.groupId)]);
    const schedule = snapshot.data();
    const shifts = scheduleShifts(schedule, liveShifts);
    const { day, shiftId } = parseCellKey(cession.cell);
    const cell = findConflict(schedule?.assignments, shifts, cession.toUid, day, shiftId);
    return cell && shifts[cell.shiftId] ? { ...cell, shift: shifts[cell.shiftId] } : null;
  } catch {
    return null; // sem conseguir conferir, a transação ainda confere o plantão
  }
}

// Aprova ou recusa, com confirmação, avisos na tela e o push. Devolve true se gravou.
export async function answerCession(cession, approveIt, { deciderName } = {}) {
  if (approveIt) {
    const conflict = await conflictOf(cession);
    if (conflict) {
      const { shift, day } = conflict;
      const ok = await confirmDialog({
        title: 'Plantão no mesmo horário',
        message: `${cession.toName} já está no plantão ${shift.title} do dia ${String(day).padStart(2, '0')} (${formatClock(shift.startMinute)} às ${formatClock(shift.endMinute)}), que bate com este horário. Aprovar mesmo assim?`,
        confirmText: 'Aprovar mesmo assim',
      });
      if (!ok) return false;
    }
  } else {
    const ok = await confirmDialog({
      title: 'Recusar a cessão?',
      message: `${cession.name} continua no plantão e recebe o aviso de que a cessão foi recusada.`,
      confirmText: 'Recusar',
      danger: true,
    });
    if (!ok) return false;
  }
  try {
    if (approveIt) {
      await approve(cession, deciderName);
      toast(`Cessão aprovada: ${cession.toName} ficou com o plantão.`, 'success', 6000);
    } else {
      await updateDoc(cessionRef(cession.groupId, cession.docId), { status: 'declined', ...decision(deciderName) });
      toast('Cessão recusada.');
    }
    notifyPush('cessao-resposta', cession.groupId, cession.docId);
    return true;
  } catch (error) {
    toast(error instanceof CessionError ? error.message : firebaseErrorMessage(error), 'error', 6000);
    return false;
  }
}
