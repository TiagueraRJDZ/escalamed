// Seções das Configurações, na ordem do menu. Aparecem como subitens de "Configurações"
// no menu lateral (layout.js) e dão o título do painel na página (pages/settings.js).
// Cada hash tem um módulo com o mesmo nome do arquivo em js/settings/ (ex.: #conta → conta.js).
export const SETTINGS_SECTIONS = [
  { hash: 'conta', title: 'Informações da conta', icon: 'user' },
  { hash: 'profissional', title: 'Informações profissionais', icon: 'stethoscope' },
  { hash: 'perfil', title: 'Editar perfil', icon: 'edit' },
  { hash: 'senha', title: 'Alterar senha', icon: 'lock' },
  // Usuários: administrador da plataforma e Gestor aprovado (aprovação de cargos)
  { hash: 'usuarios', title: 'Usuários', icon: 'users', approverOnly: true },
  // Apagar dados: só Dev
  { hash: 'banco', title: 'Apagar dados', icon: 'trash', devOnly: true },
];

export const DEFAULT_SECTION = 'conta';
