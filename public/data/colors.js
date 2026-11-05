// Paleta de cores dos grupos. Todas têm contraste suficiente com texto branco,
// porque a cor aparece como fundo das iniciais do grupo.
// A primeira é o azul do Guia de Marca Hapvida (Pantone 293 C), cor padrão dos grupos novos.
export const GROUP_COLORS = [
  { hex: '#1539AA', name: 'Azul Hapvida' },
  { hex: '#1E3A8A', name: 'Azul-marinho' },
  { hex: '#0369A1', name: 'Céu' },
  { hex: '#0E7490', name: 'Ciano' },
  { hex: '#0F766E', name: 'Turquesa' },
  { hex: '#15803D', name: 'Verde' },
  { hex: '#4D7C0F', name: 'Oliva' },
  { hex: '#A16207', name: 'Mostarda' },
  { hex: '#C2410C', name: 'Laranja' },
  { hex: '#DC2626', name: 'Vermelho' },
  { hex: '#BE185D', name: 'Rosa' },
  { hex: '#A21CAF', name: 'Magenta' },
  { hex: '#9333EA', name: 'Roxo' },
  { hex: '#6D28D9', name: 'Violeta' },
  { hex: '#4F46E5', name: 'Índigo' },
  { hex: '#92400E', name: 'Marrom' },
  { hex: '#475569', name: 'Grafite' },
];

export const DEFAULT_GROUP_COLOR = GROUP_COLORS[0].hex;

// Cores que saíram da paleta → cor que as substitui.
// Grupos criados antes continuam salvos com a cor antiga; aparecem com a nova.
const RENAMED_COLORS = {
  '#2563EB': '#1539AA', // "Azul" antigo → Azul Hapvida
};

// Cor para mostrar na tela (e para marcar a opção certa ao editar o grupo)
export const groupColor = (hex) => {
  if (!hex) return DEFAULT_GROUP_COLOR;
  return RENAMED_COLORS[hex.toUpperCase()] ?? hex;
};
