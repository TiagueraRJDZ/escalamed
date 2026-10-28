// Categorias profissionais (profissões). O "id" é gravado no banco; o "name" aparece na tela.
// "council": sigla do conselho de classe (mostrada como rótulo do registro). Sem conselho = null.
// "specialty": pede especialidade no cadastro. "councilRequired": registro obrigatório.
// Para incluir uma categoria nova, adicione aqui (ordem alfabética) e também na lista
// CATEGORY_IDS do firestore.rules.
export const PROFESSIONAL_CATEGORIES = [
  { id: 'academico', name: 'Acadêmico', council: null },
  { id: 'administrativo', name: 'Administrativo', council: null },
  { id: 'assistente-social', name: 'Assistente Social', council: 'CRESS' },
  { id: 'auxiliar-enfermagem', name: 'Auxiliar de Enfermagem', council: 'COREN' },
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
  { id: 'medico', name: 'Médico', council: 'CRM', specialty: true, councilRequired: true },
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
  { id: 'outro', name: 'Outro', council: null },
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
  return PROFESSIONAL_CATEGORIES.find((c) => c.id === id) ?? null;
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
