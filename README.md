# EscalaMed

Plataforma web de gestão de escalas e plantões para equipes de saúde (hospitais, clínicas e cooperativas): grupos, turnos, trocas de plantão, check-in/out, relatórios, perfil profissional e anúncios.

## Tecnologia

- **HTML, CSS e JavaScript puros**, sem etapa de build. Cada tela é um arquivo `.html` e o JavaScript usa módulos ES.
- **Firebase, plano gratuito (Spark)**:
  - **Authentication**: e-mail e senha, e conta Google.
  - **Firestore**: banco de dados. A segurança fica nas regras (`firestore.rules`).
  - **Hosting**: publicação do site.
- Fonte **Pitanga** (fonte da marca Hapvida), versão variável em `public/fonts/PitangaVariable.woff2`, declarada em `public/css/base.css`.
- O SDK do Firebase é carregado pelo CDN oficial (`gstatic.com`), versão fixa em [public/js/firebase.js](public/js/firebase.js).

## Estrutura

```
escalamed/
├─ public/              tudo o que vai para o site
│  ├─ index.html        acesso: escolher, entrar e recuperar senha
│  ├─ signup.html       cadastro em 4 etapas (e-mail, senha, dados pessoais e profissionais)
│  ├─ schedules.html    Escalas: grupos por cargo, convites, calendário e disponíveis
│  ├─ group-new.html    wizard de criação de grupo ou escala individual
│  ├─ group.html        tela do grupo: calendário (plantões do dia), meses da escala e membros
│  ├─ schedule-edit.html editor da escala mensal: grade, vagas, publicar, replicar, imprimir
│  ├─ invite.html       aceitar ou recusar um convite
│  ├─ relatorios.html   Relatório de Plantões por período (só gestor): resumo, por membro, Excel e PDF
│  ├─ historico.html    Histórico: trocas, cessões, vagas e alterações na escala, por mês
│  ├─ new-password.html troca obrigatória da senha provisória
│  ├─ settings.html     Configurações: conta, profissão, perfil, senha, usuários (admin) e apagar dados (Dev)
│  ├─ *.html            demais telas (algumas ainda provisórias)
│  ├─ css/              base.css (cores e componentes), layout.css e um arquivo por tela
│  ├─ js/
│  │  ├─ config.js      configuração do Firebase e links
│  │  ├─ firebase.js    conexão com o Firebase e troca de página (navigate)
│  │  ├─ layout.js      menu lateral, barra superior, gavetas e modais
│  │  ├─ auth.js        sessão do usuário e guards (login → senha provisória → cadastro completo)
│  │  ├─ auth-api.js    login, cadastro e senhas (Firebase) e chamadas ao serviço de contas (Worker)
│  │  ├─ permissions.js cargos, limites e can() (sem Firebase, com testes)
│  │  ├─ members.js     mudar cargo, remover, convites
│  │  ├─ schedule-math.js escala: horas, conflitos de horário, replicação (sem Firebase, com testes)
│  │  ├─ schedule-data.js escala no Firestore: ler, alocar, vagas, publicar, replicar
│  │  ├─ movements.js   histórico (groups/{g}/movements): gravar no mesmo lote da ação e consultar
│  │  ├─ shift-report.js relatório de plantões: junta e agrupa por membro (sem Firebase, com testes)
│  │  ├─ report-export.js exportar o relatório: Excel (SheetJS do CDN) e PDF (impressão)
│  │  ├─ my-groups.js   meus grupos com o cargo em cada um e membros de um grupo
│  │  ├─ dates.js       datas em português e períodos (sem Firebase, com testes)
│  │  ├─ ui.js          avisos, erros de formulário, menus e confirmação
│  │  ├─ gcal.js        Agenda Google: conectar, lembrete, desconectar e envio dos plantões ao Worker
│  │  ├─ gcal-data.js   Agenda Google: monta os plantões no formato do Worker (sem Firebase, com testes)
│  │  ├─ push.js        notificações push no celular: ativar, desativar e avisar o Worker (os avisos do sininho)
│  │  ├─ settings/      uma seção das Configurações por arquivo; menu.js lista as seções (subitens do menu lateral)
│  │  └─ pages/         código de cada tela
│  ├─ fonts/            fonte Pitanga (woff2)
│  ├─ data/             listas fixas: categorias, cores e UFs (não gastam leituras do banco)
│  └─ img/              logo e imagens
├─ worker/              serviço de contas (Cloudflare Worker + D1): login por usuário, senha provisória, troca de e-mail, Agenda Google e notificações push
├─ scripts/             utilitários de desenvolvimento (dados de teste)
├─ tests/               testes (node --test) e testes das regras (tests/rules)
├─ docs/                especificações
├─ firestore.rules      regras de segurança do banco
├─ firebase.json        configuração do Hosting e dos emuladores
├─ .firebaserc          projeto Firebase em uso
└─ README.md
```

## Rodar localmente

O app usa o **banco real** (projeto `escalamed-hapvida`) em qualquer endereço, inclusive no localhost e no Go Live. Basta servir a pasta `public`: pelo Go Live (abaixo) ou com `firebase serve --only hosting` (http://localhost:5000).

> Tudo o que você fizer localmente grava no banco real. Para testar sem mexer nele, use os emuladores (abaixo).

### Emuladores (opcional, para testar sem mexer no banco real)

Requisitos: [Node.js](https://nodejs.org), Java 11 ou superior (para o emulador do Firestore) e o Firebase CLI:

```bash
npm install -g firebase-tools
```

Em [public/js/config.js](public/js/config.js), troque `USE_LOCAL_EMULATORS` para `true`. Depois, na pasta do projeto:

```bash
firebase emulators:start
```

- Site: http://localhost:5000
- Painel dos emuladores (usuários e dados de teste): http://localhost:4000

Com os emuladores ligados, nada é gravado no projeto real. Volte `USE_LOCAL_EMULATORS` para `false` antes de publicar.

Para preencher os emuladores com dados de teste, rode em outro terminal:

```bash
node scripts/seed-emulator.mjs
```

Ele cria as unidades de saúde, o grupo **TELEAUDITORIA HAPVIDA** (6 turnos) e 14 usuários fictícios, todos com a senha `Teste@123`:

| Usuário | Cargo no grupo |
|---|---|
| gestor@teste.com | Gestor |
| auxiliar1@teste.com, auxiliar2@teste.com | Auxiliar |
| analista@teste.com | Analista |
| observador@teste.com | Observador |
| plantonista@teste.com, plantonista2@ … plantonista8@teste.com | Plantonista |
| novo@teste.com | fora do grupo, com convite pendente |

Os emuladores apagam tudo ao fechar. Para manter os dados entre execuções:

```bash
firebase emulators:start --import=./emulator-data --export-on-exit
```

> Abrir o `index.html` direto pelo explorador de arquivos não funciona: os módulos JavaScript precisam de um servidor.

### Pelo Go Live (extensão Live Server do VS Code)

1. Abra a **pasta do projeto** no VS Code (Arquivo > Abrir Pasta > `escalamed`). Sem a pasta aberta, o Go Live mostra "Open a folder or workspace".
2. Clique em **Go Live**, na barra inferior. O app abre em http://127.0.0.1:5500, ligado ao banco real.

O Live Server já está configurado para servir a pasta `public` (arquivo `.vscode/settings.json`). Se `USE_LOCAL_EMULATORS` estiver `true` e os emuladores desligados, o app mostra uma faixa amarela avisando.

## Login e senhas

- **Firebase Authentication (e-mail e senha)** cuida do cadastro, do login por e-mail e das senhas. Sem e-mail de confirmação: a conta é liberada ao terminar o cadastro.
- **Continuar com Google** (tela de acesso e etapa 1 do cadastro): abre a janela do Google. No primeiro acesso a conta já nasce no Firebase e o cadastro começa nos dados pessoais (etapa 3), com o aceite dos termos ali e a foto do Google no perfil. Conta só com Google não tem senha: nas Configurações, a aba vira **Criar senha** (para entrar também por e-mail ou usuário), a exclusão da conta é confirmada pelo Google e a troca de e-mail só aparece depois de criar a senha.
- **Serviço de contas** (`escalamed-auth`, pasta `worker/`, Cloudflare Worker gratuito, no mesmo padrão do `sacflow-senha`) faz só o que o navegador não consegue sozinho:
  - **Login por nome de usuário:** o banco D1 (`escalamed-contas`) guarda só "usuário → uid". O Worker acha a conta, confere a senha no próprio Firebase e devolve um token personalizado para o app entrar. O e-mail não é exposto. Limite de 10 tentativas por minuto por IP.
  - **Senha provisória:** só o administrador da plataforma gera, em **Configurações › Usuários** (gestor e auxiliar de grupo não geram). A senha antiga para de valer, as sessões abertas caem e a conta fica marcada (`trocarSenha`): ao entrar, o app pede uma senha nova (`new-password.html`).
  - **Troca de e-mail sem link:** o app confere a senha e o Worker troca na hora.
  - **Administração da plataforma** (**Configurações › Usuários**, só para administradores): lista todas as contas (nome, usuário, e-mail, profissão, situação) e, em cada linha, **redefinir senha** (senha provisória), **inativar/reativar acesso** (a pessoa não entra mais e as sessões caem; os dados ficam) e **excluir acesso** (apaga login e perfil e libera o nome de usuário; nos grupos o nome continua até o gestor remover).
  - Tudo fica registrado na tabela `eventos` (inclusive quem gerou cada senha provisória, quem inativou e quem excluiu).
- **Esqueci a senha:** a tela orienta a pedir uma senha provisória ao administrador do EscalaMed.

### Publicar o Worker (uma vez)

1. **Conta de serviço:** em [Google Cloud › IAM › Contas de serviço](https://console.cloud.google.com/iam-admin/serviceaccounts?project=escalamed-hapvida), crie a conta `escalamed-auth` só com o papel **Administrador do Firebase Authentication**. Em **Chaves**, adicione uma chave **JSON** e salve o arquivo **fora** da pasta do projeto.
2. **Cloudflare** (conta `tiago.tlmsmartins@gmail.com`), na pasta `worker/`:
   ```powershell
   npx wrangler login
   npx wrangler d1 create escalamed-contas
   ```
   Cole o `database_id` mostrado em `worker/wrangler.toml` e continue:
   ```powershell
   npx wrangler d1 migrations apply escalamed-contas --remote
   npx wrangler deploy
   Get-Content C:\caminho\da\chave.json -Raw | npx wrangler secret put CONTA_SERVICO
   ```
   O endereço fica `https://escalamed-auth.tiago-tlmsmartins.workers.dev` (já configurado em `authApiUrl`, em [public/js/config.js](public/js/config.js)). Até o Worker estar no ar, o login por e-mail e o cadastro funcionam; só o login por usuário, a senha provisória e a troca de e-mail dependem dele.
3. **Firebase › Authentication › Método de login:** **E-mail/senha ativado** (o login por usuário usa o token personalizado, que não precisa de método ativado).
4. **Administradores da plataforma:** no [Firestore](https://console.firebase.google.com/project/escalamed-hapvida/firestore), crie a coleção `config` com o documento `admins` e o campo `uids` (tipo **array**), com o UID de cada administrador (em Authentication › Usuários, coluna "UID do usuário"). O Worker e as regras do Firestore leem esse documento; para incluir ou tirar alguém, basta editá-lo, sem publicar nada.
5. Apague o arquivo da chave do computador. Se ela vazar, exclua a chave no Google Cloud e gere outra.

Os endereços do app que podem chamar o serviço ficam em `ORIGENS`, no `worker/wrangler.toml`. Para ver os erros do serviço: `npx wrangler tail`, na pasta `worker/`.

## Agenda Google

O ícone de calendário na barra do topo conecta a conta Google da pessoa. O EscalaMed cria nela uma agenda própria, **EscalaMed**, com os plantões **publicados** da pessoa e um lembrete antes de cada um (a pessoa escolhe: sem lembrete, 30 min, 1 h, 2 h, 6 h, 12 h ou 1 dia). A permissão pedida (`calendar.app.created`) só deixa mexer nas agendas criadas pelo próprio EscalaMed: as outras agendas da pessoa ficam fora de alcance.

- **Quem guarda o acesso:** o serviço de contas (`worker/src/agenda.js`). O app manda ao Worker só o código de autorização do Google; o token de renovação fica no D1, criptografado com uma chave derivada de `GOOGLE_SEGREDO`.
- **Quando a agenda é atualizada:**
  - ao abrir o app (no máximo a cada 30 minutos) e em **Atualizar agora**: os plantões publicados da pessoa no mês anterior, no atual e nos dois seguintes;
  - quando o gestor ou o auxiliar aloca, publica, volta para rascunho ou replica uma escala: a agenda de todos os escalados daquele mês (o Worker confere no Firestore se quem pediu administra o grupo). Escala em rascunho sai da agenda.
- **Envio:** em lotes de até 50 eventos por chamada ao Google. O que não couber numa chamada fica pendente e o Cron do Worker (a cada 5 minutos) termina.
- **Desconectar** apaga a agenda EscalaMed do Google e revoga o acesso. Se a pessoa tirar o acesso pela conta Google, o EscalaMed percebe no próximo envio e mostra o botão Conectar de novo.

### Configurar (uma vez)

1. **Google Cloud** (projeto `escalamed-hapvida`), em [APIs e serviços › Biblioteca](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com?project=escalamed-hapvida): ative a **Google Calendar API**.
2. **Google Auth Platform › Acesso a dados:** adicione o escopo `https://www.googleapis.com/auth/calendar.app.created`. Em **Público**, deixe o app **Em produção**: no modo "Teste" só os usuários de teste conseguem conectar, e a autorização vence em 7 dias. Se o Google pedir verificação para o escopo, até ela sair as pessoas veem o aviso "O Google não verificou este app" (dá para seguir em "Avançado"), com limite de 100 contas.
3. **Google Auth Platform › Clientes:** use o cliente **Web client (auto created by Google Service)**, criado pelo login com Google do Firebase, ou crie um **ID do cliente OAuth** do tipo **Aplicativo da Web**. Em **Origens JavaScript autorizadas**, inclua `https://escalamed-hapvida.web.app`, `https://escalamed-hapvida.firebaseapp.com` e, para testar localmente, `http://localhost:5000` e `http://127.0.0.1:5500`. Não precisa de URI de redirecionamento.
4. Cole o **ID do cliente** (termina em `.apps.googleusercontent.com`) em `googleClientId`, em [public/js/config.js](public/js/config.js), e em `GOOGLE_CLIENTE`, em [worker/wrangler.toml](worker/wrangler.toml).
5. Na pasta `worker/`:
   ```powershell
   npx wrangler d1 migrations apply escalamed-contas --remote
   npx wrangler secret put GOOGLE_SEGREDO      # cole a "Chave secreta do cliente"
   npx wrangler deploy
   ```
6. Publique o site (`firebase deploy --project prod --only hosting`).

Sem o `googleClientId`, o botão Conectar avisa que a integração ainda não foi configurada. Trocar o `GOOGLE_SEGREDO` desconecta todo mundo (os tokens guardados deixam de abrir).

## Notificações push no celular

Os avisos do sininho também chegam no aparelho, mesmo com o EscalaMed fechado: **convite para um grupo** (para quem foi convidado) e **convite recusado** (para quem convidou). É Web Push padrão, sem Firebase Cloud Messaging: o serviço de contas (`worker/src/push.js`) cifra a mensagem (RFC 8291) e se identifica com uma chave VAPID (RFC 8292), sem bibliotecas.

- **Onde ativar:** no topo da gaveta do sininho (`notifications.js`), por aparelho e por conta. Ali também ficam Testar (os aparelhos da própria conta) e Desativar. O Dev tem ainda **Testar em todos os aparelhos**: manda "Teste de notificações" para todas as contas com push ativo, celular e computador (`/push/teste-geral`, em lotes de 40 por causa do limite de requisições do plano gratuito do Cloudflare). Quem sai da conta deixa de receber naquele aparelho (e volta a receber sozinho se entrar de novo).
- **iPhone/iPad:** só no EscalaMed adicionado à Tela de Início (iOS 16.4 ou mais novo); no Safari comum, a gaveta mostra o passo a passo. O app da Tela de Início tem login próprio (entra uma vez nele). Android, computador (Chrome, Edge, Firefox) e Safari do Mac funcionam direto no navegador.
- **Como sai um aviso:** o app grava no Firestore e chama `/push/avisar` (`notifyPush`, em `public/js/push.js`). O Worker lê o documento no Firestore **com o token de quem pediu** (valem as regras), confere que é recente e que combina com quem pediu, e manda uma vez só (tabela `push_avisos`). Ninguém consegue disparar notificação falsa para outra pessoa.
- **No aparelho:** `public/sw.js` (service worker só de notificações, sem cache de páginas) mostra a notificação; tocar nela abre a tela certa (o convite ou a aba Membros do grupo). O número do sininho também aparece no ícone do app, onde o sistema suporta.
- **App instalável:** `public/manifest.webmanifest` e os ícones `img/icon-512.png`, `img/icon-maskable-512.png` (Android) e `img/badge-96.png` (barra de status do Android).
- **Novo tipo de aviso:** acrescente uma entrada em `AVISOS` (`worker/src/push.js`), que confere o documento e monta a mensagem, e chame `notifyPush(tipo, grupo, chave)` logo depois de gravar.

### Configurar (uma vez)

A chave pública VAPID fica em `VAPID_PUBLICA` (`worker/wrangler.toml`) e em `vapidPublicKey` (`public/js/config.js`); as duas precisam ser iguais. A privada é segredo do Worker. Na pasta `worker/`:

```powershell
npx wrangler d1 migrations apply escalamed-contas --remote   # tabelas push_inscricoes e push_avisos
npx wrangler secret put VAPID_PRIVADA                         # o "d" da chave privada (base64url)
npx wrangler deploy
```

Para gerar um par novo: `node -e "const k=require('crypto').generateKeyPairSync('ec',{namedCurve:'P-256'}).privateKey.export({format:'jwk'});console.log('publica', Buffer.concat([Buffer.from([4]),Buffer.from(k.x,'base64url'),Buffer.from(k.y,'base64url')]).toString('base64url'));console.log('privada', k.d)"`. Trocar a chave desliga as inscrições antigas: cada pessoa precisa ativar de novo no sininho.

Testar localmente (emuladores + Worker local): crie `worker/.dev.vars` com `EMULADOR=1`, `PROJETO=demo-escalamed` e `VAPID_PRIVADA=...`, rode `npx wrangler d1 migrations apply escalamed-contas --local` e `npx wrangler dev --local --port 8787`.

## Testes

```bash
node --test "tests/*.test.mjs"
```

Inclui o teste da Agenda Google no Worker (`tests/agenda-worker.test.mjs`), com o SQLite do Node no lugar do D1 e o Google simulado; não precisa de emulador. E o das notificações push (`tests/push-worker.test.mjs`): um aparelho de mentira, com chaves de verdade, abre a mensagem cifrada e confere a assinatura VAPID; também cobre os avisos falsos recusados.

Teste completo do serviço de contas (roda o código do Worker no Node, com o SQLite do Node no lugar do D1, o emulador de Authentication e a leitura do grupo simulada):

```bash
firebase emulators:exec --only auth --config firebase.test.json --project demo-escalamed-test "node --no-warnings --test tests/worker/auth-service.test.mjs"
```

Testes das regras do Firestore (cargos, convites, perfis). Usam emuladores próprios, nas portas 8180 e 9199 (`firebase.test.json`), então podem rodar com os emuladores de desenvolvimento ligados:

```bash
firebase emulators:exec --config firebase.test.json --project demo-escalamed-test "node --test tests/rules/rules.test.mjs"
firebase emulators:exec --config firebase.test.json --project demo-escalamed-test "node --test tests/rules/seed-check.mjs"
```

> No Windows, o emulador do Firestore às vezes continua aberto depois do `emulators:exec` (processo `java`). Se a próxima execução disser "port taken", feche-o pelo Gerenciador de Tarefas.

## Projeto Firebase real

- Projeto: **escalamed-hapvida** (nome "EscalaMed"), na conta tiago.tlmsmartins@gmail.com, plano gratuito.
- Firestore em `southamerica-east1` (São Paulo). Login por **E-mail/senha** e **Google**.
- Configuração do app web em [public/js/config.js](public/js/config.js). O app usa o projeto real em qualquer endereço; os emuladores (projeto `demo-escalamed`) só com `USE_LOCAL_EMULATORS = true`.
- Login e senhas: Firebase (e-mail e senha) com o serviço de contas na Cloudflare (seção "Login e senhas" acima).
- Em `.firebaserc`, o projeto padrão é o dos emuladores (`demo-escalamed`) e o real tem o apelido `prod`. Assim, um `firebase deploy` sem `--project prod` nunca publica no projeto real por engano.

### Ajustes no console do Firebase

- **Authentication > Método de login**: E-mail/senha e **Google** ativados (no Google, escolha o e-mail de suporte do projeto).
- **Firestore > config/admins**: campo `uids` (array) com os administradores da plataforma (veja "Publicar o Worker", passo 4).
- **Dev** (acima de todos os cargos, acesso total): não fica no console. Os e-mails estão em `isDev()` no `firestore.rules`; para incluir alguém, adicione o e-mail e publique as regras (`firebase deploy --only firestore:rules --project prod`).
- **Foto de perfil**: fica no próprio Firestore (160 px, cerca de 10 KB), porque o Cloud Storage só funciona no plano pago em projetos novos.

### App Check (proteção contra robôs)

Faz o papel do captcha: o reCAPTCHA v3 é invisível e não trava o botão Entrar.

1. No console do Google Cloud, em **Security > reCAPTCHA**, crie uma chave do tipo **site (v3)** com os domínios do Hosting.
2. No console do Firebase, em **App Check > Apps**, registre o app web com o provedor **reCAPTCHA v3**, usando a chave secreta.
3. Cole a chave do site em `appCheckSiteKey`, em [public/js/config.js](public/js/config.js).
4. Acompanhe as métricas em **App Check** por alguns dias e só então ative a **aplicação obrigatória** (enforcement) para Firestore e Authentication.

Nos emuladores o App Check fica desligado.

## Publicar

```bash
firebase deploy --project prod                         # site + regras + índices
firebase deploy --project prod --only firestore        # só regras e índices
```

### Versões dos arquivos (cache)

Os arquivos de `js/`, `css/` e `data/` ficam no navegador por 1 ano (`immutable`, em `firebase.json`); o `sw.js` e o manifesto, na raiz, não (o celular precisa pegar a versão nova do service worker). Para a versão
nova chegar a todos, cada HTML aponta para os arquivos com `?v=<hash do conteúdo>`: o import map
(módulos), os `modulepreload`, o script de entrada e os `<link rel="stylesheet">`. Quem escreve
isso é `node scripts/write-preloads.mjs`, que roda sozinho antes de publicar.

**Mexeu em algum `.js` ou `.css`? Rode `node scripts/write-preloads.mjs`** (o teste
`tests/preloads.test.mjs` acusa quando esqueceram). Sem isso, nos emuladores o navegador continua
com o arquivo antigo; se acontecer, use Ctrl+F5.

## Commits

Cada commit começa com a versão seguida de um resumo curto:

```
1.0 - Estrutura inicial do projeto
1.0.1 - Regras de segurança e dados iniciais
```

A versão sobe no último número a cada commit (`1.0.1`, `1.0.2`…).

### Versão no rodapé

O rodapé do login e do app mostra "Desenvolvido por Tiago Martins · v1.0.X". A versão vem de `public/version.json`, gerado por [scripts/write-version.mjs](scripts/write-version.mjs) a partir da mensagem do último commit. Ele roda sozinho:

- depois de cada commit, checkout, pull e rebase (hooks em `.githooks/`);
- antes de publicar no Firebase (`predeploy` em `firebase.json`).

O `version.json` não vai para o repositório. Num clone novo, ative os hooks uma vez:

```bash
git config core.hooksPath .githooks
node scripts/write-version.mjs
```

