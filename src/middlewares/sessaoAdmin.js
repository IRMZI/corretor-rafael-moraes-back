import { env } from '../config/env.js';
import { ErroHttp } from './erros.js';
import { COOKIE_SESSAO, lerToken } from '../utils/sessaoToken.js';
import { exigirApiKey } from './auth.js';
import * as usuarios from '../services/usuarios.service.js';

/* Acesso administrativo por dois caminhos:
   - cookie de sessao, usado pelo painel /admin;
   - header x-api-key, usado por integracoes (CRM, planilha, script). */
export function exigirAdmin(req, res, next) {
  const sessao = lerToken(req.cookies?.[COOKIE_SESSAO]);

  if (sessao) {
    /* O cookie e assinado e vale ate 12h, entao a conta e reconferida a cada
       requisicao: desativar alguem tira o acesso na hora, sem esperar a sessao
       expirar. E uma consulta por e-mail, com indice. */
    conferirSessao(sessao, req).then(
      (admin) => {
        req.admin = admin;
        next();
      },
      (erro) => next(erro)
    );
    return;
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

async function conferirSessao(sessao, _req) {
  const usuario = await usuarios.buscarPorEmail(sessao.email);

  if (usuario) {
    if (!usuario.ativo) throw new ErroHttp(401, 'Acesso revogado. Fale com o responsavel pelo painel.');
    return { email: usuario.email, nome: usuario.nome, via: 'painel' };
  }

  /* Sessao aberta pela credencial do ambiente. Vale so enquanto nao existir
     nenhuma conta: cadastrada a primeira, essa porta fecha. */
  if (await usuarios.existeAlgumaConta()) {
    throw new ErroHttp(401, 'Sessao invalida. Entre com a sua conta do painel.');
  }
  return { email: sessao.email, via: 'painel' };
}
