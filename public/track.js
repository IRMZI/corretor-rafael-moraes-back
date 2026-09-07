/* ---------------------------------------------------------------------------
   Rastreamento da landing page (visitante anonimo + jornada).

   Uso na landing page:
     <script src="https://sua-api.com.br/track.js" defer></script>

   Nao usa cookie: o visitante e identificado por um id aleatorio guardado no
   localStorage (o mesmo navegador) e a visita por um id no sessionStorage.
   Nenhum dado pessoal e coletado aqui - so a jornada e a campanha de origem.

   API exposta para a pagina:
     window.rastreio.ids()             -> { visitante_uid, sessao_uid }
     window.rastreio.evento(tipo, dados)
--------------------------------------------------------------------------- */
(function () {
  'use strict';

  var script = document.currentScript || (function () {
    var todos = document.getElementsByTagName('script');
    return todos[todos.length - 1];
  })();

  /* A URL da API sai do proprio src do script: nada para configurar na pagina. */
  var API = (script && script.getAttribute('data-api')) ||
            (script && script.src ? script.src.replace(/\/track\.js.*$/, '') : '');
  if (!API) return;

  var ENDPOINT = API + '/api/track';
  var CHAVE_VISITANTE = 'rastreio_visitante';
  var CHAVE_SESSAO = 'rastreio_sessao';
  var CHAVE_UTM = 'rastreio_utm';

  /* ---- Armazenamento tolerante a falha (aba anonima, cookies bloqueados) ---- */
  function ler(deposito, chave) {
    try { return window[deposito].getItem(chave); } catch (e) { return null; }
  }
  function gravar(deposito, chave, valor) {
    try { window[deposito].setItem(chave, valor); } catch (e) { /* segue sem persistir */ }
  }

  function novoId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID().replace(/-/g, '');
    var bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (var i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  function idPersistente(deposito, chave) {
    var id = ler(deposito, chave);
    if (!id) { id = novoId(); gravar(deposito, chave, id); }
    return id;
  }

  var visitanteUid = idPersistente('localStorage', CHAVE_VISITANTE);
  var sessaoUid = idPersistente('sessionStorage', CHAVE_SESSAO);

  /* ---- Campanha: le a UTM da URL e guarda para o resto da sessao ---- */
  var CAMPOS_UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id', 'gclid', 'fbclid'];

  function lerUtm() {
    var parametros = new URLSearchParams(window.location.search);
    var utm = {};
    CAMPOS_UTM.forEach(function (campo) {
      var valor = parametros.get(campo);
      if (valor) utm[campo] = valor.slice(0, 300);
    });

    if (Object.keys(utm).length) {
      gravar('sessionStorage', CHAVE_UTM, JSON.stringify(utm));
      return utm;
    }
    /* Sem UTM na URL (navegou para outra pagina): mantem a da entrada. */
    try { return JSON.parse(ler('sessionStorage', CHAVE_UTM) || '{}'); } catch (e) { return {}; }
  }

  var utm = lerUtm();

  /* ---- Tempo ativo: so conta com a aba visivel ---- */
  var tempoAtivo = 0;
  var ultimaMarca = Date.now();
  var visivel = document.visibilityState !== 'hidden';

  function atualizarTempo() {
    var agora = Date.now();
    if (visivel) tempoAtivo += Math.round((agora - ultimaMarca) / 1000);
    ultimaMarca = agora;
  }

  /* ---- Fila de eventos: envia em lote para nao pipocar requisicao ---- */
  var fila = [];
  var temporizador = null;

  function corpo() {
    atualizarTempo();
    return JSON.stringify({
      visitante_uid: visitanteUid,
      sessao_uid: sessaoUid,
      pagina: window.location.href.slice(0, 500),
      referrer: document.referrer ? document.referrer.slice(0, 500) : null,
      utm: utm,
      tempo_ativo_segundos: tempoAtivo,
      eventos: fila.splice(0, fila.length)
    });
  }

  function enviar(usarBeacon) {
    if (temporizador) { clearTimeout(temporizador); temporizador = null; }
    var dados = corpo();

    if (usarBeacon && navigator.sendBeacon) {
      /* text/plain evita o preflight do CORS no unload da pagina. */
      navigator.sendBeacon(ENDPOINT, new Blob([dados], { type: 'text/plain;charset=UTF-8' }));
      return;
    }

    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: dados,
      keepalive: true
    }).catch(function () { /* tracking nunca atrapalha a pagina */ });
  }

  function registrar(tipo, dados) {
    fila.push({ tipo: tipo, pagina: window.location.href.slice(0, 500), dados: dados || {} });
    if (fila.length >= 10) return enviar(false);
    if (!temporizador) temporizador = setTimeout(function () { enviar(false); }, 3000);
  }

  /* ---- Eventos da jornada ---- */
  registrar('pageview', {
    titulo: document.title.slice(0, 200),
    largura: window.innerWidth,
    idioma: navigator.language
  });
  enviar(false);

  /* Profundidade de rolagem: um evento por marco atingido. */
  var marcos = [25, 50, 75, 100];
  var atingidos = {};
  window.addEventListener('scroll', function () {
    var altura = document.documentElement.scrollHeight - window.innerHeight;
    if (altura <= 0) return;
    var porcento = Math.min(100, Math.round((window.scrollY / altura) * 100));

    marcos.forEach(function (marco) {
      if (porcento >= marco && !atingidos[marco]) {
        atingidos[marco] = true;
        registrar('scroll', { profundidade: marco });
      }
    });
  }, { passive: true });

  /* Cliques em CTA, WhatsApp e ancoras. */
  document.addEventListener('click', function (evento) {
    var alvo = evento.target.closest('a, button');
    if (!alvo) return;

    var texto = (alvo.textContent || '').trim().slice(0, 80);
    var href = alvo.getAttribute('href') || '';

    if (href.indexOf('wa.me') > -1 || alvo.hasAttribute('data-whatsapp')) {
      registrar('whatsapp', { texto: texto, destino: href.slice(0, 200) });
      enviar(false);
      return;
    }
    registrar('clique', { texto: texto, destino: href.slice(0, 200), tag: alvo.tagName.toLowerCase() });
  }, true);

  /* Primeiro toque no formulario = interesse real. */
  var formularioIniciado = false;
  document.addEventListener('focusin', function (evento) {
    if (formularioIniciado) return;
    if (!evento.target.closest('form')) return;
    formularioIniciado = true;
    registrar('form_inicio', { campo: evento.target.name || evento.target.id || null });
  });

  /* Heartbeat: mantem o tempo de permanencia atualizado em visitas longas. */
  setInterval(function () { if (visivel) { registrar('heartbeat', {}); enviar(false); } }, 30000);

  document.addEventListener('visibilitychange', function () {
    atualizarTempo();
    visivel = document.visibilityState !== 'hidden';
    ultimaMarca = Date.now();
    if (!visivel) { registrar('saida', { motivo: 'aba-oculta' }); enviar(true); }
  });

  window.addEventListener('pagehide', function () {
    registrar('saida', { motivo: 'saiu-da-pagina' });
    enviar(true);
  });

  /* ---- API para a landing page ---- */
  window.rastreio = {
    ids: function () { return { visitante_uid: visitanteUid, sessao_uid: sessaoUid }; },
    utm: function () { return utm; },
    evento: function (tipo, dados) { registrar(tipo, dados); enviar(false); },
    conversao: function (dados) { registrar('form_envio', dados || {}); enviar(false); }
  };
})();
