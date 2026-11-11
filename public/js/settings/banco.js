// Configurações > Apagar dados (só Dev). Apaga no Firebase os dados da plataforma e mantém as
// contas: grupos (com membros, convites, turnos, histórico e escalas), aprovações de cargo e
// unidades de saúde. Perfis (users), dados pessoais, logins e config/ ficam como estão.
// Lê sempre do servidor (não do cache local) e cada lote só conta como apagado quando o
// Firebase confirma. No fim, o serviço de contas tira os plantões das Agendas Google.
// As regras deixam o Dev apagar tudo (match /{document=**} no firestore.rules).
import {
  collection,
  doc,
  getCountFromServer,
  getDocsFromServer,
  writeBatch,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db } from '../firebase.js';
import { devClearCalendars } from '../auth-api.js';
import { icon } from '../icons.js';
import { toast, setLoading, firebaseErrorMessage } from '../ui.js';

const CONFIRM_WORD = 'APAGAR';
const BATCH_SIZE = 400; // o Firestore aceita até 500 gravações por lote
// Subcoleções de cada grupo (as mesmas do firestore.rules)
const GROUP_SUBCOLLECTIONS = ['members', 'invites', 'shifts', 'movements', 'schedules'];
// Coleções apagadas por inteiro, além dos grupos
const FLAT_COLLECTIONS = [
  { id: 'access', label: 'Aprovações de cargo' },
  { id: 'healthUnits', label: 'Unidades de saúde' },
];

const plural = (n, one, many) => `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`;

// Apaga em lotes; só segue para o próximo quando o servidor confirma o anterior
async function deleteRefs(refs) {
  for (let i = 0; i < refs.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    refs.slice(i, i + BATCH_SIZE).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
  return refs.length;
}

const refsOf = async (path) => (await getDocsFromServer(collection(db, path))).docs.map((d) => d.ref);

// Um grupo: primeiro as subcoleções, por último o próprio grupo (se parar no meio,
// o grupo continua aparecendo e dá para rodar de novo)
async function deleteGroup(groupId) {
  const lists = await Promise.all(GROUP_SUBCOLLECTIONS.map((name) => refsOf(`groups/${groupId}/${name}`)));
  return deleteRefs([...lists.flat(), doc(db, 'groups', groupId)]);
}

function errorText(error) {
  if (error?.code === 'resource-exhausted') {
    return 'O Firebase chegou ao limite de exclusões do dia (plano gratuito: 20 mil). O que já foi apagado ficou apagado; rode de novo amanhã para terminar.';
  }
  return firebaseErrorMessage(error) ?? 'Não foi possível apagar. Tente de novo.';
}

export default {
  hash: 'banco',

  render(container) {
    container.innerHTML = `
      <div class="alert alert-error wipe-warning" role="note">
        Apaga de verdade no Firebase e não tem como desfazer. Use só em teste ou para recomeçar do zero.
      </div>
      <h2 class="settings-label">O que é apagado</h2>
      <ul class="wipe-counts" id="wipe-counts" aria-live="polite"><li class="muted">Contando…</li></ul>
      <p class="muted text-sm wipe-note">
        Grupos levam junto membros, convites, turnos, escalas e histórico. Os plantões também saem das
        Agendas Google conectadas. Gestores, Coordenadores e Administrativos voltam a aguardar aprovação.
      </p>
      <h2 class="settings-label">O que continua</h2>
      <ul class="settings-bullets">
        <li>Perfis, dados pessoais e logins de todo mundo (as pessoas entram numa plataforma vazia)</li>
        <li>Administradores da plataforma (config/admins) e o cargo Dev</li>
      </ul>
      <form id="wipe-form" class="wipe-form" novalidate>
        <div class="field">
          <label class="label" for="wipe-confirm">Para confirmar, digite <strong>${CONFIRM_WORD}</strong></label>
          <input class="input" id="wipe-confirm" name="confirm" type="text" autocomplete="off" spellcheck="false" />
        </div>
        <p class="muted text-sm" id="wipe-status" role="status" aria-live="polite"></p>
        <button type="submit" class="btn btn-danger" id="wipe-submit" disabled>${icon('trash')}Apagar dados</button>
      </form>`;

    const countsEl = container.querySelector('#wipe-counts');
    const form = container.querySelector('#wipe-form');
    const input = form.confirm;
    const submit = container.querySelector('#wipe-submit');
    const status = container.querySelector('#wipe-status');
    let running = false;

    const ready = () => input.value.trim().toUpperCase() === CONFIRM_WORD;
    input.addEventListener('input', () => (submit.disabled = running || !ready()));

    async function loadCounts() {
      try {
        const items = [{ id: 'groups', label: 'Grupos e escalas individuais' }, ...FLAT_COLLECTIONS];
        const counts = await Promise.all(items.map((c) => getCountFromServer(collection(db, c.id))));
        countsEl.innerHTML = items
          .map((c, i) => `<li><span>${c.label}</span><strong>${counts[i].data().count.toLocaleString('pt-BR')}</strong></li>`)
          .join('');
      } catch (error) {
        countsEl.innerHTML = `<li class="muted">${firebaseErrorMessage(error) ?? 'Não foi possível contar.'}</li>`;
      }
    }

    async function wipe() {
      let deleted = 0;
      const groups = (await getDocsFromServer(collection(db, 'groups'))).docs;
      for (const [i, group] of groups.entries()) {
        status.textContent = `Apagando grupo ${i + 1} de ${groups.length}: ${group.data().name ?? group.id}…`;
        deleted += await deleteGroup(group.id);
      }
      for (const { id, label } of FLAT_COLLECTIONS) {
        status.textContent = `Apagando ${label.toLowerCase()}…`;
        deleted += await deleteRefs(await refsOf(id));
      }
      return { deleted, groups: groups.length };
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (running || !ready()) return;
      if (!navigator.onLine) {
        toast('Sem internet. Conecte-se para apagar direto no Firebase.', 'error');
        return;
      }
      running = true;
      setLoading(submit, true);
      input.disabled = true;
      try {
        const { deleted, groups } = await wipe();
        status.textContent = 'Limpando as Agendas Google…';
        let calendars = '';
        try {
          const people = await devClearCalendars();
          if (people) calendars = ` Os plantões saem das Agendas Google de ${plural(people, 'pessoa', 'pessoas')} nos próximos minutos.`;
        } catch (error) {
          calendars = ` Não foi possível limpar as Agendas Google (${firebaseErrorMessage(error)}).`;
        }
        status.textContent = `Pronto: ${plural(deleted, 'documento apagado', 'documentos apagados')} no Firebase, ${plural(groups, 'grupo', 'grupos')}.${calendars}`;
        toast('Dados apagados no Firebase.', 'success');
        input.value = '';
      } catch (error) {
        console.error(error);
        status.textContent = errorText(error);
        toast('A exclusão parou no meio. Veja o aviso na tela.', 'error', 6000);
      } finally {
        running = false;
        setLoading(submit, false);
        input.disabled = false;
        submit.disabled = !ready();
        loadCounts();
      }
    });

    return { onShow: loadCounts };
  },
};
