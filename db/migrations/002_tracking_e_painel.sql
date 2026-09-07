-- Rastreamento de visitantes anonimos, jornada, campanhas e vendas.

-- Um visitante = um navegador (id gerado no cliente e guardado no localStorage).
CREATE TABLE IF NOT EXISTS visitantes (
  id                   BIGSERIAL PRIMARY KEY,
  visitante_uid        TEXT        NOT NULL UNIQUE,
  primeiro_acesso_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_acesso_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  total_sessoes        INTEGER     NOT NULL DEFAULT 0,
  total_eventos        INTEGER     NOT NULL DEFAULT 0,
  tempo_total_segundos INTEGER     NOT NULL DEFAULT 0,
  -- Atribuicao de primeiro clique: de onde esse visitante veio na primeira visita
  campanha             TEXT,
  origem               TEXT,
  midia                TEXT,
  campanha_id          TEXT,
  referrer             TEXT,
  utm                  JSONB       NOT NULL DEFAULT '{}'::jsonb,
  dispositivo          TEXT,
  ip                   TEXT,
  user_agent           TEXT,
  convertido           BOOLEAN     NOT NULL DEFAULT false,
  convertido_em        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS visitantes_ultimo_acesso_idx ON visitantes (ultimo_acesso_em DESC);
CREATE INDEX IF NOT EXISTS visitantes_campanha_idx      ON visitantes (campanha);
CREATE INDEX IF NOT EXISTS visitantes_convertido_idx    ON visitantes (convertido);

-- Uma sessao = uma visita (id guardado no sessionStorage).
CREATE TABLE IF NOT EXISTS sessoes (
  id                BIGSERIAL PRIMARY KEY,
  sessao_uid        TEXT        NOT NULL UNIQUE,
  visitante_id      BIGINT      NOT NULL REFERENCES visitantes (id) ON DELETE CASCADE,
  iniciada_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_evento_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  duracao_segundos  INTEGER     NOT NULL DEFAULT 0,
  total_eventos     INTEGER     NOT NULL DEFAULT 0,
  pagina_entrada    TEXT,
  referrer          TEXT,
  campanha          TEXT,
  origem            TEXT,
  midia             TEXT,
  campanha_id       TEXT,
  utm               JSONB       NOT NULL DEFAULT '{}'::jsonb,
  dispositivo       TEXT,
  ip                TEXT,
  user_agent        TEXT,
  convertida        BOOLEAN     NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS sessoes_visitante_idx  ON sessoes (visitante_id);
CREATE INDEX IF NOT EXISTS sessoes_iniciada_idx   ON sessoes (iniciada_em DESC);
CREATE INDEX IF NOT EXISTS sessoes_campanha_idx   ON sessoes (campanha);
CREATE INDEX IF NOT EXISTS sessoes_convertida_idx ON sessoes (convertida);

-- Jornada: cada passo do visitante na pagina.
CREATE TABLE IF NOT EXISTS eventos (
  id           BIGSERIAL PRIMARY KEY,
  sessao_id    BIGINT      NOT NULL REFERENCES sessoes (id) ON DELETE CASCADE,
  visitante_id BIGINT      NOT NULL REFERENCES visitantes (id) ON DELETE CASCADE,
  tipo         TEXT        NOT NULL,
  pagina       TEXT,
  dados        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  ocorrido_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS eventos_sessao_idx    ON eventos (sessao_id, ocorrido_em);
CREATE INDEX IF NOT EXISTS eventos_visitante_idx ON eventos (visitante_id, ocorrido_em DESC);
CREATE INDEX IF NOT EXISTS eventos_tipo_idx      ON eventos (tipo);

-- Liga a conversao ao visitante e guarda tags / venda.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS visitante_id BIGINT REFERENCES visitantes (id) ON DELETE SET NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS sessao_id    BIGINT REFERENCES sessoes (id)    ON DELETE SET NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS tags         TEXT[]        NOT NULL DEFAULT '{}';
-- Campanha resolvida no momento da conversao: o relatorio por campanha continua
-- funcionando mesmo para lead que chegou sem o script de rastreamento.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS campanha     TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS origem_trafego TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS midia        TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS campanha_id  TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS valor_venda  NUMERIC(12,2);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS vendido_em   TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS leads_visitante_idx ON leads (visitante_id);
CREATE INDEX IF NOT EXISTS leads_tags_idx      ON leads USING GIN (tags);
CREATE INDEX IF NOT EXISTS leads_campanha_idx  ON leads (campanha);

-- Venda marcada no painel: gera o evento de conversao enviado aos anuncios.
CREATE TABLE IF NOT EXISTS vendas (
  id          BIGSERIAL PRIMARY KEY,
  lead_id     BIGINT      NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  evento_uid  TEXT        NOT NULL UNIQUE,
  valor       NUMERIC(12,2),
  moeda       TEXT        NOT NULL DEFAULT 'BRL',
  integracoes JSONB       NOT NULL DEFAULT '{}'::jsonb,
  criada_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vendas_lead_idx  ON vendas (lead_id);
CREATE INDEX IF NOT EXISTS vendas_criada_idx ON vendas (criada_em DESC);
