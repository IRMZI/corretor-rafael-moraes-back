/* Painel administrativo: HTML/CSS/JS puros, sem build e sem dependencia.
   Fala com a propria API (mesma origem) usando o cookie de sessao. */
(function () {
  'use strict';

  var $ = function (seletor) { return document.querySelector(seletor); };
  var estado = {
    aba: 'visao',
    dias: { visao: 30, campanhas: 30, visitantes: 30 },
    visitantes: { pagina: 1, convertido: '', busca: '' },
    leads: { pagina: 1, status: '', tag: '', busca: '' }
  };

  /* ------------------------------------------------------------- helpers -- */
  function api(rota, opcoes) {
    opcoes = opcoes || {};
    return fetch('/api' + rota, {
      method: opcoes.method || 'GET',
      headers: opcoes.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
      credentials: 'same-origin'
    }).then(function (resposta) {
      return resposta.json().catch(function () { return {}; }).then(function (corpo) {
        if (resposta.status === 401) { mostrarLogin(); throw new Error('sessao'); }
        if (!resposta.ok) throw new Error(corpo.erro || 'Falha na requisicao.');
        return corpo;
      });
    });
  }

  function esc(valor) {
    if (valor === null || valor === undefined) return '';
    return String(valor).replace(/[&<>"']/g, function (caractere) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[caractere];
    });
  }

  function numero(valor) { return (valor || 0).toLocaleString('pt-BR'); }

  function dinheiro(valor) {
    return (Number(valor) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function tempo(segundos) {
    segundos = Math.round(segundos || 0);
    if (!segundos) return '—';
    if (segundos < 60) return segundos + 's';
    var minutos = Math.floor(segundos / 60);
    var resto = segundos % 60;
    if (minutos < 60) return minutos + 'min' + (resto ? ' ' + resto + 's' : '');
    return Math.floor(minutos / 60) + 'h ' + (minutos % 60) + 'min';
  }

  function dataHora(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function diaCurto(texto) {
    var partes = String(texto).split('-');
    return partes[2] + '/' + partes[1];
  }

  var ROTULO_STATUS = {
    novo: 'Novo', em_contato: 'Em contato', qualificado: 'Qualificado',
    convertido: 'Convertido', descartado: 'Descartado'
  };

  var ROTULO_EVENTO = {
    pageview: 'Abriu a página', scroll: 'Rolou a página', clique: 'Clicou',
    form_inicio: 'Começou o formulário', form_envio: 'Enviou o formulário',
    whatsapp: 'Clicou no WhatsApp', heartbeat: 'Continuou na página', saida: 'Saiu da página'
  };

  /* --------------------------------------------------------------- login -- */
  function mostrarLogin() {
    $('#telaPainel').hidden = true;
    $('#telaLogin').hidden = false;
  }

  function mostrarPainel(email) {
    $('#telaLogin').hidden = true;
    $('#telaPainel').hidden = false;
    $('#usuarioLogado').textContent = email || '';
    trocarAba(estado.aba);
  }

  $('#formLogin').addEventListener('submit', function (evento) {
    evento.preventDefault();
    var botao = $('#btnEntrar');
    var erro = $('#erroLogin');
    erro.hidden = true;
    botao.disabled = true;
    botao.textContent = 'Entrando...';

    api('/admin/login', { method: 'POST', body: { email: $('#email').value, senha: $('#senha').value } })
      .then(function (corpo) {
        $('#senha').value = '';
        mostrarPainel(corpo.usuario.email);
      })
      .catch(function (falha) {
        erro.textContent = falha.message === 'sessao' ? 'E-mail ou senha inválidos.' : falha.message;
        erro.hidden = false;
      })
      .finally(function () {
        botao.disabled = false;
        botao.textContent = 'Entrar';
      });
  });

  $('#btnSair').addEventListener('click', function () {
    api('/admin/logout', { method: 'POST' }).catch(function () {}).then(mostrarLogin);
  });

  /* ---------------------------------------------------------------- abas -- */
  function trocarAba(aba) {
    estado.aba = aba;
    Array.prototype.forEach.call(document.querySelectorAll('.aba'), function (botao) {
      botao.classList.toggle('ativa', botao.dataset.aba === aba);
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-secao]'), function (secao) {
      secao.hidden = secao.dataset.secao !== aba;
    });

    if (aba === 'visao') carregarVisao();
    if (aba === 'campanhas') carregarCampanhas();
    if (aba === 'visitantes') carregarVisitantes();
    if (aba === 'conversoes') carregarLeads();
  }

  $('#abas').addEventListener('click', function (evento) {
    var botao = evento.target.closest('.aba');
    if (botao) trocarAba(botao.dataset.aba);
  });

  document.addEventListener('click', function (evento) {
    var atalho = evento.target.closest('[data-ir]');
    if (atalho) { evento.preventDefault(); trocarAba(atalho.dataset.ir); }
  });

  function ligarPeriodo(seletor, chave, aoTrocar) {
    $(seletor).addEventListener('click', function (evento) {
      var botao = evento.target.closest('button');
      if (!botao) return;
      estado.dias[chave] = Number(botao.dataset.dias);
      Array.prototype.forEach.call(this.querySelectorAll('button'), function (outro) {
        outro.classList.toggle('ativo', outro === botao);
      });
      aoTrocar();
    });
  }

  /* ------------------------------------------------------- grafico linha -- */
  /* Serie temporal com duas linhas, grade discreta e cruz + tooltip no hover. */
  function graficoSerie(alvo, dados) {
    if (!dados.length) { alvo.innerHTML = '<p class="carregando">Sem acessos no período.</p>'; return; }

    var L = 760, A = 260, margem = { topo: 16, direita: 14, baixo: 28, esquerda: 42 };
    var largura = L - margem.esquerda - margem.direita;
    var altura = A - margem.topo - margem.baixo;

    var maximo = Math.max(4, dados.reduce(function (maior, ponto) {
      return Math.max(maior, ponto.acessos, ponto.conversoes);
    }, 0));
    /* Arredonda o topo para um numero "redondo", para a grade ficar legivel. */
    var passo = Math.pow(10, Math.floor(Math.log10(maximo)));
    maximo = Math.ceil(maximo / passo) * passo;

    var x = function (indice) {
      return margem.esquerda + (dados.length === 1 ? largura / 2 : (indice / (dados.length - 1)) * largura);
    };
    var y = function (valor) { return margem.topo + altura - (valor / maximo) * altura; };

    var svg = ['<svg viewBox="0 0 ' + L + ' ' + A + '" role="img" aria-label="Acessos e conversões por dia">'];

    for (var i = 0; i <= 4; i++) {
      var valorGrade = (maximo / 4) * i;
      var alturaGrade = y(valorGrade);
      svg.push('<line class="gr__grade" x1="' + margem.esquerda + '" y1="' + alturaGrade + '" x2="' + (L - margem.direita) + '" y2="' + alturaGrade + '"/>');
      svg.push('<text class="gr__eixo" x="' + (margem.esquerda - 8) + '" y="' + (alturaGrade + 4) + '" text-anchor="end">' + numero(Math.round(valorGrade)) + '</text>');
    }

    var salto = Math.max(1, Math.ceil(dados.length / 7));
    dados.forEach(function (ponto, indice) {
      if (indice % salto && indice !== dados.length - 1) return;
      svg.push('<text class="gr__eixo" x="' + x(indice) + '" y="' + (A - 8) + '" text-anchor="middle">' + diaCurto(ponto.dia) + '</text>');
    });

    var caminho = function (campo) {
      return dados.map(function (ponto, indice) {
        return (indice ? 'L' : 'M') + x(indice).toFixed(1) + ' ' + y(ponto[campo]).toFixed(1);
      }).join(' ');
    };

    svg.push('<path class="gr__linha" d="' + caminho('acessos') + '" stroke="var(--serie-acessos)"/>');
    svg.push('<path class="gr__linha" d="' + caminho('conversoes') + '" stroke="var(--serie-conversoes)"/>');
    svg.push('<line class="gr__cruz" id="cruz" y1="' + margem.topo + '" y2="' + (margem.topo + altura) + '" x1="0" x2="0" opacity="0"/>');
    svg.push('<circle class="gr__ponto" id="pontoA" r="5" fill="var(--serie-acessos)" opacity="0"/>');
    svg.push('<circle class="gr__ponto" id="pontoC" r="5" fill="var(--serie-conversoes)" opacity="0"/>');
    svg.push('<rect class="gr__toque" id="toque" x="' + margem.esquerda + '" y="' + margem.topo + '" width="' + largura + '" height="' + altura + '"/>');
    svg.push('</svg><div class="dica" id="dica" hidden></div>');

    alvo.innerHTML = svg.join('');

    var toque = alvo.querySelector('#toque');
    var cruz = alvo.querySelector('#cruz');
    var pontoA = alvo.querySelector('#pontoA');
    var pontoC = alvo.querySelector('#pontoC');
    var dica = alvo.querySelector('#dica');

    function esconder() {
      dica.hidden = true;
      [cruz, pontoA, pontoC].forEach(function (elemento) { elemento.setAttribute('opacity', '0'); });
    }

    toque.addEventListener('mousemove', function (evento) {
      var caixa = alvo.querySelector('svg').getBoundingClientRect();
      var proporcao = L / caixa.width;
      var posicao = (evento.clientX - caixa.left) * proporcao;
      var indice = Math.round(((posicao - margem.esquerda) / largura) * (dados.length - 1));
      indice = Math.max(0, Math.min(dados.length - 1, indice));

      var ponto = dados[indice];
      cruz.setAttribute('x1', x(indice)); cruz.setAttribute('x2', x(indice)); cruz.setAttribute('opacity', '1');
      pontoA.setAttribute('cx', x(indice)); pontoA.setAttribute('cy', y(ponto.acessos)); pontoA.setAttribute('opacity', '1');
      pontoC.setAttribute('cx', x(indice)); pontoC.setAttribute('cy', y(ponto.conversoes)); pontoC.setAttribute('opacity', '1');

      dica.innerHTML =
        '<div class="dica__dia">' + diaCurto(ponto.dia) + '</div>' +
        '<div class="dica__linha"><span class="legenda__cor" style="background:var(--serie-acessos)"></span>Acessos<span class="dica__valor">' + numero(ponto.acessos) + '</span></div>' +
        '<div class="dica__linha"><span class="legenda__cor" style="background:var(--serie-conversoes)"></span>Conversões<span class="dica__valor">' + numero(ponto.conversoes) + '</span></div>';
      dica.hidden = false;

      var esquerda = (x(indice) / proporcao) + 14;
      if (esquerda + dica.offsetWidth > caixa.width) esquerda = (x(indice) / proporcao) - dica.offsetWidth - 14;
      dica.style.left = Math.max(0, esquerda) + 'px';
      dica.style.top = '8px';
    });
    toque.addEventListener('mouseleave', esconder);
  }

  /* Lista de barras horizontais (funil e ranking de campanhas). */
  function barras(alvo, itens, opcoes) {
    opcoes = opcoes || {};
    if (!itens.length) { alvo.innerHTML = '<p class="carregando">Sem dados no período.</p>'; return; }

    var maximo = Math.max.apply(null, itens.map(function (item) { return item.valor; })) || 1;
    alvo.innerHTML = itens.map(function (item) {
      var porcento = Math.max(1.5, (item.valor / maximo) * 100);
      return '<div>' +
        '<div class="barra__topo"><span class="barra__nome">' + esc(item.nome) + '</span>' +
        '<span class="barra__valor">' + esc(item.rotulo || numero(item.valor)) + '</span></div>' +
        '<div class="barra__trilho"><div class="barra__preenche' + (opcoes.conversao ? ' barra__preenche--conversao' : '') +
        '" style="width:' + porcento.toFixed(1) + '%"></div></div>' +
        '</div>';
    }).join('');
  }

  /* --------------------------------------------------------- visão geral -- */
  function carregarVisao() {
    var dias = estado.dias.visao;
    $('#kpisVisao').innerHTML = '<p class="carregando">Carregando...</p>';

    api('/admin/metricas?dias=' + dias).then(function (corpo) {
      var m = corpo.metricas;
      var j = corpo.janelas;

      var cartoes = [
        { rotulo: 'Visitantes únicos', valor: numero(m.visitantes), nota: 'no período de ' + dias + ' dias' },
        { rotulo: 'Acessos', valor: numero(m.acessos), nota: '7d: ' + numero(j.acessos_7) + ' · 30d: ' + numero(j.acessos_30) + ' · 90d: ' + numero(j.acessos_90) },
        { rotulo: 'Conversões', valor: numero(m.conversoes), nota: '7d: ' + numero(j.conversoes_7) + ' · 30d: ' + numero(j.conversoes_30) + ' · 90d: ' + numero(j.conversoes_90) },
        { rotulo: 'Taxa de conversão', valor: (m.taxa_conversao || 0).toLocaleString('pt-BR') + '%', nota: 'leads por acesso' },
        { rotulo: 'Tempo médio na página', valor: tempo(m.tempo_medio_segundos), nota: 'mediana: ' + tempo(m.tempo_mediano_segundos) },
        { rotulo: 'Vendas', valor: numero(m.vendas), nota: m.receita ? dinheiro(m.receita) + ' em vendas' : 'marque a tag "vendido" no lead' }
      ];

      $('#kpisVisao').innerHTML = cartoes.map(function (cartao) {
        return '<div class="kpi"><div class="kpi__rotulo">' + esc(cartao.rotulo) + '</div>' +
          '<div class="kpi__valor">' + esc(cartao.valor) + '</div>' +
          '<div class="kpi__nota">' + esc(cartao.nota) + '</div></div>';
      }).join('');

      graficoSerie($('#graficoSerie'), m.serie || []);

      var f = m.funil || {};
      barras($('#funil'), [
        { nome: 'Visitas', valor: f.sessoes || 0 },
        { nome: 'Rolaram metade da página', valor: f.rolaram_metade || 0 },
        { nome: 'Começaram o formulário', valor: f.iniciaram_formulario || 0 },
        { nome: 'Clicaram no WhatsApp', valor: f.clicaram_whatsapp || 0 },
        { nome: 'Converteram', valor: f.converteram || 0 }
      ]);
    }).catch(function (erro) {
      if (erro.message !== 'sessao') $('#kpisVisao').innerHTML = '<p class="carregando">' + esc(erro.message) + '</p>';
    });

    api('/admin/campanhas?dias=' + dias).then(function (corpo) {
      var top = (corpo.campanhas || []).filter(function (item) { return item.leads > 0; }).slice(0, 8);
      barras($('#topCampanhas'), top.map(function (item) {
        return {
          nome: item.campanha + (item.origem && item.origem !== item.campanha ? ' · ' + item.origem : ''),
          valor: item.leads,
          rotulo: numero(item.leads) + ' lead' + (item.leads === 1 ? '' : 's') +
                  (item.taxa_conversao !== null ? ' · ' + item.taxa_conversao + '%' : '')
        };
      }), { conversao: true });
    }).catch(function () {});
  }

  /* ----------------------------------------------------------- campanhas -- */
  function carregarCampanhas() {
    var corpo = $('#tabelaCampanhas');
    corpo.innerHTML = '<tr><td colspan="9" class="vazio">Carregando...</td></tr>';

    api('/admin/campanhas?dias=' + estado.dias.campanhas).then(function (resposta) {
      var linhas = resposta.campanhas || [];
      if (!linhas.length) {
        corpo.innerHTML = '<tr><td colspan="9" class="vazio">Nenhum acesso registrado no período.</td></tr>';
        return;
      }
      corpo.innerHTML = linhas.map(function (item) {
        return '<tr>' +
          '<td><span class="etiqueta etiqueta--brand">' + esc(item.campanha) + '</span></td>' +
          '<td>' + esc(item.origem) + '</td>' +
          '<td>' + esc(item.midia) + '</td>' +
          '<td class="num">' + numero(item.acessos) + '</td>' +
          '<td class="num">' + numero(item.visitantes) + '</td>' +
          '<td class="num">' + numero(item.leads) + '</td>' +
          '<td class="num">' + (item.taxa_conversao === null ? '—' : item.taxa_conversao + '%') + '</td>' +
          '<td class="num">' + tempo(item.tempo_medio_segundos) + '</td>' +
          '<td class="num">' + (item.vendas ? numero(item.vendas) + ' · ' + dinheiro(item.receita) : '—') + '</td>' +
          '</tr>';
      }).join('');
    }).catch(function (erro) {
      if (erro.message !== 'sessao') corpo.innerHTML = '<tr><td colspan="9" class="vazio">' + esc(erro.message) + '</td></tr>';
    });
  }

  /* ---------------------------------------------------------- visitantes -- */
  function carregarVisitantes() {
    var corpo = $('#tabelaVisitantes');
    corpo.innerHTML = '<tr><td colspan="8" class="vazio">Carregando...</td></tr>';

    var parametros = new URLSearchParams({
      dias: estado.dias.visitantes,
      pagina: estado.visitantes.pagina,
      por_pagina: 25
    });
    if (estado.visitantes.convertido) parametros.set('convertido', estado.visitantes.convertido);
    if (estado.visitantes.busca) parametros.set('busca', estado.visitantes.busca);

    api('/admin/visitantes?' + parametros.toString()).then(function (resposta) {
      var lista = resposta.visitantes || [];
      if (!lista.length) {
        corpo.innerHTML = '<tr><td colspan="8" class="vazio">Nenhum visitante no período.</td></tr>';
        $('#paginacaoVisitantes').innerHTML = '';
        return;
      }

      corpo.innerHTML = lista.map(function (visitante) {
        return '<tr class="clicavel" data-visitante="' + visitante.id + '">' +
          '<td><code>' + esc(visitante.visitante_uid.slice(0, 8)) + '</code></td>' +
          '<td><span class="etiqueta etiqueta--brand">' + esc(visitante.campanha || 'direto') + '</span></td>' +
          '<td>' + esc(visitante.origem || '—') + '</td>' +
          '<td>' + esc(visitante.dispositivo || '—') + '</td>' +
          '<td class="num">' + numero(visitante.total_sessoes) + '</td>' +
          '<td class="num">' + tempo(visitante.tempo_total_segundos) + '</td>' +
          '<td>' + dataHora(visitante.ultimo_acesso_em) + '</td>' +
          '<td>' + (visitante.convertido
            ? '<span class="etiqueta etiqueta--ok">' + esc(visitante.lead_nome || 'Sim') + '</span>'
            : '<span class="etiqueta">Não</span>') + '</td>' +
          '</tr>';
      }).join('');

      paginar($('#paginacaoVisitantes'), resposta, function (pagina) {
        estado.visitantes.pagina = pagina;
        carregarVisitantes();
      });
    }).catch(function (erro) {
      if (erro.message !== 'sessao') corpo.innerHTML = '<tr><td colspan="8" class="vazio">' + esc(erro.message) + '</td></tr>';
    });
  }

  function paginar(alvo, resposta, aoTrocar) {
    if (resposta.total_paginas <= 1) { alvo.innerHTML = ''; return; }
    alvo.innerHTML =
      '<button class="btn btn--pequeno" data-pagina="' + (resposta.pagina - 1) + '"' + (resposta.pagina <= 1 ? ' disabled' : '') + '>Anterior</button>' +
      '<span>Página ' + resposta.pagina + ' de ' + resposta.total_paginas + ' · ' + numero(resposta.total) + ' no total</span>' +
      '<button class="btn btn--pequeno" data-pagina="' + (resposta.pagina + 1) + '"' + (resposta.pagina >= resposta.total_paginas ? ' disabled' : '') + '>Próxima</button>';

    alvo.onclick = function (evento) {
      var botao = evento.target.closest('button[data-pagina]');
      if (botao && !botao.disabled) aoTrocar(Number(botao.dataset.pagina));
    };
  }

  $('#tabelaVisitantes').addEventListener('click', function (evento) {
    var linha = evento.target.closest('tr[data-visitante]');
    if (linha) abrirJornada(linha.dataset.visitante);
  });

  $('#filtroConvertido').addEventListener('change', function () {
    estado.visitantes.convertido = this.value;
    estado.visitantes.pagina = 1;
    carregarVisitantes();
  });

  var esperaBusca;
  $('#buscaVisitantes').addEventListener('input', function () {
    var valor = this.value;
    clearTimeout(esperaBusca);
    esperaBusca = setTimeout(function () {
      estado.visitantes.busca = valor;
      estado.visitantes.pagina = 1;
      carregarVisitantes();
    }, 400);
  });

  /* ---------------------------------------------------------- conversoes -- */
  function carregarLeads() {
    var corpo = $('#tabelaLeads');
    corpo.innerHTML = '<tr><td colspan="7" class="vazio">Carregando...</td></tr>';

    var parametros = new URLSearchParams({ pagina: estado.leads.pagina, por_pagina: 25 });
    if (estado.leads.status) parametros.set('status', estado.leads.status);
    if (estado.leads.tag) parametros.set('tag', estado.leads.tag);
    if (estado.leads.busca) parametros.set('busca', estado.leads.busca);

    api('/leads?' + parametros.toString()).then(function (resposta) {
      var lista = resposta.leads || [];
      if (!lista.length) {
        corpo.innerHTML = '<tr><td colspan="7" class="vazio">Nenhuma conversão encontrada.</td></tr>';
        $('#paginacaoLeads').innerHTML = '';
        return;
      }

      corpo.innerHTML = lista.map(function (lead) {
        var tags = (lead.tags || []).map(function (tag) {
          return '<span class="etiqueta' + (tag === 'vendido' ? ' etiqueta--ok' : '') + '">' + esc(tag) + '</span>';
        }).join(' ');

        return '<tr class="clicavel" data-lead="' + lead.id + '">' +
          '<td><strong>' + esc(lead.nome) + '</strong><br><span class="kpi__nota">' + esc(lead.cidade) + '</span></td>' +
          '<td>' + esc(lead.whatsapp) + '<br><span class="kpi__nota">' + esc(lead.email) + '</span></td>' +
          '<td>' + esc(lead.objetivo) + '<br><span class="kpi__nota">' + esc(lead.tipo_imovel) + '</span></td>' +
          '<td><span class="etiqueta etiqueta--brand">' + esc(lead.campanha || 'direto') + '</span></td>' +
          '<td><span class="etiqueta">' + esc(ROTULO_STATUS[lead.status] || lead.status) + '</span></td>' +
          '<td><div class="etiquetas">' + (tags || '—') + '</div></td>' +
          '<td>' + dataHora(lead.criado_em) + '</td>' +
          '</tr>';
      }).join('');

      paginar($('#paginacaoLeads'), resposta, function (pagina) {
        estado.leads.pagina = pagina;
        carregarLeads();
      });
    }).catch(function (erro) {
      if (erro.message !== 'sessao') corpo.innerHTML = '<tr><td colspan="7" class="vazio">' + esc(erro.message) + '</td></tr>';
    });

    api('/leads/tags').then(function (resposta) {
      var seletor = $('#filtroTag');
      var atual = seletor.value;
      seletor.innerHTML = '<option value="">Todas as tags</option>' +
        (resposta.tags || []).map(function (item) {
          return '<option value="' + esc(item.tag) + '">' + esc(item.tag) + ' (' + item.total + ')</option>';
        }).join('');
      seletor.value = atual;
    }).catch(function () {});
  }

  $('#tabelaLeads').addEventListener('click', function (evento) {
    var linha = evento.target.closest('tr[data-lead]');
    if (linha) abrirLead(linha.dataset.lead);
  });

  $('#filtroStatus').addEventListener('change', function () {
    estado.leads.status = this.value; estado.leads.pagina = 1; carregarLeads();
  });
  $('#filtroTag').addEventListener('change', function () {
    estado.leads.tag = this.value; estado.leads.pagina = 1; carregarLeads();
  });

  var esperaLead;
  $('#buscaLeads').addEventListener('input', function () {
    var valor = this.value;
    clearTimeout(esperaLead);
    esperaLead = setTimeout(function () {
      estado.leads.busca = valor; estado.leads.pagina = 1; carregarLeads();
    }, 400);
  });

  /* -------------------------------------------------------------- gaveta -- */
  function abrirGaveta(html) {
    $('#gaveta').innerHTML = '<div class="gaveta"><div class="gaveta__painel">' + html + '</div></div>';
    document.body.style.overflow = 'hidden';
  }

  function fecharGaveta() {
    $('#gaveta').innerHTML = '';
    document.body.style.overflow = '';
  }

  $('#gaveta').addEventListener('click', function (evento) {
    if (evento.target.classList.contains('gaveta') || evento.target.closest('.fechar')) fecharGaveta();
  });
  document.addEventListener('keydown', function (evento) {
    if (evento.key === 'Escape') fecharGaveta();
  });

  function timelineSessoes(sessoes) {
    if (!sessoes || !sessoes.length) return '<p class="carregando">Sem jornada registrada.</p>';

    return sessoes.map(function (sessao, indice) {
      var eventos = (sessao.eventos || []).map(function (evento) {
        var detalhe = '';
        if (evento.tipo === 'scroll') detalhe = evento.dados.profundidade + '% da página';
        else if (evento.dados && evento.dados.texto) detalhe = '"' + evento.dados.texto + '"';
        else if (evento.dados && evento.dados.titulo) detalhe = evento.dados.titulo;

        return '<li class="' + (evento.tipo === 'form_envio' || evento.tipo === 'whatsapp' ? 'conversao' : '') + '">' +
          '<span class="jornada__hora">' + dataHora(evento.ocorrido_em) + '</span> · ' +
          '<span class="jornada__tipo">' + esc(ROTULO_EVENTO[evento.tipo] || evento.tipo) + '</span>' +
          (detalhe ? ' <span class="jornada__dados">' + esc(detalhe) + '</span>' : '') +
          '</li>';
      }).join('');

      return '<div class="sessao-bloco">' +
        '<div class="sessao-bloco__cabecalho"><strong>Visita ' + (indice + 1) + '</strong> · ' +
        dataHora(sessao.iniciada_em) + ' · ' + tempo(sessao.duracao_segundos) + ' na página · ' +
        '<span class="etiqueta etiqueta--brand">' + esc(sessao.campanha || 'direto') + '</span></div>' +
        '<ul class="jornada">' + (eventos || '<li>Sem eventos.</li>') + '</ul></div>';
    }).join('');
  }

  function abrirJornada(id) {
    abrirGaveta('<p class="carregando">Carregando jornada...</p>');

    api('/admin/visitantes/' + id).then(function (resposta) {
      var v = resposta.visitante;
      var utm = Object.keys(v.utm || {}).map(function (chave) {
        return '<div><span class="dado__rotulo">' + esc(chave) + '</span><div class="dado__valor">' + esc(v.utm[chave]) + '</div></div>';
      }).join('');

      abrirGaveta(
        '<div class="gaveta__topo"><div><h2>Visitante ' + esc(v.visitante_uid.slice(0, 8)) + '</h2>' +
        '<div class="gaveta__sub">' + (v.convertido ? 'Converteu em ' + dataHora(v.convertido_em) : 'Ainda não converteu') + '</div></div>' +
        '<button class="fechar" aria-label="Fechar">&times;</button></div>' +

        '<div class="dados">' +
        dado('Campanha', v.campanha || 'direto') +
        dado('Origem', v.origem || '—') +
        dado('Mídia', v.midia || '—') +
        dado('ID da campanha', v.campanha_id || '—') +
        dado('Dispositivo', v.dispositivo || '—') +
        dado('Visitas', numero(v.total_sessoes)) +
        dado('Tempo total', tempo(v.tempo_total_segundos)) +
        dado('Primeiro acesso', dataHora(v.primeiro_acesso_em)) +
        '</div>' +

        (utm ? '<h3>Parâmetros de campanha</h3><div class="dados">' + utm + '</div>' : '') +
        (resposta.lead ? '<div class="aviso aviso--ok">Convertido: ' + esc(resposta.lead.nome) + ' · ' + esc(resposta.lead.whatsapp) + '</div><br>' : '') +

        '<h3>Jornada</h3><br>' + timelineSessoes(resposta.sessoes)
      );
    }).catch(function (erro) {
      if (erro.message !== 'sessao') abrirGaveta('<p class="carregando">' + esc(erro.message) + '</p>');
    });
  }

  function dado(rotulo, valor) {
    return '<div><span class="dado__rotulo">' + esc(rotulo) + '</span><div class="dado__valor">' + esc(valor) + '</div></div>';
  }

  var TAGS_SUGERIDAS = ['quente', 'morno', 'frio', 'visita-agendada', 'proposta', 'vendido', 'perdido'];

  function abrirLead(id) {
    abrirGaveta('<p class="carregando">Carregando conversão...</p>');

    api('/leads/' + id).then(function (resposta) {
      var lead = resposta.lead;
      var venda = resposta.venda;
      var tags = lead.tags || [];
      var sugestoes = TAGS_SUGERIDAS.concat(tags.filter(function (tag) { return TAGS_SUGERIDAS.indexOf(tag) === -1; }));

      var statusIntegracao = '';
      if (venda) {
        var integracoes = venda.integracoes || {};
        statusIntegracao =
          '<h3>Evento de venda</h3>' +
          '<p class="cartao__nota">Disparado quando a tag "vendido" foi marcada. O mesmo ID evita contagem dupla no pixel.</p>' +
          '<div class="dados">' +
          dado('ID do evento', venda.evento_uid) +
          dado('Valor', venda.valor ? dinheiro(venda.valor) : 'não informado') +
          dado('Meta (API de conversões)', rotuloIntegracao(integracoes.meta)) +
          dado('Google Analytics 4', rotuloIntegracao(integracoes.ga4)) +
          '</div>' +
          '<button class="btn btn--pequeno" id="btnReenviar">Reenviar evento</button>' +
          '<h3 style="margin-top:22px">Pixel de venda (navegador)</h3>' +
          '<p class="cartao__nota">Opcional: cole em uma página de obrigado se quiser disparar também pelo navegador.</p>' +
          '<pre class="codigo">' + esc(
            "fbq('track', 'Purchase', { value: " + Number(venda.valor || 0) + ", currency: '" + (venda.moeda || 'BRL') + "' },\n" +
            "     { eventID: '" + venda.evento_uid + "' });"
          ) + '</pre>';
      }

      abrirGaveta(
        '<div class="gaveta__topo"><div><h2>' + esc(lead.nome) + '</h2>' +
        '<div class="gaveta__sub">' + esc(lead.email) + ' · ' + esc(lead.whatsapp) + '</div></div>' +
        '<button class="fechar" aria-label="Fechar">&times;</button></div>' +

        '<div class="dados">' +
        dado('Cidade', lead.cidade) +
        dado('Objetivo', lead.objetivo) +
        dado('Tipo de imóvel', lead.tipo_imovel) +
        dado('Faixa', lead.faixa_investimento || 'não informada') +
        dado('Campanha', lead.campanha || 'direto') +
        dado('Origem', lead.origem_trafego || '—') +
        dado('ID da campanha', lead.campanha_id || '—') +
        dado('Recebido em', dataHora(lead.criado_em)) +
        '</div>' +

        '<h3>Status</h3><br>' +
        '<select id="statusLead">' + Object.keys(ROTULO_STATUS).map(function (chave) {
          return '<option value="' + chave + '"' + (lead.status === chave ? ' selected' : '') + '>' + ROTULO_STATUS[chave] + '</option>';
        }).join('') + '</select>' +

        '<h3 style="margin-top:22px">Tags</h3>' +
        '<p class="cartao__nota">Marcar <strong>vendido</strong> registra a venda e dispara o evento de conversão.</p>' +
        '<div class="editor-tags" id="editorTags">' +
        sugestoes.map(function (tag) {
          var marcada = tags.indexOf(tag) > -1;
          return '<button class="tag-alternavel' + (marcada ? ' marcada' : '') + (tag === 'vendido' ? ' venda' : '') +
            '" data-tag="' + esc(tag) + '">' + esc(tag) + '</button>';
        }).join('') +
        '</div>' +
        '<div class="campo"><label for="valorVenda">Valor da venda (opcional)</label>' +
        '<input type="number" id="valorVenda" min="0" step="0.01" value="' + (lead.valor_venda || '') + '" placeholder="Ex.: 450000"></div>' +
        '<button class="btn btn--primario btn--bloco" id="btnSalvarTags">Salvar tags</button>' +
        '<div class="aviso" id="avisoLead" hidden></div>' +

        (statusIntegracao ? '<div style="margin-top:26px">' + statusIntegracao + '</div>' : '') +

        '<h3 style="margin-top:26px">Jornada até a conversão</h3><br>' +
        (resposta.jornada ? timelineSessoes(resposta.jornada.sessoes)
          : '<p class="carregando">Este lead chegou sem rastreamento de jornada.</p>')
      );

      ligarAcoesLead(lead);
    }).catch(function (erro) {
      if (erro.message !== 'sessao') abrirGaveta('<p class="carregando">' + esc(erro.message) + '</p>');
    });
  }

  function rotuloIntegracao(resultado) {
    if (!resultado) return 'não enviado';
    if (resultado.status === 'enviado') return 'enviado ✓';
    if (resultado.status === 'nao_configurado') return 'não configurado';
    return 'falhou (' + (resultado.http || resultado.erro || '?') + ')';
  }

  function ligarAcoesLead(lead) {
    var editor = $('#editorTags');
    var aviso = $('#avisoLead');

    editor.addEventListener('click', function (evento) {
      var botao = evento.target.closest('.tag-alternavel');
      if (botao) botao.classList.toggle('marcada');
    });

    $('#statusLead').addEventListener('change', function () {
      api('/leads/' + lead.id, { method: 'PATCH', body: { status: this.value } })
        .then(function () { anunciar(aviso, 'Status atualizado.', true); carregarLeads(); })
        .catch(function (erro) { anunciar(aviso, erro.message, false); });
    });

    $('#btnSalvarTags').addEventListener('click', function () {
      var botao = this;
      var tags = Array.prototype.map.call(editor.querySelectorAll('.tag-alternavel.marcada'), function (elemento) {
        return elemento.dataset.tag;
      });
      var valor = $('#valorVenda').value;

      botao.disabled = true;
      botao.textContent = 'Salvando...';

      api('/leads/' + lead.id + '/tags', {
        method: 'PUT',
        body: { tags: tags, valor_venda: valor === '' ? null : Number(valor) }
      }).then(function (resposta) {
        var mensagem = 'Tags salvas.';
        if (resposta.integracoes) {
          mensagem += ' Evento de venda: Meta ' + rotuloIntegracao(resposta.integracoes.meta) +
                      ' · GA4 ' + rotuloIntegracao(resposta.integracoes.ga4) + '.';
        }
        anunciar(aviso, mensagem, true);
        carregarLeads();
        setTimeout(function () { abrirLead(lead.id); }, 900);
      }).catch(function (erro) {
        anunciar(aviso, erro.message, false);
      }).finally(function () {
        botao.disabled = false;
        botao.textContent = 'Salvar tags';
      });
    });

    var reenviar = $('#btnReenviar');
    if (reenviar) {
      reenviar.addEventListener('click', function () {
        var botao = this;
        botao.disabled = true;
        botao.textContent = 'Enviando...';
        api('/leads/' + lead.id + '/venda/reenviar', { method: 'POST' })
          .then(function (resposta) {
            anunciar(aviso, 'Reenviado. Meta ' + rotuloIntegracao(resposta.integracoes.meta) +
                            ' · GA4 ' + rotuloIntegracao(resposta.integracoes.ga4) + '.', true);
            setTimeout(function () { abrirLead(lead.id); }, 900);
          })
          .catch(function (erro) { anunciar(aviso, erro.message, false); })
          .finally(function () { botao.disabled = false; botao.textContent = 'Reenviar evento'; });
      });
    }
  }

  function anunciar(elemento, mensagem, sucesso) {
    elemento.textContent = mensagem;
    elemento.className = 'aviso ' + (sucesso ? 'aviso--ok' : 'aviso--erro');
    elemento.hidden = false;
  }

  /* --------------------------------------------------------------- start -- */
  ligarPeriodo('#periodoVisao', 'visao', carregarVisao);
  ligarPeriodo('#periodoCampanhas', 'campanhas', carregarCampanhas);
  ligarPeriodo('#periodoVisitantes', 'visitantes', function () {
    estado.visitantes.pagina = 1;
    carregarVisitantes();
  });

  api('/admin/eu')
    .then(function (corpo) { mostrarPainel(corpo.usuario.email); })
    .catch(function () { mostrarLogin(); });
})();
