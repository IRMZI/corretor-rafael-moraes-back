import { Router } from 'express';
import { exigirApiKey } from '../middlewares/auth.js';
import { limitarEnvioLead } from '../middlewares/rateLimit.js';
import { assincrono } from '../middlewares/erros.js';
import * as controller from '../controllers/leads.controller.js';

export const leadsRouter = Router();

/* Publica: e a rota que a landing page chama (CONFIG.endpoint). */
leadsRouter.post('/', limitarEnvioLead, assincrono(controller.receberLead));

/* Administrativas: exigem o header x-api-key. */
leadsRouter.get('/', exigirApiKey, assincrono(controller.listar));
leadsRouter.get('/resumo', exigirApiKey, assincrono(controller.resumo));
leadsRouter.get('/:id', exigirApiKey, assincrono(controller.detalhar));
leadsRouter.patch('/:id', exigirApiKey, assincrono(controller.atualizar));
