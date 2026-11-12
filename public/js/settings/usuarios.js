// Configurações > Usuários: administrador da plataforma (uid em config/admins) e Gestor aprovado.
// Quem pediu Gestor, Coordenador de escala ou Administrativo e ainda não foi aprovado (ou foi
// recusado) está sem acesso à plataforma: aparece no topo da lista, com a linha destacada e
// os botões Aprovar/Recusar (gravam access/{uid}). Cada linha mostra o selo do cargo.
// Só o administrador vê o login (e-mail, usuário, situação), que vem do serviço de contas, e as
// ações de senha provisória, inativar e excluir (o serviço confere em config/admins).
import { collection, doc, getDoc, getDocs, setDoc, writeBatch, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db } from '../firebase.js';
import { isProfileComplete } from '../auth.js';
import { adminAccounts, adminTemporaryPassword, adminSetAccess, adminDeleteAccount } from '../auth-api.js';
import { avatarHtml } from '../layout.js';
import { icon } from '../icons.js';
import { professionLabel, councilLabel, categoryName } from '/data/categories.js';
import { approvalState } from '../permissions.js';
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

async function loadPlatformUsers(ui, isAdmin) {
  const [accounts, profiles, decisions, admins] = await Promise.allSettled([
    isAdmin ? adminAccounts() : Promise.resolve(null),
    getDocs(collection(db, 'users')),
    getDocs(collection(db, 'access')),
    getDoc(doc(db, 'config', 'admins')),
  ]);
  if (profiles.status === 'rejected') throw profiles.reason;

  const profileOf = new Map();
  profiles.value.docs.forEach((d) => profileOf.set(d.id, d.data()));
  const accessOf = new Map();
  if (decisions.status === 'fulfilled') decisions.value.docs.forEach((d) => accessOf.set(d.id, d.data()));
  const adminIds = new Set(admins.status === 'fulfilled' ? (admins.value.data()?.uids ?? []) : []);

  const people = new Map();
  if (isAdmin && accounts.status === 'fulfilled') {
    ui.alert.hidden = true;
    accounts.value.forEach((a) => people.set(a.uid, { ...a, profile: profileOf.get(a.uid) ?? null }));
  } else if (isAdmin) {
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
      semLogin: isAdmin && accounts.status === 'fulfilled',
    });
  });

  return [...people.values()]
    .map((p) => ({
      ...p,
      name: p.profile?.name || p.email || 'Sem nome',
      isAdmin: adminIds.has(p.uid),
      access: accessOf.get(p.uid) ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

// Situação do cargo de alguém (o administrador da plataforma não passa por aprovação)
const stateOf = (p) => (p.isAdmin ? 'none' : approvalState(p.profile, p.access));

// Sem acesso à plataforma por causa do cargo: aguardando aprovação ou recusado
const isWaiting = (p) => Boolean(p.profile) && stateOf(p) === 'pending';
const isBarred = (p) => Boolean(p.profile) && ['pending', 'declined'].includes(stateOf(p));

const APPROVAL_BADGE = {
  pending: `<span class="badge badge-warning">${icon('lock')}Sem acesso · aguardando aprovação</span>`,
  declined: `<span class="badge badge-danger">${icon('lock')}Sem acesso · cargo recusado</span>`,
};

// Na lista: primeiro quem aguarda aprovação, depois os recusados, depois o resto (por nome)
const listOrder = (p) => (isWaiting(p) ? 0 : isBarred(p) ? 1 : 2);

export default {
  hash: 'usuarios',

  render(container, ctx) {
    const { user } = ctx;
    // Administrador: tudo. Gestor: só aprovar cargos (a lista vem só dos perfis).
    const isAdmin = () => Boolean(ctx.access?.isAdmin);
    container.innerHTML = `
      <div class="users-header">
        <p class="muted users-intro" id="users-intro"></p>
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
      intro: container.querySelector('#users-intro'),
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
      const state = stateOf(p);
      const barred = isBarred(p);
      const login = [p.usuario ? `@${p.usuario}` : '', p.email ?? ''].filter(Boolean).join(' · ');
      const work = profile ? [professionLabel(profile), councilLabel(profile.council)].filter(Boolean).join(' · ') : '';
      // Sem acesso: o cargo pedido vem primeiro, em destaque
      const details = barred
        ? `Pediu o cargo <strong>${escapeHtml(categoryName(profile.categoryId))}</strong>` +
          escapeHtml([login, councilLabel(profile.council)].filter(Boolean).map((t) => ` · ${t}`).join(''))
        : escapeHtml([login, work].filter(Boolean).join(' · ') || 'Sem dados de login');
      const badges = [
        me ? '<span class="badge badge-primary">Você</span>' : '',
        // Só dá para saber se a própria conta é Dev (a lista fica no firestore.rules)
        me && ctx.access?.isDev ? '<span class="badge badge-primary">Dev</span>' : '',
        p.isAdmin && !(me && ctx.access?.isDev) ? '<span class="badge badge-primary">Administrador</span>' : '',
        APPROVAL_BADGE[state] ?? '',
        p.inativa ? '<span class="badge badge-danger">Inativo</span>' : '',
        !isProfileComplete(profile) && !p.semLogin ? '<span class="badge badge-muted">Cadastro incompleto</span>' : '',
        p.semLogin ? '<span class="badge badge-muted">Sem login</span>' : '',
      ].join('');
      const off = me || p.semLogin ? ' disabled' : '';
      const name = escapeHtml(p.name);
      const accessButton = p.inativa
        ? `<button type="button" class="btn-icon" data-action="access" title="Reativar acesso" aria-label="Reativar acesso de ${name}"${off}>${icon('userCheck')}</button>`
        : `<button type="button" class="btn-icon" data-action="access" title="Inativar acesso" aria-label="Inativar acesso de ${name}"${off}>${icon('ban')}</button>`;
      const classes = ['member-item', 'user-item', p.inativa ? 'is-inactive' : '', barred ? `is-barred is-${state}` : ''];
      return `<li class="${classes.filter(Boolean).join(' ')}" data-uid="${escapeHtml(p.uid)}">
        ${avatarHtml(profile ?? { name: p.name }, 'avatar member-avatar')}
        <div class="member-info">
          <strong>${name}${badges}</strong>
          <span>${details}</span>
        </div>
        <div class="user-actions">
          ${decisionButtons(p)}
          ${roleButton(p, name)}
          ${
            isAdmin()
              ? `<button type="button" class="btn-icon" data-action="password" title="Redefinir senha" aria-label="Redefinir senha de ${name}"${off}>${icon('keyRound')}</button>
          ${accessButton}
          <button type="button" class="btn-icon" data-action="delete" title="Excluir acesso" aria-label="Excluir acesso de ${name}"${me ? ' disabled' : ''}>${icon('trash')}</button>`
              : ''
          }
        </div>
      </li>`;
    }

    // Ninguém decide sobre si mesmo, exceto o Dev
    const decidesFor = (p) => p.uid !== user.uid || Boolean(ctx.access?.isDev);

    // Aprovado: "Retirar aprovação". Recusado: "Aprovar".
    function roleButton(p, name) {
      if (!decidesFor(p)) return '';
      const state = stateOf(p);
      const role = escapeHtml(categoryName(p.profile?.categoryId));
      if (state === 'approved') {
        return `<button type="button" class="btn-icon" data-action="revoke" title="Retirar aprovação de ${role}" aria-label="Retirar aprovação de ${role} de ${name}">${icon('userMinus')}</button>`;
      }
      if (state === 'declined') {
        return `<button type="button" class="btn-icon" data-action="approve" title="Aprovar como ${role}" aria-label="Aprovar ${name} como ${role}">${icon('userCheck')}</button>`;
      }
      return '';
    }

    // Aguardando aprovação: Recusar e Aprovar na própria linha
    function decisionButtons(p) {
      if (!isWaiting(p) || !decidesFor(p)) return '';
      return `<span class="user-decision">
          <button type="button" class="btn btn-secondary" data-action="decline">Recusar</button>
          <button type="button" class="btn btn-primary" data-action="approve">${icon('check')}Aprovar</button>
        </span>`;
    }

    function renderUsers() {
      ui.intro.textContent = isAdmin()
        ? 'Todas as contas da plataforma. Ao fim de cada linha: aprovar cargo, redefinir senha, inativar acesso e excluir acesso.'
        : 'Pessoas da plataforma e o cargo de cada uma. Aprove ou recuse os pedidos de Gestor, Coordenador de escala e Administrativo.';
      const term = normalize(ui.search.value);
      const shown = platformUsers
        .filter((p) => !term || normalize(`${p.name} ${p.usuario ?? ''} ${p.email ?? ''}`).includes(term))
        .sort((a, b) => listOrder(a) - listOrder(b)); // estável: dentro de cada grupo, segue por nome
      ui.list.innerHTML = shown.map(rowHtml).join('');
      ui.empty.hidden = shown.length > 0;
      ui.empty.textContent = platformUsers.length ? 'Ninguém encontrado.' : 'Nenhum usuário na plataforma.';
      const inactive = platformUsers.filter((p) => p.inativa).length;
      const waiting = platformUsers.filter(isWaiting).length;
      ui.count.textContent =
        `${platformUsers.length} ${platformUsers.length === 1 ? 'usuário' : 'usuários'}` +
        (waiting ? ` · ${waiting} aguardando aprovação` : '') +
        (inactive ? ` · ${inactive} ${inactive === 1 ? 'inativo' : 'inativos'}` : '');
    }

    async function load() {
      if (platformUsers) return;
      ui.list.innerHTML = '<li class="muted">Carregando usuários…</li>';
      try {
        platformUsers = await loadPlatformUsers(ui, isAdmin());
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

    // Avisa o app da pessoa que a sessão foi encerrada (auth.js: watchSession): a tela dela sai
    // na hora, com o aviso de acesso expirado. Quem derruba o login de verdade é o serviço de contas.
    function endSession(person) {
      setDoc(doc(db, 'sessions', person.uid), { endedAt: serverTimestamp(), endedBy: user.uid }).catch(() => {});
    }

    async function resetPassword(person) {
      const ok = await confirmDialog({
        title: 'Redefinir senha?',
        message: `A senha atual de ${person.name} deixa de funcionar e as sessões abertas são encerradas. A pessoa entra com a senha provisória e cria uma nova.`,
        confirmText: 'Gerar senha provisória',
      });
      if (!ok) return;
      endSession(person); // sai na hora, sem esperar o serviço de contas
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
      // Na hora: a pessoa sai já com o aviso (sessions/{uid}) e a linha muda, sem esperar o
      // serviço de contas (que leva alguns segundos). Se ele falhar, a linha volta como estava.
      if (!activate) endSession(person);
      person.inativa = !activate;
      renderUsers();
      try {
        await adminSetAccess(person.uid, activate);
      } catch (error) {
        person.inativa = activate;
        renderUsers();
        throw error;
      }
      toast(activate ? `Acesso de ${person.name} reativado.` : `Acesso de ${person.name} inativado.`, 'success');
    }

    async function deleteAccess(person) {
      const ok = await confirmDialog({
        title: 'Excluir acesso?',
        message: `O login e o perfil de ${person.name} são apagados e não dá para desfazer. Nos grupos, o nome continua no histórico até o Gestor ou um coordenador remover. Se for por um tempo, prefira Inativar.`,
        confirmText: 'Excluir',
        danger: true,
      });
      if (!ok) return;
      if (!person.semLogin) endSession(person); // sai na hora, antes de o perfil sumir
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

    // Aprovar ou recusar o cargo pedido (vale para o cargo daquele momento)
    async function decide(person, approved) {
      const categoryId = person.profile?.categoryId;
      const role = categoryName(categoryId);
      const revoking = !approved && stateOf(person) === 'approved';
      if (!approved) {
        const ok = await confirmDialog({
          title: revoking ? 'Retirar aprovação?' : 'Recusar cargo?',
          message: revoking
            ? `${person.name} deixa de ter o acesso de ${role} e fica sem acesso à plataforma até ser aprovado(a) de novo.`
            : `${person.name} continua sem acesso à plataforma. Dá para aprovar depois, pela linha na lista de usuários.`,
          confirmText: revoking ? 'Retirar' : 'Recusar',
          danger: true,
        });
        if (!ok) return;
      }
      const decision = { categoryId, approved, decidedBy: user.uid, decidedAt: serverTimestamp() };
      await setDoc(doc(db, 'access', person.uid), decision);
      person.access = { categoryId, approved };
      renderUsers();
      toast(
        approved
          ? `${person.name} aprovado(a) como ${role}.`
          : revoking
            ? `Aprovação de ${role} retirada de ${person.name}.`
            : `Pedido de ${role} de ${person.name} recusado.`,
        'success',
      );
    }

    const ACTIONS = {
      approve: (p) => decide(p, true),
      decline: (p) => decide(p, false),
      revoke: (p) => decide(p, false),
      password: resetPassword,
      access: toggleAccess,
      delete: deleteAccess,
    };

    container.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-action]');
      if (!button || button.disabled) return;
      const person = platformUsers?.find((p) => p.uid === button.closest('[data-uid]')?.dataset.uid);
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
