-- EscalaMed - Agenda Google: os plantões de cada pessoa numa agenda "EscalaMed" no Google dela.
-- Aplicar: npx wrangler d1 migrations apply escalamed-contas --remote

-- Quem conectou. Os tokens do Google ficam criptografados (chave derivada de GOOGLE_SEGREDO).
CREATE TABLE agenda_contas (
  uid TEXT PRIMARY KEY,                       -- uid do Firebase
  calendario TEXT,                            -- id da agenda "EscalaMed" no Google
  renovacao TEXT NOT NULL,                    -- token de renovação (refresh token)
  acesso TEXT,                                -- token de acesso (vale 1 hora)
  acesso_ate INTEGER NOT NULL DEFAULT 0,      -- validade do token de acesso (ms)
  lembrete INTEGER NOT NULL DEFAULT 60,       -- minutos antes do plantão (0 = sem lembrete)
  fuso TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  pendente INTEGER NOT NULL DEFAULT 1,        -- 1 = falta enviar alguma mudança ao Google
  sincronizado_em INTEGER,                    -- última vez que a agenda ficou em dia (ms)
  tentado_em INTEGER NOT NULL DEFAULT 0,      -- última tentativa de envio (o Cron começa pela mais antiga)
  conectado_em INTEGER NOT NULL
);

CREATE INDEX agenda_pendentes ON agenda_contas (pendente, tentado_em);

-- O que deveria estar na agenda de cada pessoa (um plantão = um evento)
CREATE TABLE agenda_desejados (
  uid TEXT NOT NULL,
  evento TEXT NOT NULL,                       -- id do evento no Google (fixo por pessoa, grupo, mês e célula)
  grupo TEXT NOT NULL,
  mes TEXT NOT NULL,                          -- YYYY-MM
  dados TEXT NOT NULL,                        -- JSON: título, local, descrição, início e fim
  PRIMARY KEY (uid, evento)
);

CREATE INDEX agenda_desejados_escala ON agenda_desejados (grupo, mes);
CREATE INDEX agenda_desejados_mes ON agenda_desejados (uid, mes);

-- O que já está na agenda do Google (assinatura = resumo do conteúdo enviado)
CREATE TABLE agenda_enviados (
  uid TEXT NOT NULL,
  evento TEXT NOT NULL,
  assinatura TEXT NOT NULL,                   -- vazia = existe no Google, mas precisa ser regravado
  PRIMARY KEY (uid, evento)
);
