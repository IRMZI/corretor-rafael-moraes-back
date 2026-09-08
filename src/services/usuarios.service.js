import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { query } from '../db/index.js';

const scrypt = promisify(scryptCallback);

/* Parametros do scrypt. N=16384 leva alguns milissegundos por tentativa: caro o
   suficiente para forca bruta, barato o suficiente para um login. Ficam gravados
   no proprio hash, entao aumentar aqui nao invalida as senhas ja cadastradas. */
const CUSTO = { N: 16384, r: 8, p: 1, tamanho: 32 };

/* Hash de uma senha que nao existe. Serve para gastar o mesmo tempo quando o
   e-mail nao esta cadastrado - sem isso, a resposta rapida entrega quais
   e-mails existem. */
const HASH_INEXISTENTE = 'scrypt$16384$8$1$c2FsZ2FkbzE$bmFvLWNvbmZlcmUtbnVuY2E';

export async function gerarHash(senha) {
  const salt = randomBytes(16);
  const derivada = await scrypt(senha.normalize('NFKC'), salt, CUSTO.tamanho, {
    N: CUSTO.N,
    r: CUSTO.r,
    p: CUSTO.p
  });
  return [
    'scrypt',
    CUSTO.N,
    CUSTO.r,
    CUSTO.p,
    salt.toString('base64url'),
    derivada.toString('base64url')
  ].join('$');
}

/* Devolve true so quando a senha corresponde ao hash. Hash malformado ou de
   algoritmo desconhecido devolve false em vez de estourar: um registro
   corrompido no banco nao pode virar erro 500 na tela de login. */
export async function conferirSenha(senha, hash) {
  const partes = String(hash || '').split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;

  const [, N, r, p, salt, esperada] = partes;
  let derivada;
  try {
    derivada = await scrypt(String(senha).normalize('NFKC'), Buffer.from(salt, 'base64url'), CUSTO.tamanho, {
      N: Number(N),
      r: Number(r),
      p: Number(p)
    });
  } catch {
    return false;
  }

  const alvo = Buffer.from(esperada, 'base64url');
  if (alvo.length !== derivada.length) return false;
  return timingSafeEqual(alvo, derivada);
}

/* Gasta o tempo de uma verificacao real sem ter usuario para comparar. */
export function gastarTempoDeSenha(senha) {
  return conferirSenha(senha, HASH_INEXISTENTE);
}

export function normalizarEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/* A tabela so existe depois da migration 003. Enquanto ela nao rodou, tratamos
   como "nenhuma conta cadastrada" para o painel continuar aceitando o login por
   ADMIN_EMAIL/ADMIN_PASSWORD em vez de devolver erro 500. */
const TABELA_INEXISTENTE = '42P01';

async function consultar(texto, parametros) {
  try {
    return await query(texto, parametros);
  } catch (erro) {
    if (erro?.code === TABELA_INEXISTENTE) return null;
    throw erro;
  }
}

export async function buscarPorEmail(email) {
  const resultado = await consultar(
    'SELECT id, email, nome, senha_hash, ativo FROM usuarios WHERE email = $1',
    [normalizarEmail(email)]
  );
  return resultado?.rows[0] || null;
}

export async function existeAlgumaConta() {
  const resultado = await consultar('SELECT 1 FROM usuarios LIMIT 1');
  return Boolean(resultado?.rowCount);
}

export async function registrarAcesso(id) {
  await consultar('UPDATE usuarios SET ultimo_acesso_em = now() WHERE id = $1', [id]);
}

/* Cadastra ou atualiza a senha de quem ja existe: o mesmo comando serve para
   criar a conta e para trocar a senha de alguem que esqueceu. */
export async function salvarUsuario({ email, nome, senha }) {
  const hash = await gerarHash(senha);
  const { rows } = await query(
    `INSERT INTO usuarios (email, nome, senha_hash)
          VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE
            SET nome          = COALESCE(EXCLUDED.nome, usuarios.nome),
                senha_hash    = EXCLUDED.senha_hash,
                ativo         = TRUE,
                atualizado_em = now()
       RETURNING id, email, nome, ativo, criado_em, atualizado_em`,
    [normalizarEmail(email), nome?.trim() || null, hash]
  );
  return rows[0];
}

export async function listarUsuarios() {
  const { rows } = await query(
    `SELECT id, email, nome, ativo, criado_em, ultimo_acesso_em
       FROM usuarios
   ORDER BY ativo DESC, email`
  );
  return rows;
}

/* Desativar em vez de apagar: o acesso cai na hora e o historico de quem era
   dono da conta continua de pe. */
export async function definirAtivo(email, ativo) {
  const { rows } = await query(
    `UPDATE usuarios
        SET ativo = $2, atualizado_em = now()
      WHERE email = $1
  RETURNING id, email, nome, ativo`,
    [normalizarEmail(email), Boolean(ativo)]
  );
  return rows[0] || null;
}
