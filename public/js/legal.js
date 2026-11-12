// Termos de Uso e Aviso de Privacidade do EscalaMed: o texto fica só aqui.
// Usado na janela que abre no cadastro (setupLegalLinks) e na página /termos.html.
// Mudou o texto de um jeito que pede novo aceite? Atualize TERMS_VERSION (fica gravado
// no perfil de quem aceita, em termsVersion) e LEGAL_UPDATED.
import { icon } from './icons.js';

export const TERMS_VERSION = '2026-11-10';
export const LEGAL_UPDATED = '10 de novembro de 2026';

const TERMS = `
<p>Estes Termos de Uso explicam as regras para usar o EscalaMed, a plataforma de escalas de plantão
para profissionais de saúde. Ao criar a sua conta e marcar a caixa de aceite, você declara que leu
e concorda com estes Termos e com o Aviso de Privacidade.</p>

<h3>1. O que é o EscalaMed</h3>
<p>O EscalaMed ajuda equipes de saúde a montar, publicar e consultar escalas de plantão. Pela plataforma
é possível criar grupos (equipes ou escalas individuais), convidar pessoas, definir turnos, alocar
profissionais, abrir vagas, publicar a escala do mês e acompanhar o histórico de movimentações.</p>

<h3>2. Sua conta</h3>
<ul>
  <li>Você precisa informar dados verdadeiros e mantê-los atualizados, inclusive cargo e registro no conselho de classe, quando houver.</li>
  <li>A conta é pessoal e intransferível. Guarde a sua senha e não a compartilhe; você responde pelo que for feito com o seu acesso.</li>
  <li>Se perceber uso indevido da sua conta, troque a senha em Configurações e avise o administrador da plataforma.</li>
  <li>Para excluir a sua conta, peça ao administrador da plataforma. Antes, é preciso transferir a gestão dos grupos que você administra e não ter plantões a cumprir.</li>
</ul>

<h3>3. Grupos, cargos e escalas</h3>
<ul>
  <li>O seu cargo define o que você pode ver e alterar. O <strong>Gestor</strong> vê e altera as escalas de todos os grupos; o <strong>Coordenador de escala</strong> altera as escalas e os membros dos grupos que o Gestor liberar; o <strong>Administrativo</strong> vê as escalas publicadas de todos os grupos, sem alterar; o <strong>Médico</strong> vê as escalas dos grupos em que está.</li>
  <li>Gestor, Coordenador de escala e Administrativo só passam a valer depois de aprovados por um Gestor ou pelo administrador da plataforma. Até lá, a conta fica sem acesso à plataforma (o mesmo vale para um pedido recusado). Escolher um cargo que não é o seu é uso indevido da plataforma.</li>
  <li>Quem monta ou altera uma escala é responsável pelas informações que registra. As alterações ficam no histórico do grupo, com o nome de quem as fez.</li>
  <li>A escala publicada no EscalaMed é uma ferramenta de organização. Ela não substitui as normas da instituição em que você trabalha, os contratos de trabalho ou de prestação de serviço, nem as regras do seu conselho profissional.</li>
  <li>Confirme com a coordenação da sua equipe qualquer dúvida sobre plantões, trocas, cessões e vagas.</li>
</ul>

<h3>4. Uso permitido</h3>
<p>Você concorda em não:</p>
<ul>
  <li>usar a plataforma para fins ilícitos ou contrários a estes Termos;</li>
  <li>registrar informações falsas ou se passar por outra pessoa;</li>
  <li>incluir em escalas, perfis ou campos de texto dados de pacientes ou informações clínicas;</li>
  <li>tentar acessar contas, grupos ou dados de outras pessoas sem permissão, ou contornar as regras de segurança;</li>
  <li>copiar, coletar em massa ou repassar dados de outros usuários fora da finalidade de organizar escalas.</li>
</ul>

<h3>5. Disponibilidade</h3>
<p>Trabalhamos para manter o EscalaMed disponível e seguro, mas podem ocorrer interrupções para manutenção,
falhas de conexão ou de serviços de terceiros. Recomendamos conferir a escala com antecedência e manter
a comunicação com a sua equipe pelos canais oficiais da instituição.</p>

<h3>6. Suspensão e encerramento</h3>
<p>O administrador da plataforma pode inativar ou excluir contas que descumpram estes Termos, que apresentem
risco à segurança ou a pedido da instituição responsável pelo grupo. O gestor de um grupo pode remover
membros do grupo.</p>

<h3>7. Propriedade intelectual</h3>
<p>A marca, o código, o visual e os demais elementos do EscalaMed pertencem aos seus titulares. O uso da
plataforma não transfere a você nenhum direito sobre eles. As informações que você registra continuam
sendo suas e da sua equipe.</p>

<h3>8. Privacidade</h3>
<p>O tratamento dos seus dados pessoais segue o Aviso de Privacidade do EscalaMed e a Lei Geral de Proteção
de Dados (Lei nº 13.709/2018).</p>

<h3>9. Mudanças nestes Termos</h3>
<p>Estes Termos podem ser atualizados. Quando a mudança for relevante, avisaremos no aplicativo e poderemos
pedir um novo aceite. A data da última atualização aparece no início do documento.</p>

<h3>10. Lei aplicável</h3>
<p>Estes Termos seguem as leis da República Federativa do Brasil.</p>
`;

const PRIVACY = `
<p>Este Aviso explica quais dados pessoais o EscalaMed trata, para quê, com quem são compartilhados e
como você exerce os seus direitos, conforme a Lei Geral de Proteção de Dados (LGPD, Lei nº 13.709/2018).</p>

<h3>1. Dados que coletamos</h3>
<ul>
  <li><strong>Cadastro e acesso:</strong> nome completo, e-mail, senha (guardada de forma criptografada pelo serviço de login, nunca em texto aberto), nome de usuário (opcional) e, se você entrar pelo Google, a foto da sua conta Google.</li>
  <li><strong>Contato e identificação:</strong> telefone, estado e CPF (opcional).</li>
  <li><strong>Dados profissionais:</strong> cargo, especialidade, número e UF do registro no conselho de classe e, se você preencher, apelido, mini bio, currículo Lattes, certificações, formações e experiências.</li>
  <li><strong>Escalas e grupos:</strong> grupos de que você participa e o seu cargo neles, convites enviados e recebidos, plantões em que está escalado, vagas, trocas, cessões e o histórico dessas movimentações.</li>
  <li><strong>Dados técnicos e de segurança:</strong> data do último acesso, data em que aceitou estes documentos e o endereço IP de pedidos ao serviço de contas (usado para limitar tentativas de senha e registrar ações sensíveis, como troca de e-mail e senha provisória).</li>
</ul>
<p>Não coletamos dados de pacientes nem informações de saúde. Não inclua esse tipo de informação na plataforma.</p>

<h3>2. Para que usamos</h3>
<ul>
  <li>criar e manter a sua conta e permitir o login com segurança;</li>
  <li>montar, publicar e exibir as escalas dos grupos de que você participa;</li>
  <li>identificar você para a sua equipe (nome, foto, cargo e registro profissional);</li>
  <li>enviar convites e avisos dentro do aplicativo;</li>
  <li>gerar relatórios de plantões e horas para os gestores do grupo;</li>
  <li>prevenir fraudes e acessos indevidos e manter registros de segurança.</li>
</ul>
<p>As bases legais são a execução do serviço que você solicitou ao se cadastrar, o legítimo interesse na
segurança da plataforma e, quando aplicável, o cumprimento de obrigações legais.</p>

<h3>3. Quem vê os seus dados</h3>
<ul>
  <li><strong>Outros usuários logados</strong> podem ver o seu perfil profissional: nome, foto, cargo, especialidade, registro no conselho e as informações de "sobre" que você preencher.</li>
  <li><strong>Membros dos seus grupos</strong> veem os seus plantões e as movimentações nas escalas daquele grupo, de acordo com o cargo de cada um.</li>
  <li><strong>Gestores e Administrativos aprovados</strong> veem as escalas publicadas, o histórico e os relatórios de todos os grupos de equipe; os Gestores e os Coordenadores de escala do grupo veem também as escalas em rascunho.</li>
  <li><strong>Gestores aprovados</strong> veem a lista de pessoas da plataforma com o cargo de cada uma, para aprovar ou recusar cargos.</li>
  <li><strong>Telefone e CPF</strong> ficam numa área privada da sua conta: só você tem acesso pelo aplicativo.</li>
  <li><strong>O administrador da plataforma</strong> vê a lista de contas (e-mail, situação e último acesso) para dar suporte, gerar senha provisória e inativar ou excluir acessos.</li>
</ul>

<h3>4. Serviços que usamos</h3>
<p>Para funcionar, o EscalaMed usa fornecedores que tratam dados em nosso nome, com medidas de segurança próprias:</p>
<ul>
  <li><strong>Google Firebase</strong> (Authentication, Cloud Firestore e Hosting): login, banco de dados e hospedagem do aplicativo;</li>
  <li><strong>Cloudflare</strong> (Workers e D1): login por nome de usuário, senhas provisórias, troca de e-mail e limite de tentativas.</li>
</ul>
<p>Esses serviços podem armazenar dados em servidores fora do Brasil, com as garantias previstas na LGPD para
transferência internacional. Não vendemos nem alugamos os seus dados.</p>

<h3>5. Armazenamento no seu aparelho</h3>
<p>O aplicativo guarda no navegador a sua sessão de login, preferências (como o menu recolhido e o último
grupo aberto) e uma cópia dos dados já carregados, para abrir mais rápido. Ao sair da conta, a cópia dos
dados é apagada. Não usamos cookies de publicidade nem ferramentas de rastreamento de terceiros.</p>

<h3>6. Por quanto tempo guardamos</h3>
<p>Mantemos os seus dados enquanto a sua conta existir. Quando a conta é excluída (a pedido seu, ao
administrador da plataforma), apagamos o seu perfil, os dados privados, o nome de usuário e o login. Movimentações já registradas
no histórico de um grupo podem continuar lá, sem o seu nome (aparece como "Ex-membro"), para manter a
escala da equipe consistente. Registros de segurança podem ser mantidos pelo tempo necessário para
cumprir obrigações legais.</p>

<h3>7. Segurança</h3>
<p>Usamos conexão criptografada (HTTPS), regras de acesso por cargo em cada grupo, limite de tentativas de
login e senhas guardadas de forma criptografada. Nenhum sistema é totalmente imune a falhas; se houver um
incidente que possa trazer risco a você, avisaremos conforme a lei.</p>

<h3>8. Seus direitos</h3>
<p>Pela LGPD, você pode pedir confirmação e acesso aos seus dados, correção de dados incompletos ou
desatualizados, anonimização, bloqueio ou eliminação de dados desnecessários, portabilidade, informação
sobre compartilhamentos e revisão do consentimento, quando ele for a base do tratamento.</p>
<ul>
  <li>Você mesmo pode ver e corrigir os seus dados em Configurações. Para excluir a sua conta, fale com o administrador da plataforma.</li>
  <li>Para os demais pedidos, fale com o administrador da plataforma ou com o encarregado de proteção de dados da instituição responsável pelo seu grupo.</li>
  <li>Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).</li>
</ul>

<h3>9. Mudanças neste Aviso</h3>
<p>Este Aviso pode ser atualizado. Quando a mudança for relevante, avisaremos no aplicativo. A data da
última atualização aparece no início do documento.</p>
`;

export const LEGAL_DOCS = {
  termos: { title: 'Termos de Uso', html: TERMS },
  privacidade: { title: 'Aviso de Privacidade', html: PRIVACY },
};

export const legalMeta = () => `<p class="legal-meta">Última atualização: ${LEGAL_UPDATED} · versão ${TERMS_VERSION}</p>`;

// Janela com o documento (criada na primeira vez). Abre por cima do formulário,
// sem sair da página: o que a pessoa já digitou continua lá.
let dialog = null;

function legalDialog() {
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.className = 'modal legal-modal';
  dialog.setAttribute('aria-labelledby', 'legal-title');
  dialog.innerHTML = `
    <div class="dialog-header">
      <h2 id="legal-title"></h2>
      <button type="button" class="btn-icon" data-close aria-label="Fechar">${icon('x')}</button>
    </div>
    <nav class="legal-switch" aria-label="Documentos">
      ${Object.entries(LEGAL_DOCS)
        .map(([id, doc]) => `<button type="button" class="legal-tab" data-doc="${id}">${doc.title}</button>`)
        .join('')}
    </nav>
    <div class="dialog-body legal-body" tabindex="0"></div>
    <div class="dialog-footer">
      <a class="btn btn-ghost legal-page-link" target="_blank" rel="noopener">Abrir em nova aba</a>
      <button type="button" class="btn btn-primary" data-close>Entendi</button>
    </div>`;
  document.body.append(dialog);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog || event.target.closest('[data-close]')) dialog.close();
    const tab = event.target.closest('[data-doc]');
    if (tab) showDoc(tab.dataset.doc);
  });
  return dialog;
}

function showDoc(id) {
  const doc = LEGAL_DOCS[id];
  dialog.querySelector('#legal-title').textContent = doc.title;
  dialog.querySelectorAll('[data-doc]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.doc === id)));
  const body = dialog.querySelector('.legal-body');
  body.innerHTML = `<article class="legal-doc">${legalMeta()}${doc.html}</article>`;
  body.scrollTop = 0;
  dialog.querySelector('.legal-page-link').href = `/termos.html#${id}`;
}

export function openLegal(id = 'termos') {
  legalDialog();
  showDoc(LEGAL_DOCS[id] ? id : 'termos');
  if (!dialog.open) dialog.showModal();
}

// Links com data-legal="termos" | "privacidade" abrem a janela.
// Ctrl/Cmd + clique ou botão do meio seguem o link (abre /termos.html em outra aba).
export function setupLegalLinks(root = document) {
  root.addEventListener('click', (event) => {
    const link = event.target.closest('[data-legal]');
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault(); // dentro do <label>: não marca nem desmarca a caixa
    openLegal(link.dataset.legal);
  });
}
