import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, fecharPool } from './index.js';
import { logger } from '../utils/logger.js';

const diretorioMigrations = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../db/migrations'
);

/* Executa, em ordem alfabetica, os .sql ainda nao aplicados.
   Cada arquivo roda dentro de uma transacao e e registrado em schema_migrations. */
export async function migrar() {
  const cliente = await pool.connect();

  try {
    await cliente.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        nome        TEXT PRIMARY KEY,
        aplicada_em TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const arquivos = (await readdir(diretorioMigrations))
      .filter((nome) => nome.endsWith('.sql'))
      .sort();

    const { rows } = await cliente.query('SELECT nome FROM schema_migrations');
    const aplicadas = new Set(rows.map((linha) => linha.nome));

    let executadas = 0;
    for (const arquivo of arquivos) {
      if (aplicadas.has(arquivo)) continue;

      const sql = await readFile(path.join(diretorioMigrations, arquivo), 'utf8');
      try {
        await cliente.query('BEGIN');
        await cliente.query(sql);
        await cliente.query('INSERT INTO schema_migrations (nome) VALUES ($1)', [arquivo]);
        await cliente.query('COMMIT');
      } catch (erro) {
        await cliente.query('ROLLBACK');
        throw new Error(`Falha na migration ${arquivo}: ${erro.message}`, { cause: erro });
      }

      executadas += 1;
      logger.info(`Migration aplicada: ${arquivo}`);
    }

    if (executadas === 0) logger.info('Banco ja esta atualizado, nenhuma migration pendente.');
    return executadas;
  } finally {
    cliente.release();
  }
}

/* Permite rodar direto: npm run migrate */
const executadoDireto = process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`;
if (executadoDireto) {
  migrar()
    .then(() => fecharPool())
    .catch(async (erro) => {
      logger.error(erro.message);
      await fecharPool().catch(() => {});
      process.exit(1);
    });
}
