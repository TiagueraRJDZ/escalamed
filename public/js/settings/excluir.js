// Configurações > Excluir minha conta.
// Bloqueia se a pessoa é gestora de um grupo com outros membros (precisa transferir a gestão)
// ou se tem plantões de hoje em diante numa escala publicada. Senão: sai dos grupos (ou apaga
// os que só tinham ela), apaga o perfil e os dados pessoais, libera o nome de usuário e
// apaga o login.
import { deleteUser } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { collection, doc, getDoc, getDocs, query, where, writeBatch } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { auth, db } from '../firebase.js';
import { signOutUser } from '../auth.js';
import { changeUsername, reauthenticate, hasPassword } from '../auth-api.js';
import { avatarHtml } from '../layout.js';
import { setupPasswordToggles } from '../auth-ui.js';
import { professionLabel } from '/data/categories.js';
import { removeMember } from '../members.js';
import { escapeHtml, toast, setLoading, clearFormErrors, clearErrorsWhileTyping } from '../ui.js';
import { showErrors, handleAuthError, createDialog } from './shared.js';

const MONTHS_AHEAD = 12; // escalas futuras conferidas (mês atual + 12)

const CONFIRM_DIALOG = {
  id: 'modal-delete-account',
  formId: 'form-delete',
  title: 'Excluir minha conta',
  className: 'modal-danger',
  body: `
    <div class="alert form-alert" role="alert" hidden></div>
    <p class="muted" style="margin-bottom:var(--esp-3)">Esta ação não pode ser desfeita. Seu perfil e seus dados pessoais são apagados e você sai de todos os grupos.</p>
    <input type="email" name="username" autocomplete="username" hidden />
    <div class="field">
      <label class="label" for="delete-confirm">Digite <strong>EXCLUIR</strong> para confirmar</label>
      <input class="input" id="delete-confirm" name="confirmText" type="text" autocomplete="off" autocapitalize="characters" required />
      <span class="field-error"></span>
    </div>
    <div class="field" id="delete-password-field">
      <label class="label" for="delete-password">Sua senha</label>
      <div class="password-wrap"><input class="input" id="delete-password" name="password" type="password" autocomplete="current-password" required /></div>
      <span class="field-error"></span>
    </div>`,
  footer: `
    <button type="button" class="btn btn-secondary" data-close>Cancelar</button>
    <button type="submit" class="btn btn-danger">Excluir minha conta</button>`,
};

const pad = (n) => String(n).padStart(2, '0');

// "2026-11", "2026-12", ... (mês atual e os próximos)
function upcomingMonths(today) {
  return Array.from({ length: MONTHS_AHEAD + 1 }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  });
}

// Grupos de equipe com plantão da pessoa de hoje em diante (só escalas publicadas).
// Células da escala: assignments["07_<turno>"] = [uid, ...].
async function groupsWithFutureShifts(groups, uid) {
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const months = upcomingMonths(today);
  const teams = groups.filter((g) => g.type === 'team');
  const found = await Promise.all(
    teams.map(async (group) => {
      const snapshots = await Promise.all(
        // Rascunho de quem não é da gestão não pode ser lido: conta como "sem plantão"
        months.map((m) => getDoc(doc(db, 'groups', group.id, 'schedules', m)).catch(() => null)),
      );
      const has = snapshots.some((snap) => {
        if (!snap?.exists() || snap.data().status !== 'published') return false;
        return Object.entries(snap.data().assignments ?? {}).some(
          ([cell, uids]) => Array.isArray(uids) && uids.includes(uid) && `${snap.id}-${cell.slice(0, 2)}` >= todayKey,
        );
      });
      return has ? group : null;
    }),
  );
  return found.filter(Boolean);
}

export default {
  hash: 'excluir',

  render(container, ctx) {
    const { user, profile } = ctx;
    container.innerHTML = `
      <div class="delete-card" id="delete-card"></div>

      <div class="form-grid cols-2 delete-info">
      <div>
      <h3 class="settings-label">Sobre excluir sua conta</h3>
      <ul class="settings-bullets">
        <li>Ao excluir, você é removido automaticamente dos grupos de escala dos quais participa.</li>
        <li>Não é possível excluir se houver plantões futuros a cumprir ou se você for gestor de algum grupo com outros membros.</li>
        <li>Plantões em escalas passadas continuam com o seu nome no histórico.</li>
      </ul>
      </div>
      <div>
      <h3 class="settings-label">Algumas alternativas</h3>
      <ul class="settings-bullets">
        <li>Quer só corrigir seus dados? Atualize em <a href="#conta">Informações da conta</a>.</li>
        <li>Quer sair de uma escala? Abra o grupo e use <strong>Sair do grupo</strong>.</li>
        <li>Precisa de ajuda? Fale com o administrador do EscalaMed na sua unidade.</li>
      </ul>
      </div>
      </div>

      <div id="delete-blockers" aria-live="polite"></div>
      <button type="button" class="btn-link is-danger delete-open" id="delete-open">Excluir minha conta</button>`;

    const blockersEl = container.querySelector('#delete-blockers');
    const openButton = container.querySelector('#delete-open');

    function renderCard() {
      const details = [professionLabel(profile), profile.username ? `@${profile.username}` : ''].filter(Boolean);
      container.querySelector('#delete-card').innerHTML = `
        ${avatarHtml(profile, 'avatar delete-avatar')}
        <div><strong>${escapeHtml(profile.name ?? '')}</strong>
        ${details.map((d) => `<span>${escapeHtml(d)}</span>`).join('')}</div>`;
    }

    const myGroups = async () =>
      (await getDocs(query(collection(db, 'groups'), where('memberIds', 'array-contains', user.uid)))).docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));

    // Gestor de grupo com outras pessoas precisa transferir a gestão antes
    const managed = (groups) => groups.filter((g) => g.type === 'team' && g.managerIds.includes(user.uid) && g.memberIds.length > 1);

    const groupLinks = (groups, hash = '') =>
      `<ul>${groups
        .map((g) => `<li><a href="/group.html?id=${encodeURIComponent(g.id)}${hash}">${escapeHtml(g.name)}</a></li>`)
        .join('')}</ul>`;

    // Confere os bloqueios e mostra o que falta resolver. Devolve true se pode excluir.
    async function checkBlockers() {
      openButton.disabled = true;
      blockersEl.innerHTML = '<p class="muted text-sm">Conferindo seus grupos e plantões…</p>';
      try {
        const groups = await myGroups();
        const [asManager, withShifts] = [managed(groups), await groupsWithFutureShifts(groups, user.uid)];
        blockersEl.innerHTML = [
          asManager.length
            ? `<div class="alert alert-warning">Você é gestor destes grupos. Transfira a gestão antes (na aba Membros de cada um):${groupLinks(asManager, '#membros')}</div>`
            : '',
          withShifts.length
            ? `<div class="alert alert-warning">Você tem plantões a cumprir nestes grupos. Peça para sair da escala ou espere os plantões passarem:${groupLinks(withShifts)}</div>`
            : '',
        ].join('');
        const ok = !asManager.length && !withShifts.length;
        openButton.disabled = !ok;
        return { ok, groups };
      } catch {
        blockersEl.innerHTML = '<div class="alert alert-error">Não foi possível conferir seus grupos agora. Tente de novo em instantes.</div>';
        return { ok: false, groups: [] };
      }
    }

    // ---------- Confirmação ----------
    const dialog = createDialog(CONFIRM_DIALOG);
    const form = dialog.querySelector('#form-delete');
    setupPasswordToggles(dialog);
    clearErrorsWhileTyping(form);

    openButton.addEventListener('click', () => {
      form.reset();
      clearFormErrors(form);
      form.username.value = ctx.currentEmail();
      dialog.querySelector('#delete-password-field').hidden = !hasPassword();
      dialog.showModal();
      form.confirmText.focus();
    });

    // Apaga um grupo inteiro (escala individual, ou equipe em que só sobrou a pessoa)
    async function deleteWholeGroup(group) {
      const batch = writeBatch(db);
      for (const sub of ['shifts', 'schedules', 'movements', 'invites', 'members']) {
        const snapshot = await getDocs(collection(db, 'groups', group.id, sub));
        snapshot.docs.forEach((d) => batch.delete(d.ref));
      }
      batch.delete(doc(db, 'groups', group.id));
      await batch.commit();
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearFormErrors(form);
      const errors = [];
      if (form.confirmText.value.trim() !== 'EXCLUIR') errors.push([form.confirmText, 'Digite EXCLUIR, em maiúsculas.']);
      if (hasPassword() && !form.password.value) errors.push([form.password, 'Informe sua senha.']);
      if (showErrors(errors)) return;

      const button = form.querySelector('[type=submit]');
      setLoading(button, true);
      try {
        await reauthenticate(form.password.value);
        const { ok, groups } = await checkBlockers();
        if (!ok) {
          dialog.close();
          toast('Resolva os itens indicados antes de excluir a conta.', 'error', 6000);
          return;
        }
        for (const group of groups) {
          const alone = group.memberIds.length === 1 && group.ownerId === user.uid;
          if (alone) await deleteWholeGroup(group);
          else await removeMember(group, user.uid);
        }
        const batch = writeBatch(db);
        batch.delete(ctx.privateRef);
        batch.delete(ctx.userRef);
        await batch.commit();
        if (profile.username) await changeUsername(''); // libera o nome de usuário
        await deleteUser(auth.currentUser);
        toast('Sua conta foi excluída.', 'success');
        await signOutUser(); // volta para a tela de login
      } catch (error) {
        handleAuthError(form, error, form.password);
      } finally {
        if (button.isConnected) setLoading(button, false);
      }
    });

    return {
      onShow() {
        renderCard();
        checkBlockers();
      },
    };
  },
};
