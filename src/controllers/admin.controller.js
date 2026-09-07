import { z } from 'zod';
import * as metricas from '../services/metricas.service.js';
import { ErroHttp } from '../middlewares/erros.js';
import { configurada as metaConfigurada } from '../integracoes/meta.js';
import { configurada as ga4Configurada } from '../integracoes/ga4.js';

/* Periodos oferecidos no painel. Qualquer outro valor cai em 30 dias. */
const periodoSchema = z.object({
  dias: z.coerce.number().int().refine((valor) => [7, 30, 90, 180, 365].includes(valor)).default(30).catch(30)
});

const visitantesSchema = periodoSchema.extend({
  pagina: z.coerce.number().int().min(1).default(1).catch(1),
  por_pagina: z.coerce.number().int().min(1).max(100).default(25).catch(25),
  convertido: z
    .enum(['true', 'false'])
    .transform((valor) => valor === 'true')
    .optional(),
  campanha: z.string().trim().max(120).optional(),
  busca: z.string().trim().max(120).optional()
});

export async function visaoGeral(req, res) {
  const { dias } = periodoSchema.parse(req.query);
  const [resumo, janelas] = await Promise.all([metricas.visaoGeral(dias), metricas.acessosPorJanela()]);

  return res.json({
    ok: true,
    metricas: resumo,
    janelas,
    integracoes: { meta: metaConfigurada(), ga4: ga4Configurada() }
  });
}

export async function campanhas(req, res) {
  const { dias } = periodoSchema.parse(req.query);
  return res.json({ ok: true, periodo_dias: dias, campanhas: await metricas.porCampanha(dias) });
}

export async function visitantes(req, res) {
  const filtros = visitantesSchema.parse(req.query);
  const { visitantes: lista, paginacao } = await metricas.listarVisitantes(filtros);
  return res.json({ ok: true, ...paginacao, visitantes: lista });
}

export async function jornada(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) throw new ErroHttp(400, 'Id invalido.');

  const jornadaVisitante = await metricas.jornadaDoVisitante(id);
  if (!jornadaVisitante) throw new ErroHttp(404, 'Visitante nao encontrado.');

  return res.json({ ok: true, ...jornadaVisitante });
}
