# Módulo de Grupos e Escalas

Especificação do módulo central do EscalaMed: **Unidades → Grupos → Membros → Turnos → Escalas mensais → Movimentações (troca, cessão, vaga) → Calendário → Relatórios**, além de valores, check-in/out e lembretes.

O comportamento foi levantado a partir do grupo de referência "TELEAUDITORIA HAPVIDA", que hoje roda em outra plataforma. A implementação é própria: não copiar código, marca nem layout de terceiros.

---

## 0. Regras do projeto (valem para todas as etapas)

- **Tecnologia já definida**: HTML, CSS e JavaScript puros (módulos ES, sem build) + **Firebase** (Authentication com e-mail e senha, Firestore e Hosting) + **Cloudflare Worker** com D1 de apoio (login por usuário, senha provisória, troca de e-mail; pasta `worker/`). Não introduzir framework, bundler ou Prisma; o único servidor é o Worker de contas.
- **A segurança fica nas regras do Firestore** ([firestore.rules](../firestore.rules)). Toda gravação nova precisa de regra correspondente, com validação de campos (`hasOnly`, tipos e tamanhos), como já é feito hoje. Coleção sem regra fica bloqueada.
- **Plano gratuito (Spark)** por padrão: sem Cloud Functions. O que exigir servidor fica marcado como **[Blaze]** e entra só se o plano mudar.
- **Custo de leitura**: o plano gratuito tem cerca de 50 mil leituras e 20 mil gravações por dia. Por isso a escala de um mês é **um documento só**, e não um documento por plantão.
- **Limite das regras**: cada gravação pode fazer no máximo 10 chamadas `get()`/`exists()` (20 em lote). Dados que as regras consultam muito ficam no próprio documento do grupo.
- **Nomes**: campos, funções e arquivos em inglês, seguindo o código atual (`title`, `startMinute`, `managerIds`…). Toda a interface em PT-BR, datas `dd/mm/aaaa`, moeda `R$`, fuso `America/Sao_Paulo` (o grupo já guarda `timezone`).
- **Reaproveitar o que existe**: [layout.js](../public/js/layout.js) (menu, gavetas, modais), [ui.js](../public/js/ui.js) (avisos, erros, menus, confirmação), [shifts.js](../public/js/shifts.js) (horários), [calendar.js](../public/js/calendar.js), [validators.js](../public/js/validators.js), listas em `public/data/`.
- **Testes**: a lógica pura (horas, sobreposição, replicação, permissões) fica em módulos sem import do Firebase, testados com `node --test`, que já vem no Node e não precisa instalar nada. As regras são testadas no emulador.
- Comentários no código em PT-BR, curtos.
- Ao final de cada etapa: testar no emulador (`firebase emulators:start` + `node scripts/seed-emulator.mjs`) e resumir o que foi feito.

---

## 1. O que já existe (não refazer)

| Item | Onde | Situação |
|---|---|---|
| Login, cadastro, perfil público e privado | `users/{uid}`, `users/{uid}/private/data` | Pronto |
| Unidades de saúde (nome, cidade, UF, busca, cadastro de nova) | `healthUnits/{id}` | Pronto |
| Grupo: nome, tipo (`team` ou `personal`), cor (17 cores), unidade, categoria, fuso | `groups/{id}` | Pronto |
| Wizard: etapa 1 (informações) e etapa 2 (turnos) | [group-new.js](../public/js/pages/group-new.js) | Pronto |
| Turnos: título, início e fim em minutos, virada da meia-noite, duração | `groups/{id}/shifts/{id}` + [shifts.js](../public/js/shifts.js) | Pronto |
| Lista de grupos com busca e calendário lateral | [schedules.js](../public/js/pages/schedules.js) | Pronto (sem seções por papel) |
| Criador do grupo vira gestor | `ownerId`, `managerIds`, `memberIds`, `members/{uid}` com `role: 'manager'` | Pronto |
| Escala individual (`type: 'personal'`) | wizard | Pronto. **Manter**: não existe no grupo de referência, mas faz parte do EscalaMed |
| Acesso, cadastro em 4 etapas (sem confirmação de e-mail), guards | `index.html`, `signup.html`, `auth.js` | Pronto |
| Login por e-mail (Firebase) ou nome de usuário (Worker na Cloudflare + D1), senha provisória pelo administrador da plataforma, troca de e-mail sem link | `worker/`, `auth-api.js`, `new-password.html` | Pronto e publicado |
| Cargos com limites, convites, alterar perfil, transferir gestão, remover, sair | `group.html` (aba Membros), `invite.html`, `permissions.js`, `members.js`, regras | Pronto, com testes |
| Configurações da conta (dados, profissão, foto, senha, exclusão) | `settings.html` | Pronto |
| Escala mensal (etapa 4): lista de meses por ano, grade com horas, vagas, bloqueio de horário sobreposto (inclusive entre dias), publicar (escala fixa + turnos congelados), replicar (dia da semana ou número do dia), imprimir | `groups/{g}/schedules/{YYYY-MM}`, `schedule-edit.html`, `schedule-math.js`, `schedule-data.js`, regras | Pronto, com testes: inclui Revisar (um dia por coluna, Fixa/Dinâmica), busca que filtra membros e quem está editando. Falta: notificações ao publicar e histórico `edit` |
| Calendário do grupo e "Plantões do dia" (etapa 5): dias com plantão, meus plantões do mês, gaveta com faixa de 7 dias e Dinâmica/Fixa, detalhes do plantão ("Quem mais está no plantão?") | `group.html` (aba Calendário) | Pronto. Falta: "Disponíveis" na tela Escalas (depende das movimentações) |
| Dias com plantão no calendário da tela Escalas | `schedules.js` | Pronto |

---

## 2. Conceitos

- **Unidade de saúde** (ex.: "HAPVIDA ANTONIO PRUDENTE"): reúne vários grupos. É compartilhada e não pode ser editada (regra atual). Por isso o endereço do check-in fica na configuração do grupo, e não na unidade.
- **Grupo** (ex.: "TELEAUDITORIA HAPVIDA"): setor ou equipe com escala própria.
- **Membro**: vínculo usuário ↔ grupo, com um **papel** naquele grupo.
- **Turno**: modelo do grupo (sigla + início + fim). Pode cruzar a meia-noite.
- **Escala mensal**: uma por grupo por mês (`YYYY-MM`), em rascunho ou publicada.
- **Alocação (plantão)**: membro + turno + dia, dentro de uma escala.
- **Movimentação**: troca, cessão ou preenchimento de vaga, sempre registrada no histórico.

---

## 3. Cargos da plataforma (desde 1.0.54)

O cargo vale para a plataforma inteira; os papéis por grupo (gestor, auxiliar, analista, observador,
plantonista) foram retirados. O cargo é escolhido no cadastro e em Configurações > Informações
profissionais (`users/{uid}.categoryId`).

| Cargo (`categoryId`) | Aprovação | O que pode |
|---|---|---|
| Dev (sem `categoryId`) | não se escolhe | Acima de todos: lê e grava qualquer documento do banco (inclusive escalas individuais e dados pessoais dos outros) e tem os poderes do administrador da plataforma. Definido por e-mail em `isDev()` no `firestore.rules`. |
| `gestor` | sim | Vê e altera todos os grupos de equipe: dados, turnos, escala, membros, coordenadores, excluir. Aprova cargos (Configurações > Usuários). |
| `coordenador-escala` | sim | Nos grupos em que o Gestor o marcou (`coordinatorIds`): monta e publica a escala, convida e remove membros (não remove outro coordenador). Cria grupos e vira coordenador do que criou; ajusta dados e turnos só enquanto o grupo está sendo criado. |
| `administrativo` | sim | Vê as escalas publicadas, o histórico e os relatórios de todos os grupos de equipe. Não altera nada e não vê rascunhos. |
| `medico` | não | Vê os grupos em que está (só o publicado); troca, cede e pega vaga. |

- **Aprovação**: `access/{uid}` = `{ categoryId, approved, decidedBy, decidedAt }`, gravado pelo administrador da plataforma (`config/admins`) ou por um Gestor aprovado, nunca sobre si mesmo, e sempre com o cargo que a pessoa pediu. Até ser aprovada (e se o pedido for recusado), a pessoa não entra na plataforma: toda página interna (`initLayout`) manda para `aguardando.html`, que libera a entrada sozinha quando o `access` dela é aprovado (tempo real). As regras continuam dando a ela só o acesso de Médico. Ao trocar de cargo, o app apaga o `access` dela e o pedido volta para a lista.
- **Administrador da plataforma** vale como Gestor.
- **Sessão encerrada** (desde 1.0.61): ao inativar, gerar senha provisória ou excluir um acesso em Configurações > Usuários, o app do administrador grava `sessions/{uid}` = `{ endedAt, endedBy }` (só o administrador grava, só a própria pessoa lê). O app da pessoa escuta esse documento (`watchSession` em `auth.js`) e sai na hora, com o aviso na tela de entrada; ao voltar para a aba, também confere a conta no Firebase.
- **Dev** (desde 1.0.55): e-mails listados em `isDev()` no `firestore.rules`; um `match /{document=**}` libera leitura e gravação de tudo para eles. Ninguém escolhe esse cargo no app: para incluir alguém, adicione o e-mail e publique as regras. O app (`access.js`) e o Worker (`ehDev`) descobrem o cargo tentando ler `config/dev`, que só o Dev pode ler (o documento não precisa existir). No app, o Dev vê todos os grupos (seção "Escalas individuais de outras pessoas" para as dos outros), tem todas as ações de grupo e as de administrador em Configurações > Usuários; o cargo aparece como "Dev" embaixo do nome.
- **Apagar dados** (Configurações > Apagar dados, só Dev, desde 1.0.56): apaga no Firebase todos os grupos (com `members`, `invites`, `shifts`, `movements` e `schedules`), `access` e `healthUnits`, lendo do servidor e em lotes de 400; pede para digitar APAGAR. Mantém `users` (e `private`), `config` e os logins. Depois chama `/agenda/limpar-tudo` no Worker, que esvazia `agenda_desejados` e marca todos como pendentes: o Cron tira os plantões das Agendas Google. No plano gratuito o Firebase aceita 20 mil exclusões por dia; se parar no meio, é só rodar de novo.
- **Grupo de equipe**: `memberIds` (quem está na escala) e `coordinatorIds` (sempre também membros). Entrar só por convite (sem cargo no convite). O direito de coordenador só vale com o cargo aprovado: retirar a aprovação tira o acesso sem mexer nos grupos.
- **Escala individual** (`type: 'personal'`): `memberIds == [dono]`, sem coordenadores; só o dono vê e edita.
- **Código**: `public/js/permissions.js` (`platformRoleOf`, `approvalState`, `groupRole`, `can`) com testes; `public/js/access.js` lê o cargo de quem está logado; `public/js/my-groups.js` junta as consultas que as regras permitem (grupos em que está, que coordena e, para Gestor e Administrativo, `type == 'team'`). O `firestore.rules` repete a mesma tabela (`platformRole()`, `editorOf()`, `canView()`), testado em `tests/rules/rules.test.mjs`.
- **Telas**: lista de grupos em seções "Coordeno", "Participo", "Outros grupos" e "Escalas individuais"; aba Membros com as seções "Coordenadores de escala" e "Membros" e o modal "Gerenciar membro"; Configurações > Usuários com quem está sem acesso (aguardando aprovação ou recusado) no topo da lista, em destaque, com Aprovar/Recusar na linha.

---

## 4. Turnos

Já existe: modal com título, início e fim; cálculo de duração com virada da meia-noite (`durationMinutes`).

Acrescentar:
- Campo `order` (ordem de exibição na grade). Padrão: horário de início.
- **Exclusão segura**: se o turno já aparece em alguma escala, gravar `deletedAt` (some das escalas novas, continua nas antigas) em vez de apagar. Atualizar `validShift` nas regras.
- Função `overlaps(shiftA, shiftB)` em [shifts.js](../public/js/shifts.js), considerando a virada da meia-noite, com testes.

Turnos do grupo de referência (vão para o seed):

| Sigla | Início | Fim | Duração | Observação |
|---|---|---|---|---|
| M | 07:00 | 13:00 | 6h | |
| T | 13:00 | 19:00 | 6h | |
| REF | 16:00 | 19:00 | 3h | Reforço, dentro do T |
| N | 19:00 | 01:00 | 6h | Cruza a meia-noite |
| N1 | 19:00 | 22:00 | 3h | 1ª parte da noite |
| NF | 22:00 | 01:00 | 3h | Parte final da noite |

Regras:
- O plantão pertence ao **dia em que começa** (o N do dia 30 termina à 01:00 do dia 31).
- Turnos diferentes podem se sobrepor (REF dentro do T; N = N1 + NF).
- **O mesmo membro não pode estar em dois turnos sobrepostos no mesmo dia** (ex.: N e N1). Isso também vale entre dias: o N do dia 30 sobrepõe um turno de 00:00 do dia 31. A tela mostra aviso e não deixa alocar.

---

## 5. Escala mensal

### 5.1 Onde fica
Um documento por mês: `groups/{g}/schedules/{YYYY-MM}`.

```
status:       'draft' | 'published'
assignments:  { "<dia>_<shiftId>": [uid, ...] }   // escala dinâmica (situação atual)
vacancies:    { "<dia>_<shiftId>": número }       // vagas abertas (0 a 20)
fixed:        { "<dia>_<shiftId>": [uid, ...] }   // escala fixa: cópia gravada ao publicar
shifts:       { "<shiftId>": { title, startMinute, endMinute } }  // turnos congelados ao publicar
publishedAt, publishedBy, updatedAt, updatedBy
```

- `<dia>` é o número do dia com dois dígitos (`"07"`).
- Mês sem documento = **sem escala**.
- Alocar e desalocar: `updateDoc` no campo `assignments.07_abc` com `arrayUnion`/`arrayRemove`. Isso evita que duas pessoas editando ao mesmo tempo apaguem o trabalho uma da outra.
- Tamanho: 31 dias × 6 turnos × alguns uids fica muito abaixo do limite de 1 MB por documento.

### 5.2 Escala fixa × escala dinâmica
- **Fixa** (`fixed`): o que foi planejado. Copiada de `assignments` no momento em que a escala é publicada e não muda mais. Se a escala for publicada de novo, a cópia é refeita e o histórico registra a republicação.
- **Dinâmica** (`assignments`): a situação atual, já com trocas, cessões e vagas preenchidas.
- **Por que assim**: ler um único documento já dá as duas visões. O relatório usa a dinâmica; a comparação "planejado × realizado" usa as duas.

### 5.3 Lista "Gerenciamento de escalas"
Navegação por ano (← 2026 →). Lista os 12 meses, do mais recente para o mais antigo, com status e botão "Editar escala":
- Sem escala (cinza)
- Em rascunho (amarelo)
- Publicada (azul)

### 5.4 Editor (grade)
Rota: `/schedule-edit.html?group=<id>&month=YYYY-MM`.

- Cabeçalho: nome do grupo, unidade, "Mês Ano" e quem está editando.
- **Colunas**: dias do mês com a inicial do dia da semana (D S T Q Q S S) e o número. Fim de semana com fundo destacado.
- **Linhas**: para cada membro (ordem alfabética), uma sub-linha por turno. A coluna "Nome" ocupa as sub-linhas e mostra o **total de horas do membro no mês** (ex.: "18h00").
- **Primeiro bloco fixo, "Plantão vago"**: uma sub-linha por turno; cada célula guarda a quantidade de vagas abertas (seletor de 0 a 20 + "Confirmar").
- Clicar numa célula de membro aloca ou desaloca (mostra o avatar na célula) e recalcula as horas na hora. Bloqueia sobreposição (seção 4).
- Busca de membro no rodapé ("Quem gostaria de encontrar?"), que rola até a linha.

Exemplo: M + T + N no mesmo dia = 6 + 6 + 6 = 18h. T + N + NF em dias diferentes = 6 + 6 + 3 = 15h.

Barra de ações no rodapé:
- **Status** ("Escala em rascunho").
- **Imprimir**: CSS de impressão da grade (`window.print()`), que também serve para salvar em PDF.
- **Revisar**: modal com uma coluna por dia (número + dia da semana por extenso) e, dentro, os cartões de turno com os avatares. Alternância Fixa / Dinâmica.
- **Replicar**: "Replicar escala de [mês] para [mês seguinte]". Copia as alocações por **dia da semana + posição na semana** (padrão) ou pelo número do dia. Cria o mês de destino como rascunho. Se o destino já estiver publicado, pede confirmação.
- **Publicar**: muda para publicada, grava `fixed` e os turnos congelados e cria as notificações no app para os membros alocados (seção 10).

Uma escala publicada continua editável por gestor e auxiliar. Cada mudança depois da publicação gera registro no histórico (tipo `edit`).

### 5.5 Regras do Firestore
- Ler: membro do grupo. Observador e plantonista só leem se `status == 'published'`.
- Criar e editar livremente: gestor e auxiliar.
- Plantonista: só pode mexer em `assignments` e `vacancies` junto com uma movimentação aceita, no mesmo lote (seção 6.3).

### 5.6 Lógica pura (com testes)
`public/js/schedule-math.js`: horas por membro, conflito de horário (inclusive entre dias), replicação por dia da semana ou por número do dia, montagem da visão "plantões do dia".

---

## 6. Movimentações e histórico

### 6.1 Tipos
1. **Cessão** (`cession`): A passa o plantão dele (dia + turno) para B.
2. **Troca** (`swap`): A e B trocam dois plantões entre si.
3. **Vaga** (`vacancy`): um membro assume uma vaga aberta; a quantidade de vagas da célula diminui em 1.
4. **Edição** (`edit`): mudança feita por gestor ou auxiliar numa escala já publicada (só para o histórico).

### 6.2 Onde fica
`groups/{g}/movements/{id}`:

```
type, status: 'pending' | 'awaiting_manager' | 'accepted' | 'declined' | 'cancelled'
month: 'YYYY-MM'                       // para filtrar o histórico por mês
fromUid, toUid
origin: { day, shiftId }               // plantão de A
target: { day, shiftId } | null        // plantão de B (só na troca)
createdAt, resolvedAt, resolvedBy
```

Índices compostos (em [firestore.indexes.json](../firestore.indexes.json)): `month + status + createdAt` e `month + type + createdAt`.

### 6.3 Fluxo
1. A cria o pedido (`pending`).
2. B aceita ou recusa. Antes de aceitar, a tela confere se B tem conflito de horário.
3. Se o grupo exigir aprovação (`requireManagerApproval` no grupo), o pedido vai para `awaiting_manager` e o gestor ou auxiliar aprova.
4. Ao concluir, **um único lote** grava a movimentação como `accepted` e atualiza `assignments` da escala. A regra da escala usa `getAfter()` para conferir que existe uma movimentação aceita naquele lote e que a mudança é só aquela (o uid de A saiu da célula e o de B entrou).

É a parte mais delicada das regras. Se ficar complexa demais, a alternativa é uma Cloud Function **[Blaze]**.

### 6.4 Cessão entre grupos (decisão pendente)
No grupo de referência há uma tela com todos os outros grupos da mesma unidade (nome, gestor, categoria) e uma chave por grupo: ligada, os membros deste grupo podem ceder plantões para membros daquele grupo.

Pendente: quem recebe não é membro do grupo de origem e, pelas regras, não pode ler nem gravar a escala dele. Opções: (a) quem recebe entra como membro "convidado" do grupo de origem; (b) só gestor ou auxiliar concluem cessões entre grupos. **Definir antes da etapa 6.** Guardar a lista em `groups/{g}.cessionGroupIds`.

### 6.5 Tela "Histórico de movimentações"
Navegação por mês, filtro por membro ("Todos os membros" + lista) e por tipo (Todas / Apenas trocas / Apenas cessões / Apenas plantões vagos). Cada item:

```
Cessão realizada em: 30/09/2026 15:33
[Membro A] Médico / Clínico Geral   30/09/2026  19h00 - 01h00 (N)
     →
[Membro B] Médico / Clínico Geral   30/09/2026  19h00 - 01h00 (N)
```

Estado vazio: ícone de ampulheta + "Não encontramos nenhum histórico para os filtros informados."

---

## 7. Tela do grupo

Substitui o aviso provisório de [group.html](../public/group.html).

- **Abas**: Calendário | Editar escala | Membros | Histórico | Relatório. Esconder as que o papel não permite (`can()`).
- **Menu ⋮**: Configurações do grupo (reabre o wizard), Lembretes, Permissões de cessão, Turnos da escala, Configurar check-in/out, Valores da escala, Sair do grupo.

### Calendário (aba inicial)
- Mês com navegação ‹ Outubro 2026 ›. Os dias em que **o usuário tem plantão** ficam destacados, e o dia de hoje tem borda. Reaproveitar [calendar.js](../public/js/calendar.js).
- Clicar num dia abre a gaveta **"Plantões do dia"**, usando a gaveta do [layout.js](../public/js/layout.js):
  - faixa de 7 dias navegável, destacando os dias com plantão;
  - alternância Dinâmica / Fixa;
  - um cartão por turno (`SIGLA - 07h00 ÀS 13h00`) com os avatares de quem está alocado, ou vazio.

### Tela "Escalas" (lista de grupos)
- O calendário lateral destaca os dias com plantão do usuário em todos os grupos (lê o documento do mês de cada grupo).
- O painel "Disponíveis (N)" lista as vagas abertas nos grupos do usuário, com botão para pegar a vaga (gera a movimentação `vacancy`).

---

## 8. Relatório de plantões

Filtros: data inicial, data final e membro (todos ou um) → "Gerar relatório". Tudo é calculado no navegador a partir dos documentos dos meses do período.

Resultado: um acordeão por membro (nome + `Categoria / Especialidade - Nº / UF`). Aberto:

| Plantões (N) | Produção | Produtividade | Total |
|---|---|---|---|
| 01 SET TER — 07:00 às 13:00 TURNO (M) | R$ x | R$ y | R$ x+y |

- **Produção**: valor do plantão (horas × valor/hora do turno naquele dia da semana, ou valor fixo), menos o desconto de atraso, se estiver ativo.
- **Produtividade**: atendimentos lançados × valor de cada tipo.
- Usa a **escala dinâmica**.
- **Exportar**: CSV (gerado no navegador) e XLSX (SheetJS pelo CDN, com versão fixa). PDF pela impressão.
- Sem valores configurados: mostrar R$ 0,00 e um aviso.
- Quem vê: gestor, auxiliar e analista veem todos; o plantonista vê só o próprio.

---

## 9. Valores da escala

Ficam em `groups/{g}/settings/values`. Leitura e gravação só para gestor (auxiliar e analista podem ler). O plantonista não lê esse documento.

- Chave **Habilitar valores**: vale para as próximas escalas publicadas.
- **Valores por horário**: matriz turno × dia da semana (Dom a Sáb), com `valueType: 'hour' | 'shift'`. Feriados opcionais.
- **Produtividade**: tipos de atendimento (Convênio, Plano de saúde, Particular…) com valor unitário, em `groups/{g}/serviceTypes`. Lançamentos por plantão em `groups/{g}/schedules/{mês}/attendances/{dia_turno_uid}`.
- Ao publicar, os valores são **congelados** em `groups/{g}/schedules/{mês}/private/values`, com a mesma regra de leitura. Assim, mudar valores depois não altera escalas já publicadas.

---

## 10. Check-in/out, notificações e lembretes

### Check-in/out
Configuração em `groups/{g}/settings/checkin`:
- habilitar check-in/out;
- habilitar geolocalização, com endereço, `lat`, `lng` e raio em metros. Fora do raio, a batida é marcada como "fora da área" (sinaliza, não bloqueia);
- calcular atrasos (desconto proporcional no valor do plantão);
- tolerâncias em minutos: entrada antes e depois do início, saída antes e depois do fim.

Batidas em `groups/{g}/punches/{id}`: `uid`, `month`, `day`, `shiftId`, `type: 'in' | 'out'`, `at` (sempre `request.time`, a hora do servidor), `lat`, `lng`, `insideArea`, `lateMinutes`. Cada um só cria as próprias batidas, e ninguém altera ou apaga. Usar a página [checkin.html](../public/checkin.html), que já existe.

Limitação: sem servidor, a localização vem do aparelho e pode ser falsificada. Serve para sinalizar, não como prova.

### Notificações no app (funciona no plano gratuito)
`users/{uid}/notifications/{id}`: quem publica a escala ou conclui uma movimentação grava a notificação para os membros afetados, no mesmo lote. A regra só permite isso a membros do mesmo grupo. O sino da barra superior mostra as não lidas.

### Lembretes
- **Plano gratuito**: botão "Adicionar à agenda", que gera um arquivo `.ics` com os plantões do mês e alarmes (1h, 2h, 6h, 12h ou 24h antes, à escolha do usuário). O celular ou o Google Agenda cuidam do aviso. As preferências ficam em `users/{uid}/private/data`.
- **Agenda Google** (feito): os plantões publicados vão para uma agenda "EscalaMed" no Google da pessoa, com lembrete, e se atualizam quando a escala muda. Fica no serviço de contas (Cloudflare Worker), sem Blaze. Ver "Agenda Google" no README.
- **[Blaze]**: lembretes automáticos por push ou e-mail, com uma Cloud Function agendada lendo a escala dinâmica.

---

## 11. Coleções (resumo)

```
users/{uid}                                  (existe)
users/{uid}/private/data                     (existe; + preferências de lembrete)
users/{uid}/notifications/{id}               NOVO
healthUnits/{id}                             (existe)
groups/{g}                                   (existe; + assistantIds, analystIds, observerIds,
                                               requireManagerApproval, cessionGroupIds)
groups/{g}/members/{uid}                     (existe; + papéis e dados do cartão)
groups/{g}/shifts/{id}                       (existe; + order, deletedAt)
groups/{g}/schedules/{YYYY-MM}               NOVO
groups/{g}/schedules/{YYYY-MM}/private/values NOVO
groups/{g}/schedules/{YYYY-MM}/attendances/{id} NOVO
groups/{g}/movements/{id}                    NOVO
groups/{g}/settings/values                   NOVO
groups/{g}/settings/checkin                  NOVO
groups/{g}/serviceTypes/{id}                 NOVO
groups/{g}/punches/{id}                      NOVO
```

---

## 12. Ordem de implementação

0. **Projeto Firebase real**: `escalamed-hapvida`, na conta tiago.tlmsmartins@gmail.com, com o app web registrado e ligado em [config.js](../public/js/config.js) e [.firebaserc](../.firebaserc) (apelido `prod`). Firestore em `southamerica-east1` (São Paulo; a região não pode ser mudada depois) e login por e-mail e senha. O app usa o banco real também em localhost; os emuladores são opcionais (`USE_LOCAL_EMULATORS` em config.js).
1. **Membros e papéis** (feito): campos do grupo, regras, `permissions.js` com testes, wizard etapa 3, aba Membros (adicionar, alterar perfil, remover, sair) e lista de grupos em seções por papel. Seed: unidade "HAPVIDA ANTONIO PRUDENTE", grupo "TELEAUDITORIA HAPVIDA", os 6 turnos e cerca de 12 membros **fictícios** com papéis variados.
2. **Tela do grupo**: abas, menu ⋮ e calendário ainda sem plantões.
3. **Turnos**: `order`, exclusão segura e `overlaps()` com testes (inclusive a virada da meia-noite).
4. **Escala mensal**: lista de meses, grade, horas, vagas, revisar, replicar, imprimir e publicar (escala fixa + notificações). Seed: janeiro a setembro publicados e outubro em rascunho.
5. **Calendário + gaveta "Plantões do dia"** (fixa/dinâmica) + destaque e "Disponíveis" na tela Escalas.
6. **Movimentações**: troca, cessão e vaga, com regras e histórico com filtros. Antes, decidir a cessão entre grupos (6.4).
7. **Relatório e exportação.**
8. **Valores, check-in/out e lembretes** (`.ics`; push só com Blaze).

### Critérios de aceite
- Toda gravação nova coberta por regra, testada no emulador também com um usuário **sem** permissão.
- Testes `node --test` para horas, conflitos (inclusive entre dias), replicação e `can()`.
- Telas responsivas (celular), usando os componentes e o CSS que já existem.
- Nenhum dado pessoal real no seed.
