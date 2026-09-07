import { Router, json } from 'express';
import rateLimit from 'express-rate-limit';
import { assincrono } from '../middlewares/erros.js';
import * as controller from '../controllers/tracking.controller.js';

/* Limite generoso: um visitante manda varios lotes por sessao (heartbeat,
   scroll, cliques), mas nao centenas por minuto. */
const limitar = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { ok: true, ignorado: true }
});

export const trackingRouter = Router();

/* text/plain porque o navigator.sendBeacon do track.js manda assim para
   evitar o preflight do CORS quando o visitante fecha a aba. */
const corpoJson = json({ type: ['application/json', 'text/plain'], limit: '64kb' });

trackingRouter.post('/', limitar, corpoJson, assincrono(controller.receber));
