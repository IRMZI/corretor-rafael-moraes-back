import { createHash } from 'node:crypto';
import { env } from '../config/env.js';

/* A Meta exige os dados do cliente hasheados em SHA-256, minusculos e sem
   espacos. Nunca enviamos e-mail ou telefone em texto puro. */
function hash(valor) {
  if (!valor) return null;
  return createHash('sha256').update(String(valor).trim().toLowerCase()).digest('hex');
}

function telefoneInternacional(numeros) {
  if (!numeros) return null;
  const limpo = String(numeros).replace(/\D/g, '');
  return limpo.startsWith('55') ? limpo : `55${limpo}`;
}

export function configurada() {
  return Boolean(env.metaPixelId && env.metaAccessToken);
}

/* Envia o evento Purchase pela API de Conversoes.
   O event_id e o mesmo do pixel do navegador: a Meta deduplica sozinha
   se o evento chegar pelos dois caminhos. */
export async function enviarVenda({ lead, venda }) {
  if (!configurada()) return { status: 'nao_configurado' };

  const fbclid = lead.utm?.fbclid || null;
  const evento = {
    event_name: 'Purchase',
    event_time: Math.floor(new Date(venda.criada_em || Date.now()).getTime() / 1000),
    event_id: venda.evento_uid,
    action_source: 'system_generated',
    event_source_url: lead.pagina || undefined,
    user_data: {
      em: [hash(lead.email)].filter(Boolean),
      ph: [hash(telefoneInternacional(lead.whatsapp_numeros))].filter(Boolean),
      fn: [hash(lead.nome?.split(' ')[0])].filter(Boolean),
      ...(fbclid ? { fbc: `fb.1.${Date.now()}.${fbclid}` } : {})
    },
    custom_data: {
      currency: venda.moeda || 'BRL',
      value: Number(venda.valor || 0),
      content_name: lead.tipo_imovel || undefined,
      content_category: lead.objetivo || undefined
    }
  };

  const corpo = {
    data: [evento],
    ...(env.metaTestEventCode ? { test_event_code: env.metaTestEventCode } : {})
  };

  const resposta = await fetch(
    `https://graph.facebook.com/v21.0/${env.metaPixelId}/events?access_token=${encodeURIComponent(env.metaAccessToken)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(10_000)
    }
  );

  const retorno = await resposta.json().catch(() => ({}));
  return {
    status: resposta.ok ? 'enviado' : 'falhou',
    http: resposta.status,
    resposta: retorno,
    enviado_em: new Date().toISOString()
  };
}
