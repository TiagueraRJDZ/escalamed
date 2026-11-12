// Cargos da plataforma (o campo continua "categoryId" no banco). O "id" é gravado; o "name" aparece na tela.
// "council": sigla do conselho de classe (mostrada como rótulo do registro). Sem conselho = null.
// "specialty": pede especialidade no cadastro. "councilRequired": registro obrigatório.
// "needsApproval": o cargo só vale depois de aprovado (Configurações > Usuários) pelo administrador
// da plataforma ou por um Gestor; até lá a pessoa fica na tela de espera, sem entrar na plataforma.
// "hint": explicação curta mostrada na escolha.
// Só estes aparecem para escolher (cadastro e Configurações).
// Para incluir um cargo novo, adicione aqui, na lista do optCategory no firestore.rules e no
// mapa de acesso de permissions.js.
export const PROFESSIONAL_CATEGORIES = [
  { id: 'gestor', name: 'Gestor', council: null, needsApproval: true, hint: 'Diretores, gerentes e coordenadores. Vê e altera todas as escalas.' },
  { id: 'coordenador-escala', name: 'Coordenador de escala', council: null, needsApproval: true, hint: 'Altera as escalas dos grupos que o Gestor liberar.' },
  { id: 'administrativo', name: 'Administrativo', council: null, needsApproval: true, hint: 'Vê todas as escalas publicadas, sem alterar.' },
  { id: 'medico', name: 'Médico', council: 'CRM', specialty: true, councilRequired: true, hint: 'Vê as escalas dos grupos em que está.' },
];

// Cargos/profissões que saíram da lista: ninguém escolhe mais, mas quem já tinha uma continua
// com o nome certo na tela até trocar (e o firestore.rules ainda aceita o id gravado)
const RETIRED_CATEGORIES = [
  { id: 'auxiliar-enfermagem', name: 'Auxiliar de Enfermagem', council: 'COREN' },
  { id: 'outro', name: 'Outro', council: null },
  { id: 'academico', name: 'Acadêmico', council: null },
  { id: 'assistente-social', name: 'Assistente Social', council: 'CRESS' },
  { id: 'auxiliar-laboratorio', name: 'Auxiliar de Laboratório', council: null },
  { id: 'auxiliar-saude-bucal', name: 'Auxiliar de Saúde Bucal', council: 'CRO' },
  { id: 'biomedico', name: 'Biomédico', council: 'CRBM' },
  { id: 'bioquimico', name: 'Bioquímico', council: 'CRF' },
  { id: 'bombeiro', name: 'Bombeiro', council: null },
  { id: 'condutor-socorrista', name: 'Condutor Socorrista', council: null },
  { id: 'cuidador', name: 'Cuidador', council: null },
  { id: 'dentista', name: 'Dentista', council: 'CRO' },
  { id: 'educador-fisico', name: 'Educador Físico', council: 'CREF' },
  { id: 'enfermeiro', name: 'Enfermeiro', council: 'COREN' },
  { id: 'farmaceutico', name: 'Farmacêutico', council: 'CRF' },
  { id: 'fisioterapeuta', name: 'Fisioterapeuta', council: 'CREFITO' },
  { id: 'fonoaudiologo', name: 'Fonoaudiólogo', council: 'CRFa' },
  { id: 'instrumentador-cirurgico', name: 'Instrumentador Cirúrgico', council: null },
  { id: 'maqueiro', name: 'Maqueiro', council: null },
  { id: 'medico-residente', name: 'Médico Residente', council: 'CRM', specialty: true, councilRequired: true },
  { id: 'nutricionista', name: 'Nutricionista', council: 'CRN' },
  { id: 'psicologo', name: 'Psicólogo', council: 'CRP' },
  { id: 'recepcionista', name: 'Recepcionista', council: null },
  { id: 'tarm', name: 'TARM', council: null },
  { id: 'tecnico-enfermagem', name: 'Técnico de Enfermagem', council: 'COREN' },
  { id: 'tecnico-laboratorio', name: 'Técnico de Laboratório', council: null },
  { id: 'tecnico-radiologia', name: 'Técnico de Radiologia', council: 'CRTR' },
  { id: 'terapeuta-ocupacional', name: 'Terapeuta Ocupacional', council: 'CREFITO' },
  { id: 'veterinario', name: 'Veterinário', council: 'CRMV' },
];

// Sugestões de especialidade (o campo aceita qualquer texto)
export const SPECIALTIES = [
  'Anestesiologia', 'Cardiologia', 'Cirurgia Geral', 'Clínico Geral', 'Dermatologia',
  'Emergência', 'Endocrinologia', 'Gastroenterologia', 'Geriatria', 'Ginecologia e Obstetrícia',
  'Infectologia', 'Medicina de Família', 'Medicina do Trabalho', 'Medicina Intensiva', 'Nefrologia',
  'Neurologia', 'Oftalmologia', 'Oncologia', 'Ortopedia', 'Otorrinolaringologia', 'Pediatria',
  'Pneumologia', 'Psiquiatria', 'Radiologia', 'Urologia',
];

export function getCategory(id) {
  return PROFESSIONAL_CATEGORIES.find((c) => c.id === id) ?? RETIRED_CATEGORIES.find((c) => c.id === id) ?? null;
}

export function categoryName(id) {
  return getCategory(id)?.name ?? '';
}

// "Médico / Clínico Geral" ou só "Administrativo"
export function professionLabel({ categoryId, specialty } = {}) {
  const name = categoryName(categoryId);
  return [name, specialty].filter(Boolean).join(' / ');
}

// "CRM 28890/CE"
export function councilLabel(council) {
  if (!council?.number) return '';
  return `${council.type} ${council.number}${council.state ? `/${council.state}` : ''}`;
}
