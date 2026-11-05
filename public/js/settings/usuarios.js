// Configurações > Usuários: só para administradores da plataforma (uid em config/admins).
// Todas as contas: o login (e-mail, usuário, situação) vem do serviço de contas e o perfil
// (nome, profissão, foto) do Firestore. As ações passam pelo serviço de contas, que confere
// em config/admins se quem pede é administrador.
import { collection, doc, getDocs, writeBatch } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db } from '../firebase.js';
import { isProfileComplete } from '../auth.js';
import { adminAccounts, adminTemporaryPassword, adminSetAccess, adminDeleteAccount } from '../auth-api.js';
import { avatarHtml } from '../layout.js';
import { icon } from '../icons.js';
import { professionLabel, councilLabel } from '/data/categories.js';
import { normalize } from '../validators.js';
import { escapeHtml, toast, confirmDialog, setLoading, firebaseErrorMessage } from '../ui.js';
import { createDialog } from './shared.js';

const TEMP_PASSWORD_DIALOG = {
  id: 'modal-temp-password',
  title: 'Senha provisória',
  body: `
    <p class="muted" id="temp-password-text"></p>
    <div class="copy-field">
      <input class="input temp-password" id="temp-password" type="text" readonly aria-label="Senha provisória" />
      <button type="button" class="btn btn-secondary" id="copy-temp-password">Copiar</button>
    </div>`,
  footer: '<button type="button" class="btn btn-primary" data-close>Pronto</button>',
};

async function loadPlatformUsers(ui) {
  const [accounts, profiles] = await Promise.allSettled([adminAccounts(), getDocs(collection(db, 'users'))]);
  if (accounts.status === 'rejected' && profiles.status === 'rejected') throw accounts.reason;

  const profileOf = new Map();
  if (profiles.status === 'fulfilled') profiles.value.docs.forEach((d) => profileOf.set(d.id, d.data()));

  const people = new Map();
  if (accounts.status === 'fulfilled') {
    ui.alert.hidden = true;
    accounts.value.forEach((a) => people.set(a.uid, { ...a, profile: profileOf.get(a.uid) ?? null }));
  } else {
    ui.alert.textContent = `${firebaseErrorMessage(accounts.reason)} A lista mostra só os perfis, sem e-mail e situação do acesso.`;
    ui.alert.hidden = false;
  }
  // Perfil sem login: só é marcado "Sem login" quando a lista de contas veio
  profileOf.forEach((profile, uid) => {
    if (people.has(uid)) return;
    people.set(uid, {
      uid,
      email: null,
      usuario: profile.username ?? null,
      inativa: false,
      profile,
      semLogin: accounts.status === 'fulfilled',
    });
  });

  return [...people.values()]
    .map((p) => ({ ...p, name: p.profile?.name || p.email || 'Sem nome' }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

export default {
  hash: 'usuarios',

  render(container, ctx) {
    const { user } = ctx;
    container.innerHTML = `
      <div class="users-header">
        <p class="muted users-intro">Todas as contas da plataforma. Ao fim de cada linha: redefinir senha, inativar acesso e excluir acesso.</p>
        <span class="muted text-sm" id="users-count"></span>
      </div>
      <div class="alert alert-warning" id="users-alert" hidden></div>
      <div class="input-icon users-search">
        ${icon('search')}
        <input class="input" id="users-search" type="search" placeholder="Procurar por nome, usuário ou e-mail" aria-label="Procurar usuário" autocomplete="off" />
      </div>
      <ul class="member-list" id="users-list" aria-live="polite"></ul>
      <p class="muted users-empty" id="users-empty" hidden></p>`;
    const ui = {
      list: container.querySelector('#users-list'),
      empty: container.querySelector('#users-empty'),
      search: container.querySelector('#users-search'),
      alert: container.querySelector('#users-alert'),
      count: container.querySelector('#users-count'),
    };
    let platformUsers = null;

    function rowHtml(p) {
      const me = p.uid === user.uid;
      const profile = p.profile;
      const login = [p.usuario ? `@${p.usuario}` : '', p.email ?? ''].filter(Boolean).join(' · ');
      const work = profile ? [professionLabel(profile), councilLabel(profile.council)].filter(Boolean).join(' · ') : '';
      const badges = [
        me ? '<span class="badge badge-primary">Você</span>' : '',
        p.inativa ? '<span class="badge badge-danger">Inativo</span>' : '',
        !isProfileComplete(profile) && !p.semLogin ? '<span class="badge badge-muted">Cadastro incompleto</span>' : '',
        p.semLogin ? '<span class="badge badge-muted">Sem login</span>' : '',
      ].join('');
      const off = me || p.semLogin ? ' disabled' : '';
      const name = escapeHtml(p.name);
      const accessButton = p.inativa
        ? `<button type="button" class="btn-icon" data-action="access" title="Reativar acesso" aria-label="Reativar acesso de ${name}"${off}>${icon('userCheck')}</button>`
        : `<button type="button" class="btn-icon" data-action="access" title="Inativar acesso" aria-label="Inativar acesso de ${name}"${off}>${icon('ban')}</button>`;
      return `<li class="member-item user-item${p.inativa ? ' is-inactive' : ''}" data-uid="${escapeHtml(p.uid)}">
        ${avatarHtml(profile ?? { name: p.name }, 'avatar member-avatar')}
        <div class="member-info">
          <strong>${name}${badges}</strong>
          <span>${escapeHtml([login, work].filter(Boolean).join(' · ') || 'Sem dados de login')}</span>
        </div>
        <div class="user-actions">
          <button type="button" class="btn-icon" data-action="password" title="Redefinir senha" aria-label="Redefinir senha de ${name}"${off}>${icon('keyRound')}</button>
          ${accessButton}
          <button type="button" class="btn-icon" data-action="delete" title="Excluir acesso" aria-label="Excluir acesso de ${name}"${me ? ' disabled' : ''}>${icon('trash')}</button>
        </div>
      </li>`;
    }

    function renderUsers() {
      const term = normalize(ui.search.value);
      const shown = platformUsers.filter((p) => !term || normalize(`${p.name} ${p.usuario ?? ''} ${p.email ?? ''}`).includes(term));
      ui.list.innerHTML = shown.map(rowHtml).join('');
      ui.empty.hidden = shown.length > 0;
      ui.empty.textContent = platformUsers.length ? 'Ninguém encontrado.' : 'Nenhum usuário na plataforma.';
      const inactive = platformUsers.filter((p) => p.inativa).length;
      ui.count.textContent =
        `${platformUsers.length} ${platformUsers.length === 1 ? 'usuário' : 'usuários'}` +
        (inactive ? ` · ${inactive} ${inactive === 1 ? 'inativo' : 'inativos'}` : '');
    }

    async function load() {
      if (platformUsers) return;
      ui.list.innerHTML = '<li class="muted">Carregando usuários…</li>';
      try {
        platformUsers = await loadPlatformUsers(ui);
        renderUsers();
      } catch (error) {
        ui.list.innerHTML = '';
        ui.alert.textContent = firebaseErrorMessage(error);
        ui.alert.hidden = false;
      }
    }
    ui.search.addEventListener('input', () => platformUsers && renderUsers());

    // ---------- Ações ----------
    const tempDialog = createDialog(TEMP_PASSWORD_DIALOG);
    tempDialog.addEventListener('close', () => (tempDialog.querySelector('#temp-password').value = ''));
    tempDialog.querySelector('#copy-temp-password').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(tempDialog.querySelector('#temp-password').value);
        toast('Senha copiada.', 'success');
      } catch {
        toast('Não foi possível copiar. Selecione a senha e use Ctrl+C.');
      }
    });

    async function resetPassword(person) {
      const ok = await confirmDialog({
        title: 'Redefinir senha?',
        message: `A senha atual de ${person.name} deixa de funcionar e as sessões abertas são encerradas. A pessoa entra com a senha provisória e cria uma nova.`,
        confirmText: 'Gerar senha provisória',
      });
      if (!ok) return;
      const password = await adminTemporaryPassword(person.uid);
      tempDialog.querySelector('#temp-password-text').innerHTML = `Passe esta senha para <strong>${escapeHtml(person.name)}</strong> por um canal seguro. Ela não fica guardada: anote antes de fechar.`;
      tempDialog.querySelector('#temp-password').value = password;
      tempDialog.showModal();
    }

    async function toggleAccess(person) {
      const activate = person.inativa;
      const ok = await confirmDialog(
        activate
          ? {
              title: 'Reativar acesso?',
              message: `${person.name} volta a conseguir entrar no EscalaMed com a senha de antes.`,
              confirmText: 'Reativar',
            }
          : {
              title: 'Inativar acesso?',
              message: `${person.name} não consegue mais entrar e as sessões abertas são encerradas. Os dados e os grupos continuam como estão, e dá para reativar depois.`,
              confirmText: 'Inativar',
              danger: true,
            },
      );
      if (!ok) return;
      await adminSetAccess(person.uid, activate);
      person.inativa = !activate;
      renderUsers();
      toast(activate ? `Acesso de ${person.name} reativado.` : `Acesso de ${person.name} inativado.`, 'success');
    }

    async function deleteAccess(person) {
      const ok = await confirmDialog({
        title: 'Excluir acesso?',
        message: `O login e o perfil de ${person.name} são apagados e não dá para desfazer. Nos grupos, o nome continua no histórico até o gestor remover. Se for por um tempo, prefira Inativar.`,
        confirmText: 'Excluir',
        danger: true,
      });
      if (!ok) return;
      // Primeiro o perfil (pelas regras: só o administrador ou a própria pessoa); depois o login
      if (person.profile) {
        const batch = writeBatch(db);
        batch.delete(doc(db, 'users', person.uid, 'private', 'data'));
        batch.delete(doc(db, 'users', person.uid));
        await batch.commit();
      }
      if (!person.semLogin) await adminDeleteAccount(person.uid);
      platformUsers = platformUsers.filter((p) => p.uid !== person.uid);
      renderUsers();
      toast(`Acesso de ${person.name} excluído.`, 'success');
    }

    const ACTIONS = { password: resetPassword, access: toggleAccess, delete: deleteAccess };

    ui.list.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-action]');
      if (!button || button.disabled) return;
      const person = platformUsers.find((p) => p.uid === button.closest('[data-uid]').dataset.uid);
      if (!person) return;
      setLoading(button, true);
      try {
        await ACTIONS[button.dataset.action](person);
      } catch (error) {
        toast(firebaseErrorMessage(error) ?? 'Não foi possível concluir.', 'error', 6000);
      } finally {
        if (button.isConnected) setLoading(button, false);
      }
    });

    return { onShow: load };
  },
};
