-- EscalaMed - notificações push no celular (as mesmas do sininho). Ver worker/src/push.js.
-- Aplicar: npx wrangler d1 migrations apply escalamed-contas --remote

-- Aparelhos inscritos: cada navegador/app instalado que aceitou receber notificações.
-- endpoint e chaves vêm do PushManager do navegador (não são segredo do servidor).
CREATE TABLE push_inscricoes (
  endpoint TEXT PRIMARY KEY,                  -- endereço do serviço de push (Google, Apple, Mozilla...)
  uid TEXT NOT NULL,                          -- conta que recebe neste aparelho
  p256dh TEXT NOT NULL,                       -- chave pública do aparelho (criptografia da mensagem)
  auth TEXT NOT NULL,                         -- segredo de autenticação do aparelho
  aparelho TEXT,                              -- descrição curta ("iPhone", "Android · Chrome"...)
  criado_em INTEGER NOT NULL,
  usado_em INTEGER NOT NULL                   -- última inscrição ou envio com sucesso (ms)
);

CREATE INDEX push_por_conta ON push_inscricoes (uid);

-- Avisos já enviados (o mesmo aviso não sai duas vezes se o app pedir de novo)
CREATE TABLE push_avisos (
  chave TEXT PRIMARY KEY,                     -- tipo:grupo:convite:momento
  em INTEGER NOT NULL
);
