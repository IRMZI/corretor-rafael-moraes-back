import { randomUUID } from 'node:crypto';
import { query, pool } from '../db/index.js';
import { logger } from '../utils/logger.js';
import * as meta from '../integracoes/meta.js';
import * as ga4 from '../integracoes/ga4.js';

export const TAG_VENDIDO = 'vendido';

/* Marcar a tag "vendido" e o gatilho da venda: cria o registro (com um
   evento_uid unico, usado para deduplicar nas plataformas) e dispara os
   eventos de conversao. O disparo nunca derruba a marcacao - se a Meta ou o
   GA4 falharem, a venda fica gravada e o painel permite reenviar. */
export async function registrarVenda(leadId, { valor = null, moeda = 'BRL' } = {}) {
  const cliente = await pool.connect();

  try {
    await cliente.query('BEGIN');

    const { rows: leadRows } = await cliente.query('SELECT * FROM leads WHERE id = $1 FOR UPDATE', [leadId]);
    const lead = leadRows[0];
    if (!lead) {
      await cliente.query('ROLLBACK');
      return null;
    }

    const { rows: existente } = await cliente.query(
      'SELECT * FROM vendas WHERE lead_id = $1 ORDER BY criada_em DESC LIMIT 1',
      [leadId]
    );

    /* Ja vendido: nao cria outra venda, so atualiza o valor se veio um novo. */
    if (existente.length) {
      if (valor !== null) {
        await cliente.query('UPDATE vendas SET valor = $2 WHERE id = $1', [existente[0].id, valor]);
        await cliente.query('UPDATE leads SET valor_venda = $2 WHERE id = $1', [leadId, valor]);
      }
      await cliente.query('COMMIT');
      return { lead, venda: { ...existente[0], valor: valor ?? existente[0].valor }, jaExistia: true };
    }

    const { rows: vendaRows } = await cliente.query(
      `INSERT INTO vendas (lead_id, evento_uid, valor, moeda)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [leadId, randomUUID(), valor, moeda]
    );

    await cliente.query(
      `UPDATE leads
          SET vendido_em = COALESCE(vendido_em, now()),
              valor_venda = COALESCE($2, valor_venda),
              status = 'convertido'
        WHERE id = $1`,
      [leadId, valor]
    );

    await cliente.query('COMMIT');
    return { lead, venda: vendaRows[0], jaExistia: false };
  } catch (erro) {
    await cliente.query('ROLLBACK');
    throw erro;
  } finally {
    cliente.release();
  }
}

/* Dispara (ou redispara) o evento de venda nas plataformas configuradas. */
export async function dispararEventoVenda(lead, venda) {
  const clientId = lead.visitante_id
    ? (await query('SELECT visitante_uid FROM visitantes WHERE id = $1', [lead.visitante_id])).rows[0]?.visitante_uid
    : null;

  const [resultadoMeta, resultadoGa4] = await Promise.all([
    meta.enviarVenda({ lead, venda }).catch((erro) => ({ status: 'falhou', erro: erro.message })),
    ga4.enviarVenda({ lead, venda, clientId }).catch((erro) => ({ status: 'falhou', erro: erro.message }))
  ]);

  const integracoes = { meta: resultadoMeta, ga4: resultadoGa4 };

  await query('UPDATE vendas SET integracoes = $2::jsonb WHERE id = $1', [venda.id, JSON.stringify(integracoes)]);

  logger.info('Evento de venda processado', {
    lead: lead.id,
    venda: venda.id,
    meta: resultadoMeta.status,
    ga4: resultadoGa4.status
  });

  return integracoes;
}

/* Desfaz a marcacao de venda (tag removida no painel). O evento ja enviado
   as plataformas nao volta atras - por isso guardamos o historico. */
export async function desfazerVenda(leadId) {
  await query(
    `UPDATE leads SET vendido_em = NULL, valor_venda = NULL, status = 'qualificado' WHERE id = $1`,
    [leadId]
  );
  await query('DELETE FROM vendas WHERE lead_id = $1', [leadId]);
}

export async function buscarVendaDoLead(leadId) {
  const { rows } = await query('SELECT * FROM vendas WHERE lead_id = $1 ORDER BY criada_em DESC LIMIT 1', [leadId]);
  return rows[0] || null;
}

/* Snippet do pixel de venda para colar em uma pagina de obrigado, caso o
   corretor prefira disparar tambem pelo navegador. O event_id e o mesmo da
   API de Conversoes, entao a Meta conta a venda uma vez so. */
export function snippetPixelVenda(lead, venda) {
  return [
    "<!-- Pixel de venda - Meta -->",
    "<script>",
    `  fbq('track', 'Purchase', { value: ${Number(venda.valor || 0)}, currency: '${venda.moeda || 'BRL'}' },`,
    `        { eventID: '${venda.evento_uid}' });`,
    "</script>"
  ].join('\n');
}
