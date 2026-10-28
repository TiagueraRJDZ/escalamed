-- EscalaMed - dados do serviço de contas. As senhas ficam no Firebase Authentication;
-- aqui ficam só os nomes de usuário (login por usuário), o limite de tentativas e o histórico.
-- Aplicar: npx wrangler d1 migrations apply escalamed-contas --remote

-- Nome de usuário → conta do Firebase (o e-mail não fica aqui nem é devolvido a ninguém)
CREATE TABLE usuarios (
  usuario TEXT PRIMARY KEY,                   -- em minúsculas
  uid TEXT NOT NULL UNIQUE,                   -- uid do Firebase
  criado_em INTEGER NOT NULL
);

-- Limite de pedidos por endereço IP (contra robôs tentando senhas)
CREATE TABLE limites (
  chave TEXT PRIMARY KEY,                     -- "<rota>:<ip>"
  janela INTEGER NOT NULL,                    -- minuto atual (ms / 60000)
  total INTEGER NOT NULL
);

-- Histórico (auditoria): senha provisória, troca de e-mail e de nome de usuário
CREATE TABLE eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL,                          -- conta afetada
  tipo TEXT NOT NULL,                         -- senha-provisoria, email, usuario
  por_uid TEXT,                               -- quem fez (senha provisória: o gestor)
  ip TEXT,
  em INTEGER NOT NULL
);

CREATE INDEX eventos_por_conta ON eventos (uid, em);
