-- Tabela principal de leads capturados pela landing page.
CREATE TABLE IF NOT EXISTS leads (
  id                 BIGSERIAL PRIMARY KEY,
  nome               TEXT        NOT NULL,
  email              TEXT        NOT NULL,
  whatsapp           TEXT        NOT NULL,
  whatsapp_numeros   TEXT        NOT NULL,
  cidade             TEXT        NOT NULL,
  objetivo           TEXT        NOT NULL,
  tipo_imovel        TEXT        NOT NULL,
  faixa_investimento TEXT,
  origem             TEXT        NOT NULL DEFAULT 'landing-page',
  pagina             TEXT,
  referrer           TEXT,
  utm                JSONB       NOT NULL DEFAULT '{}'::jsonb,
  status             TEXT        NOT NULL DEFAULT 'novo',
  observacoes        TEXT,
  ip                 TEXT,
  user_agent         TEXT,
  enviado_em         TIMESTAMPTZ,
  criado_em          TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT leads_status_check
    CHECK (status IN ('novo', 'em_contato', 'qualificado', 'convertido', 'descartado'))
);

CREATE INDEX IF NOT EXISTS leads_criado_em_idx        ON leads (criado_em DESC);
CREATE INDEX IF NOT EXISTS leads_status_idx           ON leads (status);
CREATE INDEX IF NOT EXISTS leads_whatsapp_numeros_idx ON leads (whatsapp_numeros);
CREATE INDEX IF NOT EXISTS leads_email_idx            ON leads (lower(email));

-- Mantem atualizado_em sempre coerente, independente de quem escreve na tabela.
CREATE OR REPLACE FUNCTION set_atualizado_em() RETURNS TRIGGER AS $$
BEGIN
  NEW.atualizado_em = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS leads_set_atualizado_em ON leads;
CREATE TRIGGER leads_set_atualizado_em
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();
