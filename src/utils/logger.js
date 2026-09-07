import { isProducao } from '../config/env.js';

/* Logger minimo: JSON em producao (facil de ler no Railway/Render/Docker),
   texto legivel em desenvolvimento. */
function escrever(nivel, mensagem, extra) {
  const registro = { nivel, mensagem, hora: new Date().toISOString(), ...extra };

  if (isProducao) {
    console[nivel === 'error' ? 'error' : 'log'](JSON.stringify(registro));
    return;
  }

  const detalhe = extra && Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : '';
  console[nivel === 'error' ? 'error' : 'log'](`[${nivel}] ${mensagem}${detalhe}`);
}

export const logger = {
  info: (mensagem, extra) => escrever('info', mensagem, extra),
  warn: (mensagem, extra) => escrever('warn', mensagem, extra),
  error: (mensagem, extra) => escrever('error', mensagem, extra)
};
