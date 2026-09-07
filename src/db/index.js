import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const { Pool, types } = pg;

/* Por padrao o driver devolve BIGINT (int8) como string para nao perder
   precisao. O id dos leads cabe folgado em Number, entao convertemos para
   o JSON da API sair com numero em vez de "1". */
types.setTypeParser(types.builtins.INT8, (valor) => Number.parseInt(valor, 10));

/* Sem connectionString o pg cai nas variaveis PGHOST/PGUSER/PGDATABASE... */
export const pool = new Pool({
  ...(env.databaseUrl ? { connectionString: env.databaseUrl } : {}),
  ssl: env.databaseSsl ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000
});

pool.on('error', (erro) => {
  logger.error('Erro inesperado no pool do PostgreSQL', { erro: erro.message });
});

export function query(texto, parametros) {
  return pool.query(texto, parametros);
}

export async function fecharPool() {
  await pool.end();
}
