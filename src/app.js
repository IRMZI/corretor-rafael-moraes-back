import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { query } from './db/index.js';
import { leadsRouter } from './routes/leads.routes.js';
import { trackingRouter } from './routes/tracking.routes.js';
import { adminRouter } from './routes/admin.routes.js';
import { naoEncontrado, tratarErros, assincrono, ErroHttp } from './middlewares/erros.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publico = path.join(raiz, 'public');

export function criarApp() {
  const app = express();

  /* Necessario para o rate limit e o req.ip funcionarem atras de proxy
     (Railway, Render, Nginx, Cloudflare...). */
  app.set('trust proxy', env.trustProxy);
  app.disable('x-powered-by');

  /* O painel usa CSS/JS proprios inline-free, mas carrega dados por fetch da
     mesma origem: a CSP fica restrita a 'self'. */
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          /* 'unsafe-inline' so no estilo: o painel ajusta largura de barra e
             cor de legenda no atributo style. Script continua restrito. */
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"]
        }
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' }
    })
  );
  app.use(cookieParser());
  app.use(express.json({ limit: '32kb' }));

  const liberarTudo = env.corsOrigins.length === 0 || env.corsOrigins.includes('*');

  /* A checagem precisa do req para reconhecer a propria origem: o painel em
     /admin conversa com esta mesma API e o navegador manda Origin junto. */
  app.use(
    cors((req, callback) => {
      const origem = req.headers.origin;
      const mesmaOrigem = origem === `${req.protocol}://${req.get('host')}`;
      const autorizada = !origem || mesmaOrigem || liberarTudo || env.corsOrigins.includes(origem);

      /* Sem Origin (curl, healthcheck, servidor a servidor) tambem passa:
         a rota publica ja e protegida por rate limit e honeypot. */
      if (!autorizada) return callback(new ErroHttp(403, `Origem nao autorizada pelo CORS: ${origem}`));

      return callback(null, {
        origin: true,
        credentials: mesmaOrigem,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'x-api-key', 'Authorization'],
        maxAge: 86_400
      });
    })
  );

  app.get('/', (_req, res) => {
    res.json({
      ok: true,
      servico: 'API de leads - Corretor Rafael Moraes',
      painel: '/admin',
      rotas: ['POST /api/leads', 'POST /api/track', 'GET /api/admin/metricas', 'GET /api/leads']
    });
  });

  /* Script de rastreamento carregado pela landing page (outro dominio). */
  app.get('/track.js', (_req, res) => {
    res.type('application/javascript');
    res.set('Cache-Control', 'public, max-age=3600');
    res.sendFile(path.join(publico, 'track.js'));
  });

  /* Healthcheck com ping no banco: e o que o provedor de deploy consulta. */
  app.get(
    '/health',
    assincrono(async (_req, res) => {
      try {
        await query('SELECT 1');
        res.json({ ok: true, banco: 'conectado', hora: new Date().toISOString() });
      } catch (erro) {
        res.status(503).json({ ok: false, banco: 'indisponivel', erro: erro.message });
      }
    })
  );

  app.use('/api/leads', leadsRouter);
  app.use('/api/track', trackingRouter);
  app.use('/api/admin', adminRouter);

  /* Painel administrativo: HTML/CSS/JS servidos pela propria API. */
  app.use('/admin', express.static(path.join(publico, 'admin'), { index: 'index.html' }));
  app.get('/admin/*qualquer', (_req, res) => res.sendFile(path.join(publico, 'admin', 'index.html')));

  app.use(naoEncontrado);
  app.use(tratarErros);

  return app;
}
