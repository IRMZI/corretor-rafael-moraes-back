import { z } from 'zod';

export const TIPOS_EVENTO = [
  'pageview',
  'scroll',
  'clique',
  'form_inicio',
  'form_envio',
  'whatsapp',
  'heartbeat',
  'saida'
];

const uid = z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/, 'Identificador invalido.');

const evento = z.object({
  tipo: z.enum(TIPOS_EVENTO).catch('pageview'),
  pagina: z.string().trim().max(500).nullable().optional().catch(null),
  dados: z.record(z.string().max(60), z.unknown()).default({}).catch({}),
  ocorrido_em: z.string().datetime().nullable().optional().catch(null)
});

/* O track.js manda os eventos em lote (batch), inclusive no sendBeacon de saida. */
export const trackSchema = z.object({
  visitante_uid: uid,
  sessao_uid: uid,
  pagina: z.string().trim().max(500).nullable().optional().catch(null),
  referrer: z.string().trim().max(500).nullable().optional().catch(null),
  utm: z.record(z.string().max(80), z.string().max(300)).default({}).catch({}),
  tempo_ativo_segundos: z.coerce.number().int().min(0).max(86_400).default(0).catch(0),
  eventos: z.array(evento).max(50).default([])
});
