# EscalaMed

Plataforma web de gestão de escalas e plantões para equipes de saúde (hospitais, clínicas e cooperativas): grupos, turnos, trocas de plantão, check-in/out, relatórios, perfil profissional e anúncios.

## Tecnologia

- **HTML, CSS e JavaScript puros**, sem etapa de build. Cada tela é um arquivo `.html` e o JavaScript usa módulos ES.
- **Firebase, plano gratuito (Spark)**:
  - **Authentication**: e-mail/senha e Google.
  - **Firestore**: banco de dados. A segurança fica nas regras (`firestore.rules`).
  - **Hosting**: publicação do site.
- O SDK do Firebase é carregado pelo CDN oficial (`gstatic.com`), versão fixa em [public/js/firebase.js](public/js/firebase.js).

## Estrutura

```
escalamed/
├─ public/              tudo o que vai para o site
│  ├─ index.html        entrar / criar conta
│  ├─ schedules.html    Escalas: lista de grupos, calendário e disponíveis
│  ├─ group-new.html    wizard de criação de grupo ou escala individual
│  ├─ *.html            demais telas (algumas ainda provisórias)
│  ├─ css/              base.css (cores e componentes), layout.css e um arquivo por tela
│  ├─ js/
│  │  ├─ config.js      configuração do Firebase e links
│  │  ├─ firebase.js    conexão com o Firebase e troca de página (navigate)
│  │  ├─ layout.js      menu lateral, barra superior, gavetas e modais
│  │  ├─ auth.js        sessão do usuário e proteção das páginas
│  │  ├─ ui.js          avisos, erros de formulário, menus e confirmação
│  │  └─ pages/         código de cada tela
│  ├─ data/             listas fixas: categorias, cores e UFs (não gastam leituras do banco)
│  └─ img/              logo e imagens
├─ scripts/             utilitários de desenvolvimento (dados de teste)
├─ firestore.rules      regras de segurança do banco
├─ firebase.json        configuração do Hosting e dos emuladores
├─ .firebaserc          projeto Firebase em uso
└─ README.md
```

## Rodar localmente

Requisitos: [Node.js](https://nodejs.org), Java 11 ou superior (para o emulador do Firestore) e o Firebase CLI:

```bash
npm install -g firebase-tools
```

Na pasta do projeto:

```bash
firebase emulators:start
```

- Site: http://localhost:5000
- Painel dos emuladores (usuários e dados de teste): http://localhost:4000

Em `localhost`, o app usa automaticamente os emuladores, então nada é gravado no projeto real.

Para preencher os emuladores com dados de teste (unidades de saúde e dois usuários), rode em outro terminal:

```bash
node scripts/seed-emulator.mjs
```

| Usuário | Senha |
|---|---|
| gestor@teste.com | Teste@123 |
| plantonista@teste.com | Teste@123 |

Os emuladores apagam tudo ao fechar. Para manter os dados entre execuções:

```bash
firebase emulators:start --import=./emulator-data --export-on-exit
```

> Abrir o `index.html` direto pelo explorador de arquivos não funciona: os módulos JavaScript precisam de um servidor.

## Configurar o projeto Firebase real

1. Crie um projeto no [console do Firebase](https://console.firebase.google.com) (plano gratuito).
2. Em **Authentication > Método de login**, ative **E-mail/senha** e **Google**.
3. Em **Firestore Database**, crie o banco (região `southamerica-east1`, São Paulo).
4. Em **Configurações do projeto > Seus apps**, registre um app da **Web** e copie o `firebaseConfig` para [public/js/config.js](public/js/config.js).
5. Troque o ID do projeto em `.firebaserc`.

## Publicar

```bash
firebase deploy
```

## Commits

Cada commit começa com a versão seguida de um resumo curto:

```
1.0 - Estrutura inicial do projeto
1.0.1 - Regras de segurança e dados iniciais
```

A versão sobe no último número a cada commit (`1.0.1`, `1.0.2`…).
