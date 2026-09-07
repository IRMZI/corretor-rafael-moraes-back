import { Router } from 'express';
import { exigirAdmin } from '../middlewares/sessaoAdmin.js';
import { limitarEnvioLead } from '../middlewares/rateLimit.js';
import { assincrono } from '../middlewares/erros.js';
import * as controller from '../controllers/leads.controller.js';

export const leadsRouter = Router();

/* Publica: e a rota que a landing page chama (CONFIG.endpoint). */
leadsRouter.post('/', limitarEnvioLead, assincrono(controller.receberLead));

/* Administrativas: sessao do painel (cookie) ou header x-api-key. */
leadsRouter.use(exigirAdmin);

leadsRouter.get('/', assincrono(controller.listar));
leadsRouter.get('/resumo', assincrono(controller.resumo));
leadsRouter.get('/tags', assincrono(controller.listarTags));
leadsRouter.get('/:id', assincrono(controller.detalhar));
leadsRouter.patch('/:id', assincrono(controller.atualizar));
leadsRouter.put('/:id/tags', assincrono(controller.salvarTags));
leadsRouter.post('/:id/venda/reenviar', assincrono(controller.reenviarVenda));
