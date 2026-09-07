import { logger } from '../utils/logger.js';
import { isProducao } from '../config/env.js';

export class ErroHttp extends Error {
  constructor(status, mensagem, detalhes) {
    super(mensagem);
    this.status = status;
    this.detalhes = detalhes;
  }
}

export function naoEncontrado(req, res) {
  res.status(404).json({ ok: false, erro: `Rota nao encontrada: ${req.method} ${req.originalUrl}` });
}

/* Handler final: nada de stack trace vazando para o cliente. */
export function tratarErros(erro, req, res, _next) {
  const status = erro.status || 500;

  if (status >= 500) {
    logger.error('Erro nao tratado', { rota: `${req.method} ${req.originalUrl}`, erro: erro.message, stack: erro.stack });
  }

  res.status(status).json({
    ok: false,
    erro: status >= 500 && isProducao ? 'Erro interno no servidor.' : erro.message,
    ...(erro.detalhes ? { detalhes: erro.detalhes } : {})
  });
}

/* Evita try/catch repetido em todo controller async. */
export const assincrono = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
