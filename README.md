# API de leads — Corretor Rafael Moraes

Backend em **Node.js + Express + PostgreSQL** (SQL puro, sem ORM) que recebe e
armazena os leads enviados pelo formulário da
[landing page](https://github.com/IRMZI/Corretor-Rafael-Moraes).

- Recebe o payload JSON exatamente no formato que a landing page já envia
- Valida os campos e devolve o erro campo a campo
- Protege contra spam: honeypot, rate limit por IP e CORS restrito ao domínio do site
- Ignora reenvio do mesmo WhatsApp dentro de uma janela configurável
- Guarda UTMs, gclid/fbclid, página de origem, referrer, IP e user-agent
- Rotas de consulta protegidas por chave, com filtros, paginação e resumo

## Rodando localmente

```bash
git clone https://github.com/IRMZI/corretor-rafael-moraes-back.git
cd corretor-rafael-moraes-back
npm install
cp .env.example .env       # ajuste DATABASE_URL, CORS_ORIGINS e ADMIN_API_KEY
npm run dev
```

As migrations rodam sozinhas ao subir o servidor (`RUN_MIGRATIONS_ON_START=true`).
Para aplicá-las manualmente: `npm run migrate`.

Com Docker, subindo API e banco de uma vez:

```bash
docker compose up --build
```

## Variáveis de ambiente

| Variável | Padrão | Para que serve |
| --- | --- | --- |
| `PORT` | `3000` | Porta HTTP |
| `NODE_ENV` | `development` | Em `production` o servidor não sobe com configuração incompleta |
| `DATABASE_URL` | — | Conexão do PostgreSQL (ou use `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`) |
| `DATABASE_SSL` | `false` | `true` em bancos gerenciados (Neon, Supabase, RDS, Railway) |
| `RUN_MIGRATIONS_ON_START` | `true` | Aplica as migrations pendentes ao iniciar |
| `CORS_ORIGINS` | — | Domínios autorizados, separados por vírgula |
| `ADMIN_API_KEY` | — | Chave das rotas de consulta (header `x-api-key`) |
| `RATE_LIMIT_WINDOW_MINUTES` | `10` | Janela do rate limit |
| `RATE_LIMIT_MAX` | `20` | Envios permitidos por IP na janela |
| `DEDUPE_WINDOW_MINUTES` | `10` | Janela em que o mesmo WhatsApp não gera lead novo |
| `TRUST_PROXY` | `1` | Nº de proxies à frente da API (para o IP real chegar correto) |

Gere a chave administrativa com:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Conectando a landing page

No `index.html` da landing page, preencha o `CONFIG.endpoint` com a URL da API:

```js
const CONFIG = {
  // ...
  endpoint: 'https://sua-api.com.br/api/leads',
  metodo:   'POST'
};
```

Nada mais precisa mudar: a função `enviarLead()` já envia o JSON no formato esperado
e o campo honeypot `empresa` já existe no formulário.

Lembre de incluir o domínio do site em `CORS_ORIGINS` — inclusive `www` se ele for
usado, já que o navegador trata `https://site.com.br` e `https://www.site.com.br`
como origens diferentes.

## Rotas

### `POST /api/leads` — pública

Recebe o lead do formulário.

```json
{
  "nome": "Maria Souza",
  "whatsapp": "(51) 98765-4321",
  "email": "maria@exemplo.com",
  "cidade": "Novo Hamburgo",
  "objetivo": "comprar",
  "tipo_imovel": "apartamento",
  "faixa_investimento": "500k-800k",
  "origem": "landing-page",
  "pagina": "https://site.com.br/",
  "referrer": "https://google.com/",
  "utm": { "utm_source": "google", "gclid": "abc123" },
  "enviado_em": "2026-01-01T12:00:00.000Z"
}
```

Obrigatórios: `nome` (nome e sobrenome), `whatsapp` (10 a 15 dígitos), `email`,
`cidade`, `objetivo` e `tipo_imovel`. O restante é opcional. O e-mail é gravado em
minúsculas e o WhatsApp também é guardado só com dígitos, em `whatsapp_numeros`.

| Resposta | Quando |
| --- | --- |
| `201` | Lead gravado — `{ "ok": true, "lead": { "id": 1, "criado_em": "..." } }` |
| `200` | Reenvio do mesmo WhatsApp na janela de deduplicação (`duplicado: true`) |
| `202` | Honeypot preenchido: descartado em silêncio |
| `422` | Dados inválidos — `detalhes` traz a mensagem de cada campo |
| `429` | Rate limit por IP estourado |

### Rotas administrativas

Todas exigem o header `x-api-key: <ADMIN_API_KEY>` (ou `Authorization: Bearer <chave>`).

| Rota | O que faz |
| --- | --- |
| `GET /api/leads` | Lista com filtros `pagina`, `por_pagina` (máx. 100), `status`, `objetivo`, `tipo_imovel`, `busca`, `desde`, `ate` |
| `GET /api/leads/resumo` | Totais gerais, últimas 24h / 7 / 30 dias e contagem por status e objetivo |
| `GET /api/leads/:id` | Detalhe de um lead |
| `PATCH /api/leads/:id` | Atualiza `status` e `observacoes` |

Status possíveis: `novo`, `em_contato`, `qualificado`, `convertido`, `descartado`.

```bash
curl "https://sua-api.com.br/api/leads?status=novo&por_pagina=20" \
  -H "x-api-key: SUA_CHAVE"
```

### `GET /health`

Healthcheck com ping no banco — use no monitoramento do provedor de deploy.

## Testes

Os testes são de integração e precisam de um PostgreSQL descartável
(a tabela `leads` é esvaziada no início da suíte):

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/corretor_leads_test npm test
```

Sem `TEST_DATABASE_URL` definida, a suíte é ignorada em vez de falhar.

## Estrutura

```
src/
├── app.js                  # Express: middlewares, CORS, rotas, healthcheck
├── server.js               # Sobe o servidor, roda migrations, encerra limpo
├── config/env.js           # Variáveis de ambiente e validação da configuração
├── db/index.js             # Pool do PostgreSQL
├── db/migrate.js           # Executor de migrations (registra em schema_migrations)
├── routes/                 # Definição das rotas
├── controllers/            # Entrada HTTP: valida e responde
├── services/               # SQL dos leads
├── middlewares/            # Chave de acesso, rate limit, tratamento de erros
└── validators/             # Schemas (zod) do lead e dos filtros
db/migrations/              # Arquivos .sql aplicados em ordem
tests/                      # Testes de integração da API
```

## Deploy

Funciona em qualquer serviço que rode Node: Railway, Render, Fly.io, VPS com Docker.

1. Provisione um PostgreSQL e copie a `DATABASE_URL`
2. Configure as variáveis de ambiente (`DATABASE_SSL=true` em banco gerenciado)
3. Comando de start: `npm start` — as migrations rodam sozinhas no boot
4. Healthcheck: `/health`
5. Preencha o `CONFIG.endpoint` da landing page com a URL pública da API
