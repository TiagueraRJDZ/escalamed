// Categorias profissionais. O "id" é gravado no banco; o "name" aparece na tela.
// Para incluir uma categoria nova, adicione aqui mantendo a ordem alfabética.
export const PROFESSIONAL_CATEGORIES = [
  { id: 'academico', name: 'Acadêmico' },
  { id: 'administrativo', name: 'Administrativo' },
  { id: 'assistente-social', name: 'Assistente Social' },
  { id: 'auxiliar-enfermagem', name: 'Auxiliar de Enfermagem' },
  { id: 'auxiliar-laboratorio', name: 'Auxiliar de Laboratório' },
  { id: 'auxiliar-saude-bucal', name: 'Auxiliar de Saúde Bucal' },
  { id: 'biomedico', name: 'Biomédico' },
  { id: 'bioquimico', name: 'Bioquímico' },
  { id: 'bombeiro', name: 'Bombeiro' },
  { id: 'condutor-socorrista', name: 'Condutor Socorrista' },
  { id: 'cuidador', name: 'Cuidador' },
  { id: 'dentista', name: 'Dentista' },
  { id: 'educador-fisico', name: 'Educador Físico' },
  { id: 'enfermeiro', name: 'Enfermeiro' },
  { id: 'farmaceutico', name: 'Farmacêutico' },
  { id: 'fisioterapeuta', name: 'Fisioterapeuta' },
  { id: 'fonoaudiologo', name: 'Fonoaudiólogo' },
  { id: 'instrumentador-cirurgico', name: 'Instrumentador Cirúrgico' },
  { id: 'maqueiro', name: 'Maqueiro' },
  { id: 'medico', name: 'Médico' },
  { id: 'medico-residente', name: 'Médico Residente' },
  { id: 'nutricionista', name: 'Nutricionista' },
  { id: 'psicologo', name: 'Psicólogo' },
  { id: 'recepcionista', name: 'Recepcionista' },
  { id: 'tecnico-enfermagem', name: 'Técnico de Enfermagem' },
  { id: 'tecnico-laboratorio', name: 'Técnico de Laboratório' },
  { id: 'tecnico-radiologia', name: 'Técnico de Radiologia' },
  { id: 'terapeuta-ocupacional', name: 'Terapeuta Ocupacional' },
  { id: 'outro', name: 'Outro' },
];

export function categoryName(id) {
  return PROFESSIONAL_CATEGORIES.find((c) => c.id === id)?.name ?? '';
}
