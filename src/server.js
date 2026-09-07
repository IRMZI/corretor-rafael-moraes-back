import { criarApp } from './app.js';
import { env, validarConfig, isProducao } from './config/env.js';
import { migrar } from './db/migrate.js';
import { fecharPool } from './db/index.js';
import { logger } from './utils/logger.js';

const problemas = validarConfig();
if (problemas.length) {
  problemas.forEach((problema) => logger.error(`Configuracao: ${problema}`));
  if (isProducao) process.exit(1);
}

if (env.runMigrationsOnStart) {
  try {
    await migrar();
  } catch (erro) {
    logger.error('Nao foi possivel aplicar as migrations', { erro: erro.message });
    process.exit(1);
  }
}

const servidor = criarApp().listen(env.port, () => {
  logger.info(`API de leads no ar na porta ${env.port}`, { ambiente: env.nodeEnv });
});

/* Encerramento limpo: para de aceitar conexoes e devolve o pool do Postgres. */
for (const sinal of ['SIGTERM', 'SIGINT']) {
  process.on(sinal, () => {
    logger.info(`Recebido ${sinal}, encerrando...`);
    servidor.close(async () => {
      await fecharPool().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
