import { timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { ErroHttp } from './erros.js';

function iguais(a, b) {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/* Protege as rotas de consulta dos leads (header x-api-key ou Authorization: Bearer). */
export function exigirApiKey(req, _res, next) {
  if (!env.adminApiKey) {
    return next(new ErroHttp(503, 'ADMIN_API_KEY nao configurada: rotas administrativas indisponiveis.'));
  }

  const cabecalho = req.get('authorization') || '';
  const chave = req.get('x-api-key') || (cabecalho.startsWith('Bearer ') ? cabecalho.slice(7) : '');

  if (!chave || !iguais(chave, env.adminApiKey)) {
    return next(new ErroHttp(401, 'Chave de acesso invalida.'));
  }
  return next();
}
