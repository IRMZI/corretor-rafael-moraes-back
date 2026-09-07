import { env } from '../config/env.js';
import { ErroHttp } from './erros.js';
import { COOKIE_SESSAO, lerToken } from '../utils/sessaoToken.js';
import { exigirApiKey } from './auth.js';

/* Acesso administrativo por dois caminhos:
   - cookie de sessao, usado pelo painel /admin;
   - header x-api-key, usado por integracoes (CRM, planilha, script). */
export function exigirAdmin(req, res, next) {
  const sessao = lerToken(req.cookies?.[COOKIE_SESSAO]);
  if (sessao) {
    req.admin = { email: sessao.email, via: 'painel' };
    return next();
  }

  if (req.get('x-api-key') || req.get('authorization')) {
    return exigirApiKey(req, res, (erro) => {
      if (erro) return next(erro);
      req.admin = { email: 'api-key', via: 'api-key' };
      return next();
    });
  }

  if (!env.adminEmail && !env.adminApiKey) {
    return next(new ErroHttp(503, 'Nenhuma credencial administrativa configurada.'));
  }
  return next(new ErroHttp(401, 'Sessao expirada ou inexistente. Faca login novamente.'));
}
