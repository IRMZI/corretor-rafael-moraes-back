import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { env } from '../config/env.js';
import { ErroHttp } from '../middlewares/erros.js';
import { criarToken, COOKIE_SESSAO, opcoesCookie } from '../utils/sessaoToken.js';
import { logger } from '../utils/logger.js';
import * as usuarios from '../services/usuarios.service.js';

const loginSchema = z.object({
  email: z.string().trim().max(160),
  senha: z.string().max(200)
});

/* Comparacao de tamanho constante para os dois campos: sem ela, o tempo de
   resposta entrega se o e-mail existe. */
function confere(recebido, esperado) {
  const a = Buffer.from(String(recebido));
  const b = Buffer.from(String(esperado));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/* Credencial unica do ambiente. Continua valendo enquanto a tabela usuarios
   estiver vazia - e o que evita ficar sem acesso ao painel entre subir a
   migration e cadastrar a primeira conta. Assim que existe uma conta, so o
   banco manda: apagar ADMIN_PASSWORD do ambiente depois disso e o esperado. */
function conferirCredencialDoAmbiente(email, senha) {
  if (!env.adminEmail || !env.adminPassword) return false;
  const emailOk = confere(email, env.adminEmail);
  const senhaOk = confere(senha, env.adminPassword);
  return emailOk && senhaOk;
}

export async function entrar(req, res) {
  const resultado = loginSchema.safeParse(req.body ?? {});
  if (!resultado.success) throw new ErroHttp(422, 'Informe e-mail e senha.');

  const email = usuarios.normalizarEmail(resultado.data.email);
  const senha = resultado.data.senha;

  const usuario = await usuarios.buscarPorEmail(email);

  if (usuario) {
    const senhaOk = await usuarios.conferirSenha(senha, usuario.senha_hash);
    if (!senhaOk || !usuario.ativo) {
      logger.warn('Tentativa de login recusada no painel', {
        ip: req.ip,
        motivo: senhaOk ? 'conta desativada' : 'senha invalida'
      });
      throw new ErroHttp(401, 'E-mail ou senha invalidos.');
    }

    await usuarios.registrarAcesso(usuario.id);
    res.cookie(COOKIE_SESSAO, criarToken(usuario.email), opcoesCookie);
    return res.json({ ok: true, usuario: { email: usuario.email, nome: usuario.nome } });
  }

  /* Sem conta com esse e-mail: gasta o mesmo tempo de uma verificacao real
     antes de responder, para o tempo nao denunciar quais e-mails existem. */
  await usuarios.gastarTempoDeSenha(senha);

  if (await usuarios.existeAlgumaConta()) {
    logger.warn('Tentativa de login recusada no painel', { ip: req.ip, motivo: 'e-mail sem conta' });
    throw new ErroHttp(401, 'E-mail ou senha invalidos.');
  }

  if (!env.adminEmail || !env.adminPassword) {
    throw new ErroHttp(
      503,
      'Painel sem contas cadastradas. Rode "npm run usuario:criar" ou defina ADMIN_EMAIL / ADMIN_PASSWORD.'
    );
  }

  if (!conferirCredencialDoAmbiente(email, senha)) {
    logger.warn('Tentativa de login recusada no painel', { ip: req.ip, motivo: 'credencial do ambiente' });
    throw new ErroHttp(401, 'E-mail ou senha invalidos.');
  }

  res.cookie(COOKIE_SESSAO, criarToken(email), opcoesCookie);
  return res.json({ ok: true, usuario: { email } });
}

export async function sair(_req, res) {
  res.clearCookie(COOKIE_SESSAO, { ...opcoesCookie, maxAge: undefined });
  return res.json({ ok: true });
}

export async function eu(req, res) {
  return res.json({ ok: true, usuario: { email: req.admin.email, nome: req.admin.nome ?? null } });
}
