/* Traduz os parametros de campanha em algo legivel no painel.
   A ordem importa: utm explicito ganha de gclid/fbclid, que ganham do referrer. */

const BUSCADORES = ['google.', 'bing.', 'yahoo.', 'duckduckgo.', 'ecosia.'];
const REDES = ['facebook.', 'instagram.', 'l.instagram.', 'lm.facebook.', 'linkedin.', 't.co', 'tiktok.', 'youtube.'];

function dominio(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/* Recebe o objeto utm cru vindo do navegador (utm_source, gclid, fbclid...)
   e devolve campanha / origem / midia / campanha_id ja normalizados. */
export function identificarCampanha(utm = {}, referrer = null) {
  const valor = (chave) => {
    const bruto = utm[chave];
    return typeof bruto === 'string' && bruto.trim() ? bruto.trim().toLowerCase() : null;
  };

  const campanha = valor('utm_campaign');
  const origem = valor('utm_source');
  const midia = valor('utm_medium');
  const gclid = valor('gclid');
  const fbclid = valor('fbclid');

  /* campanha_id: o identificador que permite casar o lead com o anuncio
     la na plataforma (utm_id, gclid, fbclid ou o proprio utm_content). */
  const campanhaId = valor('utm_id') || gclid || fbclid || valor('utm_content') || null;

  if (campanha || origem || midia) {
    return {
      campanha: campanha || origem || 'sem-nome',
      origem: origem || 'desconhecida',
      midia: midia || 'desconhecida',
      campanha_id: campanhaId
    };
  }

  if (gclid) return { campanha: 'google-ads', origem: 'google', midia: 'cpc', campanha_id: gclid };
  if (fbclid) return { campanha: 'meta-ads', origem: 'meta', midia: 'cpc', campanha_id: fbclid };

  const host = dominio(referrer || '');
  if (!host) return { campanha: 'direto', origem: 'direto', midia: 'nenhuma', campanha_id: null };
  if (BUSCADORES.some((busca) => host.includes(busca))) {
    return { campanha: 'organico', origem: host, midia: 'organico', campanha_id: null };
  }
  if (REDES.some((rede) => host.includes(rede))) {
    return { campanha: 'social-organico', origem: host, midia: 'social', campanha_id: null };
  }
  return { campanha: 'referencia', origem: host, midia: 'referral', campanha_id: null };
}

/* Classificacao grosseira do dispositivo, so para segmentar o relatorio. */
export function identificarDispositivo(userAgent = '') {
  const ua = userAgent.toLowerCase();
  if (/ipad|tablet|playbook|silk/.test(ua)) return 'tablet';
  if (/mobi|iphone|android|phone/.test(ua)) return 'celular';
  if (!ua) return 'desconhecido';
  return 'computador';
}
