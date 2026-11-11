// Cargos da plataforma e o que cada um pode fazer em cada grupo.
// Sem Firebase: testado com `node --test`. A garantia de verdade fica no firestore.rules,
// que repete estas regras; aqui é só para mostrar ou esconder botões, abas e grupos.
//
// O cargo é escolhido no cadastro (users/{uid}.categoryId). Gestor, Coordenador de escala e
// Administrativo só valem depois de aprovados (access/{uid}); o administrador da plataforma
// (config/admins) vale como Gestor. Sem cargo aprovado, a pessoa vê só os grupos em que está.
//   Gestor: vê e altera todos os grupos de equipe; aprova cargos.
//   Coordenador de escala: altera a escala e os membros dos grupos em que o Gestor o marcou.
//   Administrativo: vê todos os grupos de equipe, só o que está publicado, sem alterar.
//   Médico (e quem ainda não foi aprovado): vê os grupos em que está, só o publicado.

// Cargo escolhido (categoryId) → cargo de acesso, para os que passam por aprovação
export const ACCESS_OF_CATEGORY = {
  gestor: 'gestor',
  'coordenador-escala': 'coordenador',
  administrativo: 'administrativo',
};

// Cargo que vale: 'gestor' | 'coordenador' | 'administrativo' | null
export function platformRoleOf({ isAdmin = false, access = null } = {}) {
  if (isAdmin) return 'gestor';
  if (access?.approved === true) return ACCESS_OF_CATEGORY[access.categoryId] ?? null;
  return null;
}

// Situação do cargo pedido: 'none' (não precisa aprovar), 'pending', 'approved' ou 'declined'.
// A decisão vale para o cargo daquele momento: trocou de cargo, volta a aguardar.
export function approvalState(profile, access) {
  const categoryId = profile?.categoryId;
  if (!ACCESS_OF_CATEGORY[categoryId]) return 'none';
  if (access?.categoryId !== categoryId) return 'pending';
  return access.approved === true ? 'approved' : 'declined';
}

// O que o cargo libera fora dos grupos
export const seesAllGroups = (platformRole) => platformRole === 'gestor' || platformRole === 'administrativo';
export const canCreateTeam = (platformRole) => platformRole === 'gestor' || platformRole === 'coordenador';
export const canApprove = (platformRole) => platformRole === 'gestor';
export const seesReports = (platformRole) => ['gestor', 'coordenador', 'administrativo'].includes(platformRole);

// Papel de alguém num grupo (nome mostrado no selo do cabeçalho)
export const GROUP_ROLES = {
  gestor: 'Gestor',
  coordinator: 'Coordenador de escala',
  administrativo: 'Administrativo',
  member: 'Membro',
  owner: 'Escala individual',
};

export const isMember = (group, uid) => Boolean(uid && group?.memberIds?.includes(uid));
// Marcado como coordenador no grupo (o direito só vale com o cargo aprovado: ver groupRole)
export const isMarkedCoordinator = (group, uid) => Boolean(uid && group?.coordinatorIds?.includes(uid));

// 'gestor' | 'coordinator' | 'administrativo' | 'member' | 'owner' | null
export function groupRole(group, uid, platformRole) {
  if (!group || !uid) return null;
  if (group.type === 'personal') return group.ownerId === uid ? 'owner' : null;
  if (platformRole === 'gestor') return 'gestor';
  if (platformRole === 'coordenador' && isMarkedCoordinator(group, uid)) return 'coordinator';
  if (platformRole === 'administrativo') return 'administrativo';
  return isMember(group, uid) ? 'member' : null;
}

// Ações e papéis que podem fazê-las.
// "own": o membro comum só vê o que é dele (relatório).
const MATRIX = {
  viewDraft: ['gestor', 'coordinator', 'owner'],
  editSchedule: ['gestor', 'coordinator', 'owner'],
  editSettings: ['gestor', 'owner'], // turnos, valores e dados do grupo (o coordenador só ao criar)
  manageMembers: ['gestor', 'coordinator'], // convidar e remover
  setCoordinators: ['gestor'],
  viewHistory: ['gestor', 'coordinator', 'administrativo', 'member', 'owner'],
  viewReports: ['gestor', 'coordinator', 'administrativo', 'owner'],
  viewOwnReport: ['member'],
  deleteGroup: ['gestor', 'owner'],
};

export const ACTIONS = Object.keys(MATRIX);

export function can(role, action) {
  return Boolean(role && MATRIX[action]?.includes(role));
}

// Grupo ainda no assistente de criação: o coordenador que criou também ajusta turnos e dados
export function canEditSettings(group, role) {
  return can(role, 'editSettings') || (role === 'coordinator' && group?.setupStep !== 'done');
}

// Trocar, ceder, pegar vaga, check-in: quem está no grupo (está na escala)
export const canTakeShifts = (group, uid) => isMember(group, uid);

// Sair do grupo: qualquer membro de um grupo de equipe
export const canLeave = (group, uid) => group?.type === 'team' && isMember(group, uid);

// O coordenador remove membros, mas não outro coordenador (isso é com o Gestor)
export function canRemoveMember(group, role, targetUid, myUid) {
  if (!can(role, 'manageMembers') || targetUid === myUid) return false;
  return role === 'gestor' || !isMarkedCoordinator(group, targetUid);
}

// Campos do grupo sem a pessoa (remover membro ou sair do grupo)
export function removeMemberPatch(group, uid) {
  return {
    memberIds: (group.memberIds ?? []).filter((id) => id !== uid),
    coordinatorIds: (group.coordinatorIds ?? []).filter((id) => id !== uid),
  };
}

// Marcar ou desmarcar alguém como coordenador do grupo
export function coordinatorPatch(group, uid, on) {
  const others = (group.coordinatorIds ?? []).filter((id) => id !== uid);
  return { coordinatorIds: on ? [...others, uid] : others };
}
