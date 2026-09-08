import test from 'node:test';
import assert from 'node:assert/strict';

/* Rastreamento, metricas do painel e evento de venda.
   Precisa de um PostgreSQL descartavel em TEST_DATABASE_URL (ou DATABASE_URL);
   as tabelas sao esvaziadas no inicio da suite. */
const urlBanco = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

if (!urlBanco) {
  test('testes do painel ignorados: defina TEST_DATABASE_URL', { skip: true }, () => {});
} else {
  process.env.DATABASE_URL = urlBanco;
  process.env.NODE_ENV = 'test';
  process.env.ADMIN_EMAIL = 'dev@pushagencia.com.br';
  process.env.ADMIN_PASSWORD = 'senha-de-teste';
  process.env.SESSION_SECRET = 'segredo-de-teste';
  process.env.CORS_ORIGINS = '';
  process.env.RATE_LIMIT_MAX = '1000';

  const { criarApp } = await import('../src/app.js');
  const { migrar } = await import('../src/db/migrate.js');
  const { query, fecharPool } = await import('../src/db/index.js');

  await migrar();
  /* usuarios entra na limpeza porque esta suite entra pela credencial do
     ambiente, que so vale enquanto nao existe nenhuma conta cadastrada. */
  await query('TRUNCATE vendas, eventos, sessoes, leads, visitantes, usuarios RESTART IDENTITY CASCADE');

  const servidor = criarApp().listen(0);
  await new Promise((resolve) => servidor.once('listening', resolve));
  const base = `http://127.0.0.1:${servidor.address().port}`;

  let cookie = '';

  const chamar = (rota, opcoes = {}) =>
    fetch(base + rota, {
      method: opcoes.method || 'GET',
      headers: {
        ...(opcoes.body ? { 'Content-Type': opcoes.tipo || 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
        ...(opcoes.headers || {})
      },
      body: opcoes.body ? (typeof opcoes.body === 'string' ? opcoes.body : JSON.stringify(opcoes.body)) : undefined
    });

  test.after(async () => {
    servidor.close();
    await fecharPool();
  });

  const UTM = { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'imoveis-nh', gclid: 'GC-1' };

  test('registra a jornada do visitante anonimo com a campanha de origem', async () => {
    const resposta = await chamar('/api/track', {
      method: 'POST',
      body: {
        visitante_uid: 'visitante-teste-1',
        sessao_uid: 'sessao-teste-1',
        pagina: 'https://site.com.br/',
        referrer: 'https://google.com/',
        utm: UTM,
        tempo_ativo_segundos: 95,
        eventos: [
          { tipo: 'pageview', dados: { titulo: 'Landing' } },
          { tipo: 'scroll', dados: { profundidade: 50 } },
          { tipo: 'form_inicio', dados: {} }
        ]
      }
    });
    assert.equal(resposta.status, 202);

    const { rows } = await query('SELECT * FROM visitantes WHERE visitante_uid = $1', ['visitante-teste-1']);
    assert.equal(rows[0].campanha, 'imoveis-nh', 'campanha deve sair da utm_campaign');
    assert.equal(rows[0].origem, 'google');
    assert.equal(rows[0].campanha_id, 'gc-1', 'gclid deve virar o id da campanha');

    const sessao = await query('SELECT * FROM sessoes WHERE sessao_uid = $1', ['sessao-teste-1']);
    assert.equal(sessao.rows[0].duracao_segundos, 95, 'tempo de permanencia deve ser gravado');
    assert.equal(sessao.rows[0].total_eventos, 3);
  });

  test('lote enviado como text/plain (sendBeacon) tambem e aceito', async () => {
    const resposta = await chamar('/api/track', {
      method: 'POST',
      tipo: 'text/plain',
      body: JSON.stringify({
        visitante_uid: 'visitante-teste-1',
        sessao_uid: 'sessao-teste-1',
        utm: UTM,
        tempo_ativo_segundos: 150,
        eventos: [{ tipo: 'saida', dados: { motivo: 'saiu-da-pagina' } }]
      })
    });
    assert.equal(resposta.status, 202);

    const { rows } = await query('SELECT duracao_segundos FROM sessoes WHERE sessao_uid = $1', ['sessao-teste-1']);
    assert.equal(rows[0].duracao_segundos, 150, 'o maior tempo reportado vence');
  });

  test('payload de rastreamento invalido nao derruba a pagina', async () => {
    const resposta = await chamar('/api/track', { method: 'POST', body: { visitante_uid: 'x' } });
    assert.equal(resposta.status, 202, 'tracking nunca devolve erro ao navegador');
    assert.equal((await resposta.json()).ignorado, true);
  });

  test('conversao do formulario liga o lead ao visitante e a campanha', async () => {
    const resposta = await chamar('/api/leads', {
      method: 'POST',
      body: {
        nome: 'Joana Pereira',
        whatsapp: '(51) 98888-7777',
        email: 'joana@exemplo.com',
        cidade: 'Novo Hamburgo',
        objetivo: 'investir',
        tipo_imovel: 'casa',
        utm: UTM,
        visitante_uid: 'visitante-teste-1',
        sessao_uid: 'sessao-teste-1'
      }
    });
    assert.equal(resposta.status, 201);

    const { rows } = await query('SELECT * FROM leads WHERE email = $1', ['joana@exemplo.com']);
    assert.ok(rows[0].visitante_id, 'lead deve apontar para o visitante');
    assert.ok(rows[0].sessao_id, 'lead deve apontar para a sessao');
    assert.equal(rows[0].campanha, 'imoveis-nh');
    assert.equal(rows[0].campanha_id, 'gc-1');

    const visitante = await query('SELECT convertido FROM visitantes WHERE visitante_uid = $1', ['visitante-teste-1']);
    assert.equal(visitante.rows[0].convertido, true);
  });

  test('painel exige login e recusa senha errada', async () => {
    assert.equal((await chamar('/api/admin/metricas')).status, 401);

    const recusado = await chamar('/api/admin/login', {
      method: 'POST',
      body: { email: 'dev@pushagencia.com.br', senha: 'errada' }
    });
    assert.equal(recusado.status, 401);

    const aceito = await chamar('/api/admin/login', {
      method: 'POST',
      body: { email: 'dev@pushagencia.com.br', senha: 'senha-de-teste' }
    });
    assert.equal(aceito.status, 200);

    const definido = aceito.headers.get('set-cookie');
    assert.match(definido, /painel_sessao=/);
    assert.match(definido, /HttpOnly/i, 'o cookie de sessao nao pode ser lido por script');
    cookie = definido.split(';')[0];

    const eu = await chamar('/api/admin/eu');
    assert.equal((await eu.json()).usuario.email, 'dev@pushagencia.com.br');
  });

  test('metricas trazem acessos, conversoes, tempo medio e o funil', async () => {
    const corpo = await (await chamar('/api/admin/metricas?dias=30')).json();
    const m = corpo.metricas;

    assert.equal(m.acessos, 1);
    assert.equal(m.visitantes, 1);
    assert.equal(m.conversoes, 1);
    assert.equal(m.tempo_medio_segundos, 150, 'tempo medio vem da duracao das sessoes');
    assert.equal(m.taxa_conversao, 100);
    assert.equal(m.funil.iniciaram_formulario, 1);
    assert.equal(m.funil.converteram, 1);
    assert.equal(m.serie.length, 31, 'a serie preenche todos os dias do periodo');

    /* Os cards de 7 / 30 / 90 dias vem juntos na mesma resposta. */
    for (const chave of ['acessos_7', 'acessos_30', 'acessos_90', 'conversoes_7', 'conversoes_30', 'conversoes_90']) {
      assert.equal(typeof corpo.janelas[chave], 'number', `janela ${chave} ausente`);
    }
  });

  test('relatorio por campanha cruza trafego e leads', async () => {
    const { campanhas } = await (await chamar('/api/admin/campanhas?dias=30')).json();
    const campanha = campanhas.find((item) => item.campanha === 'imoveis-nh');

    assert.ok(campanha, 'campanha deveria aparecer no relatorio');
    assert.equal(campanha.acessos, 1);
    assert.equal(campanha.leads, 1);
    assert.equal(campanha.taxa_conversao, 100);
  });

  test('lista de visitantes mostra a campanha e a jornada completa', async () => {
    const lista = await (await chamar('/api/admin/visitantes?dias=30')).json();
    assert.equal(lista.visitantes.length, 1);
    assert.equal(lista.visitantes[0].campanha, 'imoveis-nh');
    assert.equal(lista.visitantes[0].lead_nome, 'Joana Pereira');

    const jornada = await (await chamar(`/api/admin/visitantes/${lista.visitantes[0].id}`)).json();
    assert.equal(jornada.sessoes.length, 1);
    const tipos = jornada.sessoes[0].eventos.map((evento) => evento.tipo);
    assert.deepEqual(tipos, ['pageview', 'scroll', 'form_inicio', 'saida']);

    /* Filtro de convertidos continua encontrando o visitante. */
    const convertidos = await (await chamar('/api/admin/visitantes?dias=30&convertido=true')).json();
    assert.equal(convertidos.total, 1);
    const naoConvertidos = await (await chamar('/api/admin/visitantes?dias=30&convertido=false')).json();
    assert.equal(naoConvertidos.total, 0);
  });

  test('marcar a tag vendido registra a venda e gera o evento de conversao', async () => {
    const { rows } = await query('SELECT id FROM leads WHERE email = $1', ['joana@exemplo.com']);
    const id = rows[0].id;

    const resposta = await chamar(`/api/leads/${id}/tags`, {
      method: 'PUT',
      body: { tags: ['quente', 'vendido'], valor_venda: 450000 }
    });
    assert.equal(resposta.status, 200);

    const corpo = await resposta.json();
    assert.deepEqual(corpo.lead.tags, ['quente', 'vendido']);
    assert.equal(corpo.lead.status, 'convertido');
    assert.ok(corpo.lead.vendido_em, 'a data da venda deve ser gravada');
    assert.ok(corpo.venda.evento_uid, 'a venda precisa de um id de evento para deduplicar no pixel');
    assert.equal(Number(corpo.lead.valor_venda), 450000);

    /* Sem token configurado o envio nao falha: fica registrado como pendente. */
    assert.equal(corpo.integracoes.meta.status, 'nao_configurado');
    assert.equal(corpo.integracoes.ga4.status, 'nao_configurado');

    const vendas = await query('SELECT count(*)::int AS total FROM vendas WHERE lead_id = $1', [id]);
    assert.equal(vendas.rows[0].total, 1);
  });

  test('remarcar vendido nao duplica a venda e desmarcar desfaz', async () => {
    const { rows } = await query('SELECT id FROM leads WHERE email = $1', ['joana@exemplo.com']);
    const id = rows[0].id;

    await chamar(`/api/leads/${id}/tags`, { method: 'PUT', body: { tags: ['vendido'] } });
    const vendas = await query('SELECT count(*)::int AS total FROM vendas WHERE lead_id = $1', [id]);
    assert.equal(vendas.rows[0].total, 1, 'salvar de novo nao pode criar outra venda');

    const resposta = await chamar(`/api/leads/${id}/tags`, { method: 'PUT', body: { tags: ['morno'] } });
    const corpo = await resposta.json();
    assert.deepEqual(corpo.lead.tags, ['morno']);
    assert.equal(corpo.lead.vendido_em, null);

    const depois = await query('SELECT count(*)::int AS total FROM vendas WHERE lead_id = $1', [id]);
    assert.equal(depois.rows[0].total, 0);
  });

  test('filtro por tag e lista de tags disponiveis', async () => {
    const { rows } = await query('SELECT id FROM leads WHERE email = $1', ['joana@exemplo.com']);
    await chamar(`/api/leads/${rows[0].id}/tags`, { method: 'PUT', body: { tags: ['quente'] } });

    const filtrados = await (await chamar('/api/leads?tag=quente')).json();
    assert.equal(filtrados.total, 1);

    const semTag = await (await chamar('/api/leads?tag=inexistente')).json();
    assert.equal(semTag.total, 0);

    const { tags } = await (await chamar('/api/leads/tags')).json();
    assert.ok(tags.some((item) => item.tag === 'quente'));
  });

  test('serve o script de rastreamento em /track.js', async () => {
    const script = await fetch(`${base}/track.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /javascript/);
    assert.match(await script.text(), /window\.rastreio/);
  });

  test('logout invalida a sessao do painel', async () => {
    const saida = await chamar('/api/admin/logout', { method: 'POST' });
    assert.equal(saida.status, 200);

    cookie = '';
    assert.equal((await chamar('/api/admin/metricas')).status, 401);
  });
}
