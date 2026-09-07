import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { query } from './db/index.js';
import { leadsRouter } from './routes/leads.routes.js';
import { naoEncontrado, tratarErros, assincrono, ErroHttp } from './middlewares/erros.js';

export function criarApp() {
  const app = express();

  /* Necessario para o rate limit e o req.ip funcionarem atras de proxy
     (Railway, Render, Nginx, Cloudflare...). */
  app.set('trust proxy', env.trustProxy);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(express.json({ limit: '32kb' }));

  const liberarTudo = env.corsOrigins.length === 0 || env.corsOrigins.includes('*');
  app.use(
    cors({
      origin: liberarTudo
        ? true
        : (origem, callback) => {
            /* Sem Origin (curl, healthcheck, app mobile) tambem passa:
               a rota publica ja e protegida por rate limit e honeypot. */
            if (!origem || env.corsOrigins.includes(origem)) return callback(null, true);
            return callback(new ErroHttp(403, `Origem nao autorizada pelo CORS: ${origem}`));
          },
      methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'x-api-key', 'Authorization'],
      maxAge: 86_400
    })
  );

  app.get('/', (_req, res) => {
    res.json({
      ok: true,
      servico: 'API de leads - Corretor Rafael Moraes',
      documentacao: 'README.md',
      rotas: ['POST /api/leads', 'GET /api/leads', 'GET /api/leads/resumo', 'GET /api/leads/:id', 'PATCH /api/leads/:id']
    });
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

  app.use(naoEncontrado);
  app.use(tratarErros);

  return app;
}
