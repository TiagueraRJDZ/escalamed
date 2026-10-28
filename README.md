# EscalaMed

Plataforma web de gestão de escalas e plantões para equipes de saúde (hospitais, clínicas e cooperativas): grupos, turnos, trocas de plantão, check-in/out, relatórios, perfil profissional e anúncios.

## Tecnologia

- **HTML, CSS e JavaScript puros**, sem etapa de build. Cada tela é um arquivo `.html` e o JavaScript usa módulos ES.
- **Firebase, plano gratuito (Spark)**:
  - **Authentication**: e-mail e senha.
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
│  ├─ group.html        tela do grupo: calendário e membros (cargos e convites)
│  ├─ invite.html       aceitar ou recusar um convite
│  ├─ new-password.html troca obrigatória da senha provisória
│  ├─ settings.html     configurações da conta (dados, profissão, foto, senha, exclusão)
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
│  │  ├─ ui.js          avisos, erros de formulário, menus e confirmação
│  │  └─ pages/         código de cada tela
│  ├─ fonts/            fonte Pitanga (woff2)
│  ├─ data/             listas fixas: categorias, cores e UFs (não gastam leituras do banco)
│  └─ img/              logo e imagens
├─ worker/              serviço de contas (Cloudflare Worker + D1): login por usuário, senha provisória, troca de e-mail
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
- **Serviço de contas** (`escalamed-auth`, pasta `worker/`, Cloudflare Worker gratuito, no mesmo padrão do `sacflow-senha`) faz só o que o navegador não consegue sozinho:
  - **Login por nome de usuário:** o banco D1 (`escalamed-contas`) guarda só "usuário → uid". O Worker acha a conta, confere a senha no próprio Firebase e devolve um token personalizado para o app entrar. O e-mail não é exposto. Limite de 10 tentativas por minuto por IP.
  - **Senha provisória:** o gestor (ou auxiliar, mas não para o gestor nem para outro auxiliar) gera na aba Membros. A senha antiga para de valer, as sessões abertas caem e a conta fica marcada (`trocarSenha`): ao entrar, o app pede uma senha nova (`new-password.html`).
  - **Troca de e-mail sem link:** o app confere a senha e o Worker troca na hora.
  - Tudo fica registrado na tabela `eventos` (inclusive quem gerou cada senha provisória).
- **Esqueci a senha:** a tela orienta a pedir uma senha provisória ao gestor do grupo.

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
4. Apague o arquivo da chave do computador. Se ela vazar, exclua a chave no Google Cloud e gere outra.

Os endereços do app que podem chamar o serviço ficam em `ORIGENS`, no `worker/wrangler.toml`. Para ver os erros do serviço: `npx wrangler tail`, na pasta `worker/`.

## Testes

```bash
node --test "tests/*.test.mjs"
```

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
- Firestore em `southamerica-east1` (São Paulo). Login por **E-mail/senha**.
- Configuração do app web em [public/js/config.js](public/js/config.js). O app usa o projeto real em qualquer endereço; os emuladores (projeto `demo-escalamed`) só com `USE_LOCAL_EMULATORS = true`.
- Login e senhas: Firebase (e-mail e senha) com o serviço de contas na Cloudflare (seção "Login e senhas" acima).
- Em `.firebaserc`, o projeto padrão é o dos emuladores (`demo-escalamed`) e o real tem o apelido `prod`. Assim, um `firebase deploy` sem `--project prod` nunca publica no projeto real por engano.

### Ajustes no console do Firebase

- **Authentication > Método de login**: E-mail/senha ativado.
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

## Commits

Cada commit começa com a versão seguida de um resumo curto:

```
1.0 - Estrutura inicial do projeto
1.0.1 - Regras de segurança e dados iniciais
```

A versão sobe no último número a cada commit (`1.0.1`, `1.0.2`…).
