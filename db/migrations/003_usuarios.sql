-- Contas do painel /admin.
--
-- Ate aqui o login comparava com um unico par ADMIN_EMAIL/ADMIN_PASSWORD vindo
-- do ambiente: uma credencial para todo mundo, em texto puro, e sem como saber
-- quem entrou. Com a tabela cada pessoa tem a sua conta, a senha fica guardada
-- como hash e o acesso pode ser revogado sem redeploy.

CREATE TABLE IF NOT EXISTS usuarios (
  id               BIGSERIAL   PRIMARY KEY,
  email            TEXT        NOT NULL UNIQUE,
  nome             TEXT,
  -- scrypt$N$r$p$salt$derivada, tudo em base64url (ver services/usuarios.service.js)
  senha_hash       TEXT        NOT NULL,
  ativo            BOOLEAN     NOT NULL DEFAULT TRUE,
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_acesso_em TIMESTAMPTZ
);

-- O login busca sempre por e-mail; o painel lista os ativos primeiro.
CREATE INDEX IF NOT EXISTS idx_usuarios_ativos ON usuarios (ativo);
