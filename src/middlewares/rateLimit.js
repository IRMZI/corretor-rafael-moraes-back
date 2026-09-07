import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

/* Limite por IP no envio de leads: segura robo e envio repetido em massa
   sem atrapalhar quem preenche o formulario uma vez. */
export const limitarEnvioLead = rateLimit({
  windowMs: env.rateLimitWindowMinutes * 60 * 1000,
  limit: env.rateLimitMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    ok: false,
    erro: 'Muitas tentativas de envio. Aguarde alguns minutos e tente novamente.'
  }
});
