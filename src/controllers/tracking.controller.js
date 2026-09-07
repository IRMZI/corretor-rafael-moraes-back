import { trackSchema } from '../validators/track.schema.js';
import { registrarEventos } from '../services/tracking.service.js';
import { logger } from '../utils/logger.js';

/* Coleta de jornada. Nunca devolve erro 5xx para o navegador: se algo falhar
   aqui, o problema e nosso e nao pode aparecer para o visitante nem travar
   o beacon de saida da pagina. */
export async function receber(req, res) {
  const resultado = trackSchema.safeParse(req.body ?? {});
  if (!resultado.success) {
    return res.status(202).json({ ok: true, ignorado: true });
  }

  try {
    const registro = await registrarEventos(resultado.data, {
      ip: req.ip,
      userAgent: req.get('user-agent')?.slice(0, 500) || null
    });
    return res.status(202).json({ ok: true, eventos: registro.eventosGravados });
  } catch (erro) {
    logger.error('Falha ao registrar eventos de tracking', { erro: erro.message });
    return res.status(202).json({ ok: true, ignorado: true });
  }
}
