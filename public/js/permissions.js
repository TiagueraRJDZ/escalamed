// Cargos por grupo e o que cada um pode fazer.
// Sem Firebase: testado com `node --test`. A garantia de verdade fica no firestore.rules,
// que repete estas regras; aqui é só para mostrar ou esconder botões e abas.

export const ROLES = {
  manager: 'Gestor',
  assistant: 'Auxiliar',
  analyst: 'Analista',
  observer: 'Observador',
  staff: 'Plantonista',
};

// Ordem de exibição (seções da lista de grupos, cartões de membros)
export const ROLE_ORDER = ['manager', 'assistant', 'analyst', 'observer', 'staff'];

export const ROLE_LIMITS = { manager: 1, assistant: 3, analyst: 3, observer: 3, staff: Infinity };

// Campo do grupo que guarda cada cargo. Plantonista = está em memberIds e em nenhum destes.
export const ROLE_ARRAY = {
  manager: 'managerIds',
  assistant: 'assistantIds',
  analyst: 'analystIds',
  observer: 'observerIds',
};

export function roleOf(group, uid) {
  if (!group || !uid || !group.memberIds?.includes(uid)) return null;
  for (const [role, field] of Object.entries(ROLE_ARRAY)) {
    if (group[field]?.includes(uid)) return role;
  }
  return 'staff';
}

// Quantos lugares de cada cargo estão ocupados: { manager: 1, assistant: 2, ... }
export function roleUsage(group) {
  const usage = { staff: 0 };
  for (const [role, field] of Object.entries(ROLE_ARRAY)) usage[role] = group?.[field]?.length ?? 0;
  const special = Object.values(usage).reduce((a, b) => a + b, 0);
  usage.staff = Math.max(0, (group?.memberIds?.length ?? 0) - special);
  return usage;
}

export function hasRoom(group, role) {
  return roleUsage(group)[role] < ROLE_LIMITS[role];
}

// Ações e cargos que podem fazê-las.
// "own": plantonista só vê o que é dele (histórico, relatório).
const MATRIX = {
  viewPublished: ['manager', 'assistant', 'analyst', 'observer', 'staff'],
  viewDraft: ['manager', 'assistant', 'analyst'],
  editSchedule: ['manager', 'assistant'],
  editSettings: ['manager'], // turnos, valores, check-in/out, permissões de cessão, dados do grupo
  inviteMembers: ['manager', 'assistant'],
  removeMembers: ['manager', 'assistant'],
  changeRoles: ['manager', 'assistant'], // exceto gestor
  transferManagement: ['manager'],
  viewHistory: ['manager', 'assistant', 'analyst', 'observer'],
  viewOwnHistory: ['staff'],
  viewReports: ['manager', 'assistant', 'analyst'],
  viewOwnReport: ['staff'],
  // Trocar, ceder, pegar vaga, check-in: gestor e auxiliar só se estiverem escalados
  takeShifts: ['manager', 'assistant', 'staff'],
  leaveGroup: ['assistant', 'analyst', 'observer', 'staff'],
};

export const ACTIONS = Object.keys(MATRIX);

export function can(role, action) {
  return Boolean(role && MATRIX[action]?.includes(role));
}

// Cargos que quem pede pode dar a alguém (modal "Alterar perfil").
// O gestor só passa a gestão (transferência); o auxiliar não mexe no gestor.
export function assignableRoles(actorRole) {
  if (actorRole === 'manager') return ['manager', 'assistant', 'analyst', 'observer', 'staff'];
  if (actorRole === 'assistant') return ['assistant', 'analyst', 'observer', 'staff'];
  return [];
}

// Cargos aceitos num convite (gestor nunca é convidado: vira por transferência)
export const INVITE_ROLES = ['staff', 'assistant', 'analyst', 'observer'];

// Novo estado dos campos de cargo ao mudar alguém de cargo.
// Devolve só os campos alterados, para gravar com updateDoc.
// Na transferência de gestão, o gestor antigo vira auxiliar (se houver vaga) ou plantonista.
export function changeRolePatch(group, uid, newRole) {
  const fields = {};
  for (const field of Object.values(ROLE_ARRAY)) fields[field] = (group[field] ?? []).filter((id) => id !== uid);

  if (newRole === 'manager') {
    const previous = group.managerIds?.[0];
    fields.managerIds = [uid];
    if (previous && previous !== uid) {
      fields.assistantIds = fields.assistantIds.filter((id) => id !== previous);
      if (fields.assistantIds.length < ROLE_LIMITS.assistant) fields.assistantIds.push(previous);
    }
  } else if (ROLE_ARRAY[newRole]) {
    fields[ROLE_ARRAY[newRole]].push(uid);
  }
  return fields;
}

// Campos de cargo sem a pessoa (remover membro ou sair do grupo)
export function removeMemberPatch(group, uid) {
  const patch = { memberIds: (group.memberIds ?? []).filter((id) => id !== uid) };
  for (const field of Object.values(ROLE_ARRAY)) patch[field] = (group[field] ?? []).filter((id) => id !== uid);
  return patch;
}
