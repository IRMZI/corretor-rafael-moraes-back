import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { assincrono } from '../middlewares/erros.js';
import { exigirAdmin } from '../middlewares/sessaoAdmin.js';
import * as auth from '../controllers/auth.controller.js';
import * as admin from '../controllers/admin.controller.js';

/* Login e o alvo obvio de forca bruta: poucas tentativas por IP. */
const limitarLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { ok: false, erro: 'Muitas tentativas de login. Tente de novo em alguns minutos.' }
});

export const adminRouter = Router();

adminRouter.post('/login', limitarLogin, assincrono(auth.entrar));
adminRouter.post('/logout', assincrono(auth.sair));

adminRouter.use(exigirAdmin);

adminRouter.get('/eu', assincrono(auth.eu));
adminRouter.get('/metricas', assincrono(admin.visaoGeral));
adminRouter.get('/campanhas', assincrono(admin.campanhas));
adminRouter.get('/visitantes', assincrono(admin.visitantes));
adminRouter.get('/visitantes/:id', assincrono(admin.jornada));
