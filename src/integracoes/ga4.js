import { env } from '../config/env.js';

export function configurada() {
  return Boolean(env.ga4MeasurementId && env.ga4ApiSecret);
}

/* Measurement Protocol do GA4: registra a venda no mesmo relatorio das
   conversoes do site, usando o id do visitante como client_id quando existe. */
export async function enviarVenda({ lead, venda, clientId }) {
  if (!configurada()) return { status: 'nao_configurado' };

  const corpo = {
    client_id: clientId || `lead.${lead.id}`,
    non_personalized_ads: false,
    events: [
      {
        name: 'purchase',
        params: {
          transaction_id: venda.evento_uid,
          value: Number(venda.valor || 0),
          currency: venda.moeda || 'BRL',
          campanha: lead.campanha || undefined,
          origem: lead.origem_trafego || undefined,
          midia: lead.midia || undefined
        }
      }
    ]
  };

  const resposta = await fetch(
    `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(env.ga4MeasurementId)}&api_secret=${encodeURIComponent(env.ga4ApiSecret)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(10_000)
    }
  );

  /* O GA4 responde 204 sem corpo quando aceita o evento. */
  return {
    status: resposta.ok ? 'enviado' : 'falhou',
    http: resposta.status,
    enviado_em: new Date().toISOString()
  };
}
