import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env, isProducao } from '../config/env.js';

export const COOKIE_SESSAO = 'painel_sessao';

/* Sem SESSION_SECRET definido geramos um em memoria: o painel funciona em
   desenvolvimento e as sessoes simplesmente caem quando o processo reinicia.
   Em producao o server.js exige a variavel. */
const segredo = env.sessionSecret || randomBytes(32).toString('hex');

function assinar(dados) {
  return createHmac('sha256', segredo).update(dados).digest('base64url');
}

export function criarToken(email) {
  const expiraEm = Date.now() + env.sessionHours * 60 * 60 * 1000;
  const dados = Buffer.from(JSON.stringify({ email, expiraEm })).toString('base64url');
  return `${dados}.${assinar(dados)}`;
}

/* Devolve o payload quando o token e autentico e ainda valido; senao null. */
export function lerToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;

  const [dados, assinatura] = token.split('.');
  if (!dados || !assinatura) return null;

  const esperada = Buffer.from(assinar(dados));
  const recebida = Buffer.from(assinatura);
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) return null;

  try {
    const payload = JSON.parse(Buffer.from(dados, 'base64url').toString('utf8'));
    if (!payload?.expiraEm || payload.expiraEm < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export const opcoesCookie = {
  httpOnly: true,
  sameSite: 'lax',
  secure: isProducao,
  path: '/',
  maxAge: env.sessionHours * 60 * 60 * 1000
};
