# API de leads e painel — Corretor Rafael Moraes

Backend em **Node.js + Express + PostgreSQL** (SQL puro, sem ORM) que recebe os
leads da [landing page](https://github.com/IRMZI/Corretor-Rafael-Moraes),
rastreia os visitantes anônimos e entrega tudo num **painel administrativo em
`/admin`**.

**Captação de leads**

- Recebe o payload JSON exatamente no formato que a landing page já envia
- Valida os campos e devolve o erro campo a campo
- Protege contra spam: honeypot, rate limit por IP e CORS restrito ao domínio do site
- Ignora reenvio do mesmo WhatsApp dentro de uma janela configurável

**Rastreamento e métricas**

- Script `/track.js` que a landing page carrega: identifica o visitante anônimo,
  a visita e a campanha de origem — sem cookie e sem dado pessoal
- Jornada completa: abriu a página, rolou, começou o formulário, clicou no
  WhatsApp, converteu, saiu — com o tempo de permanência real (só conta a aba visível)
- Acessos em 7 / 30 / 90 dias, tempo médio na página, funil e taxa de conversão
- Desempenho por campanha (UTM, ou gclid/fbclid quando a UTM não vem)

**Painel administrativo**

O painel em si mora no [site](https://github.com/IRMZI/Corretor-Rafael-Moraes),
em `/admin` — esta API entrega os dados e a sessão:

- Login por e-mail e senha, com sessão em cookie assinado que atravessa domínios
- Métricas, campanhas, visitantes (com a jornada de cada um) e conversões
- Tags nos leads; marcar **vendido** registra a venda e dispara o evento de
  conversão para a Meta (API de Conversões) e o GA4

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
| `ADMIN_EMAIL` | — | E-mail do login do painel |
| `ADMIN_PASSWORD` | — | Senha do login do painel |
| `SESSION_SECRET` | — | Segredo que assina o cookie de sessão do painel |
| `SESSION_HOURS` | `12` | Horas até a sessão do painel expirar |
| `META_PIXEL_ID` / `META_ACCESS_TOKEN` | — | Envio da venda pela API de Conversões da Meta |
| `GA4_MEASUREMENT_ID` / `GA4_API_SECRET` | — | Envio da venda pelo Measurement Protocol do GA4 |

As credenciais do painel ficam em texto no `.env` (como combinado). Elas dão
acesso a todos os dados dos leads — trate o `.env` como segredo, não o comite e
troque a senha se ela vazar.

Gere a chave administrativa com:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Conectando a landing page

No `index.html` da landing page, preencha **um único valor** — `CONFIG.api`, com a
URL da API publicada, sem barra no final:

```js
const CONFIG = {
  // ...
  api: 'https://sua-api.com.br',
  rastrear: true
};
```

Isso já liga as três pontas:

| O quê | Para onde vai |
| --- | --- |
| Envio do formulário | `POST {api}/api/leads` |
| Rastreamento de visitantes | `{api}/track.js`, enviando para `POST {api}/api/track` |
| Painel do corretor | `{api}/admin` |

O `CONFIG.endpoint` continua existindo para quem quiser mandar o lead para outro
destino (Zapier, n8n, CRM): quando preenchido, ele tem prioridade sobre o
`CONFIG.api`.

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

### `POST /api/track` — pública

Coleta da jornada, chamada pelo `track.js`. Aceita `application/json` e
`text/plain` (o `navigator.sendBeacon` usa `text/plain` para não disparar o
preflight do CORS quando o visitante fecha a aba). Responde sempre `202`, mesmo
com payload inválido: rastreamento nunca pode atrapalhar a página.

```json
{
  "visitante_uid": "id do localStorage",
  "sessao_uid": "id do sessionStorage",
  "pagina": "https://site.com.br/?utm_source=google",
  "referrer": "https://google.com/",
  "utm": { "utm_source": "google", "utm_campaign": "imoveis-nh", "gclid": "..." },
  "tempo_ativo_segundos": 95,
  "eventos": [{ "tipo": "pageview", "dados": { "titulo": "Landing" } }]
}
```

Tipos de evento: `pageview`, `scroll`, `clique`, `form_inicio`, `form_envio`,
`whatsapp`, `heartbeat`, `saida`.

### Painel e métricas

Sessão por cookie (login em `POST /api/admin/login`) ou header `x-api-key`.

| Rota | O que faz |
| --- | --- |
| `POST /api/admin/login` | Login com `{ email, senha }`; devolve o cookie de sessão |
| `POST /api/admin/logout` | Encerra a sessão |
| `GET /api/admin/metricas?dias=30` | Visitantes, acessos, conversões, taxa, tempo médio, série diária, funil e os totais de 7/30/90 dias |
| `GET /api/admin/campanhas?dias=30` | Acessos, leads, taxa de conversão, tempo médio e vendas por campanha |
| `GET /api/admin/visitantes?dias=30` | Visitantes com a campanha de origem; filtros `convertido`, `campanha`, `busca` |
| `GET /api/admin/visitantes/:id` | Jornada completa: sessões e eventos, e o lead se converteu |
| `GET /api/leads/tags` | Tags já usadas, com a contagem |
| `PUT /api/leads/:id/tags` | Define as tags (`{ tags: [...], valor_venda }`) |
| `POST /api/leads/:id/venda/reenviar` | Redispara o evento de venda |

### Tags e evento de venda

Marcar a tag **`vendido`** em uma conversão:

1. registra a venda com um `evento_uid` único e move o lead para `convertido`;
2. dispara `Purchase` na **API de Conversões da Meta** (e-mail, telefone e nome
   hasheados em SHA-256 — nunca em texto puro) e `purchase` no **GA4**;
3. guarda o retorno de cada plataforma, que o painel mostra e permite reenviar.

Sem `META_*` / `GA4_*` configurados a venda fica registrada e marcada como
*não configurado* — nada quebra. O `evento_uid` é o mesmo `eventID` do pixel do
navegador, então a Meta deduplica se o evento chegar pelos dois caminhos (o
painel mostra o snippet pronto).

Desmarcar a tag desfaz o registro da venda no banco. O evento já enviado às
plataformas não volta atrás.

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
├── app.js                  # Express: middlewares, CORS, rotas, painel, healthcheck
├── server.js               # Sobe o servidor, roda migrations, encerra limpo
├── config/env.js           # Variáveis de ambiente e validação da configuração
├── db/                     # Pool do PostgreSQL e executor de migrations
├── routes/                 # leads, tracking e admin
├── controllers/            # Entrada HTTP: valida e responde
├── services/               # SQL de leads, rastreamento, métricas e vendas
├── integracoes/            # Meta (API de Conversões) e GA4
├── middlewares/            # Sessão do painel, chave de API, rate limit, erros
├── utils/                  # Identificação de campanha, token de sessão, log
└── validators/             # Schemas (zod) do lead, do tracking e dos filtros
public/
└── track.js                # Script de rastreamento carregado pela landing page
db/migrations/              # Arquivos .sql aplicados em ordem
tests/                      # Testes de integração da API e do painel
```

## Como o rastreamento funciona

- O visitante recebe um id aleatório no `localStorage` e a visita um id no
  `sessionStorage` — **sem cookie, sem dado pessoal**. É só um identificador
  anônimo que permite ligar a jornada à conversão depois.
- A campanha sai da UTM da URL e fica guardada pela sessão inteira. Sem UTM, o
  `gclid` vira `google-ads`, o `fbclid` vira `meta-ads` e, na falta dos dois, o
  referrer classifica em orgânico / social / referência / direto.
- O tempo de permanência conta só com a aba visível, atualizado por heartbeat e
  fechado no `sendBeacon` da saída.
- Quando o formulário é enviado, o lead carrega os dois ids: a conversão passa a
  ter dono e a jornada aparece no painel.

## Deploy

Funciona em qualquer serviço que rode Node: Railway, Render, Fly.io, VPS com Docker.

1. Provisione um PostgreSQL e copie a `DATABASE_URL`
2. Configure as variáveis de ambiente (`DATABASE_SSL=true` em banco gerenciado)
3. Comando de start: `npm start` — as migrations rodam sozinhas no boot
4. Healthcheck: `/health`
5. Preencha o `CONFIG.api` da landing page com a URL pública da API
6. Cadastre `VITE_API_URL` no projeto da Vercel e acesse o painel em `/admin` do site

O painel roda em outro domínio, então o cookie de sessão sai com
`SameSite=None; Secure` em produção — o que exige HTTPS na API e o domínio do
site listado em `CORS_ORIGINS`.
