import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { env } from '../config/env.js';
import { ErroHttp } from '../middlewares/erros.js';
import { criarToken, COOKIE_SESSAO, opcoesCookie } from '../utils/sessaoToken.js';
import { logger } from '../utils/logger.js';

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

export async function entrar(req, res) {
  const resultado = loginSchema.safeParse(req.body ?? {});
  if (!resultado.success) throw new ErroHttp(422, 'Informe e-mail e senha.');

  if (!env.adminEmail || !env.adminPassword) {
    throw new ErroHttp(503, 'Painel sem credenciais configuradas (ADMIN_EMAIL / ADMIN_PASSWORD).');
  }

  const email = resultado.data.email.toLowerCase();
  const emailOk = confere(email, env.adminEmail);
  const senhaOk = confere(resultado.data.senha, env.adminPassword);

  if (!emailOk || !senhaOk) {
    logger.warn('Tentativa de login recusada no painel', { ip: req.ip });
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
  return res.json({ ok: true, usuario: { email: req.admin.email } });
}
