import 'dotenv/config';

function bool(valor, padrao = false) {
  if (valor === undefined || valor === '') return padrao;
  return ['1', 'true', 'yes', 'on'].includes(String(valor).toLowerCase());
}

function int(valor, padrao) {
  const n = Number.parseInt(valor, 10);
  return Number.isFinite(n) ? n : padrao;
}

function lista(valor) {
  return String(valor || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 3000),
  trustProxy: int(process.env.TRUST_PROXY, 1),

  databaseUrl: process.env.DATABASE_URL || '',
  databaseSsl: bool(process.env.DATABASE_SSL, false),
  runMigrationsOnStart: bool(process.env.RUN_MIGRATIONS_ON_START, true),

  corsOrigins: lista(process.env.CORS_ORIGINS),
  adminApiKey: process.env.ADMIN_API_KEY || '',

  rateLimitWindowMinutes: int(process.env.RATE_LIMIT_WINDOW_MINUTES, 10),
  rateLimitMax: int(process.env.RATE_LIMIT_MAX, 20),
  dedupeWindowMinutes: int(process.env.DEDUPE_WINDOW_MINUTES, 10),

  /* Painel administrativo (/admin) */
  adminEmail: (process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
  adminPassword: process.env.ADMIN_PASSWORD || '',
  sessionSecret: process.env.SESSION_SECRET || '',
  sessionHours: int(process.env.SESSION_HOURS, 12),

  /* Envio do evento de venda para as plataformas de anuncio */
  metaPixelId: process.env.META_PIXEL_ID || '',
  metaAccessToken: process.env.META_ACCESS_TOKEN || '',
  metaTestEventCode: process.env.META_TEST_EVENT_CODE || '',
  ga4MeasurementId: process.env.GA4_MEASUREMENT_ID || '',
  ga4ApiSecret: process.env.GA4_API_SECRET || ''
};

export const isProducao = env.nodeEnv === 'production';

/* Falhas de configuracao que so fazem sentido barrar em producao:
   em desenvolvimento o servidor sobe e apenas avisa. */
export function validarConfig() {
  const erros = [];

  if (!env.databaseUrl && !process.env.PGHOST && !process.env.PGDATABASE) {
    erros.push('Defina DATABASE_URL (ou as variaveis PGHOST/PGDATABASE) para conectar no PostgreSQL.');
  }
  if (isProducao && !env.adminApiKey) {
    erros.push('Defina ADMIN_API_KEY para proteger as rotas de consulta de leads.');
  }
  if (isProducao && env.corsOrigins.length === 0) {
    erros.push('Defina CORS_ORIGINS com o dominio da landing page.');
  }
  if (isProducao && env.corsOrigins.includes('*')) {
    erros.push('CORS_ORIGINS com "*" nao e permitido em producao.');
  }
  if (!env.adminEmail || !env.adminPassword) {
    erros.push('Defina ADMIN_EMAIL e ADMIN_PASSWORD para liberar o login do painel /admin.');
  }
  if (isProducao && !env.sessionSecret) {
    erros.push('Defina SESSION_SECRET para assinar o cookie de sessao do painel.');
  }
  return erros;
}
