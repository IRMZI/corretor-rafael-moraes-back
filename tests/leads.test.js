import test from 'node:test';
import assert from 'node:assert/strict';

/* Testes de integracao: precisam de um PostgreSQL de verdade.
   Aponte TEST_DATABASE_URL (ou DATABASE_URL) para um banco descartavel -
   a tabela leads e esvaziada no inicio da suite.
   Sem banco configurado, a suite e ignorada em vez de falhar. */
const urlBanco = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

if (!urlBanco) {
  test('testes de integracao ignorados: defina TEST_DATABASE_URL', { skip: true }, () => {});
} else {
  process.env.DATABASE_URL = urlBanco;
  process.env.NODE_ENV = 'test';
  process.env.ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'chave-de-teste';
  process.env.CORS_ORIGINS = '';
  process.env.RATE_LIMIT_MAX = '1000';

  const { criarApp } = await import('../src/app.js');
  const { migrar } = await import('../src/db/migrate.js');
  const { query, fecharPool } = await import('../src/db/index.js');

  await migrar();
  await query('TRUNCATE vendas, eventos, sessoes, leads, visitantes RESTART IDENTITY CASCADE');

  const servidor = criarApp().listen(0);
  await new Promise((resolve) => servidor.once('listening', resolve));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const chave = process.env.ADMIN_API_KEY;

  const enviar = (corpo, extras = {}) =>
    fetch(`${base}/api/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extras },
      body: JSON.stringify(corpo)
    });

  const leadValido = (sobrescreve = {}) => ({
    nome: 'Maria Souza',
    whatsapp: '(51) 98765-4321',
    email: 'Maria@Exemplo.com',
    cidade: 'Novo Hamburgo',
    objetivo: 'comprar',
    tipo_imovel: 'apartamento',
    faixa_investimento: '500k-800k',
    origem: 'landing-page',
    pagina: 'https://site.com.br/',
    referrer: 'https://google.com/',
    utm: { utm_source: 'google', gclid: 'abc123' },
    enviado_em: '2026-01-01T12:00:00.000Z',
    ...sobrescreve
  });

  test.after(async () => {
    servidor.close();
    await fecharPool();
  });

  test('healthcheck responde com o banco conectado', async () => {
    const resposta = await fetch(`${base}/health`);
    assert.equal(resposta.status, 200);
    assert.equal((await resposta.json()).banco, 'conectado');
  });

  test('grava o lead da landing page e normaliza os dados', async () => {
    const resposta = await enviar(leadValido());
    assert.equal(resposta.status, 201);

    const { lead } = await resposta.json();
    const { rows } = await query('SELECT * FROM leads WHERE id = $1', [lead.id]);

    assert.equal(rows[0].email, 'maria@exemplo.com', 'e-mail deve ser gravado em minusculas');
    assert.equal(rows[0].whatsapp_numeros, '51987654321', 'whatsapp deve virar somente digitos');
    assert.equal(rows[0].utm.gclid, 'abc123', 'utm deve ser gravado como jsonb');
    assert.equal(rows[0].status, 'novo');
  });

  test('reenvio do mesmo whatsapp na janela nao duplica o lead', async () => {
    const resposta = await enviar(leadValido({ email: 'outro@exemplo.com' }));
    assert.equal(resposta.status, 200);
    assert.equal((await resposta.json()).duplicado, true);

    const { rows } = await query("SELECT count(*)::int AS total FROM leads WHERE whatsapp_numeros = '51987654321'");
    assert.equal(rows[0].total, 1);
  });

  test('recusa payload invalido apontando cada campo', async () => {
    const resposta = await enviar({ nome: 'Ana', whatsapp: '123', email: 'invalido', cidade: '' });
    assert.equal(resposta.status, 422);

    const { detalhes } = await resposta.json();
    for (const campo of ['nome', 'whatsapp', 'email', 'cidade', 'objetivo', 'tipo_imovel']) {
      assert.ok(detalhes[campo], `deveria apontar erro em ${campo}`);
    }
  });

  test('honeypot preenchido nao vira lead', async () => {
    const antes = await query('SELECT count(*)::int AS total FROM leads');
    const resposta = await enviar(leadValido({ whatsapp: '(51) 90000-0000', empresa: 'robo' }));
    assert.equal(resposta.status, 202);

    const depois = await query('SELECT count(*)::int AS total FROM leads');
    assert.equal(depois.rows[0].total, antes.rows[0].total);
  });

  test('consulta de leads exige a chave administrativa', async () => {
    assert.equal((await fetch(`${base}/api/leads`)).status, 401);
    assert.equal((await fetch(`${base}/api/leads`, { headers: { 'x-api-key': 'errada' } })).status, 401);

    const resposta = await fetch(`${base}/api/leads`, { headers: { 'x-api-key': chave } });
    assert.equal(resposta.status, 200);
    assert.ok((await resposta.json()).leads.length > 0);
  });

  test('lista filtra por busca e pagina os resultados', async () => {
    await enviar(leadValido({ nome: 'Joao Pereira', whatsapp: '(51) 93333-4444', email: 'joao@exemplo.com', cidade: 'Campo Bom' }));

    const resposta = await fetch(`${base}/api/leads?busca=joao&por_pagina=1`, { headers: { 'x-api-key': chave } });
    const corpo = await resposta.json();

    assert.equal(corpo.total, 1);
    assert.equal(corpo.por_pagina, 1);
    assert.equal(corpo.leads[0].nome, 'Joao Pereira');
  });

  test('atualiza o status do lead e devolve 404 para id inexistente', async () => {
    const { rows } = await query('SELECT id FROM leads ORDER BY id LIMIT 1');

    const resposta = await fetch(`${base}/api/leads/${rows[0].id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-api-key': chave },
      body: JSON.stringify({ status: 'em_contato', observacoes: 'retornar amanha' })
    });
    assert.equal(resposta.status, 200);

    const { lead } = await resposta.json();
    assert.equal(lead.status, 'em_contato');
    assert.equal(lead.observacoes, 'retornar amanha');

    const inexistente = await fetch(`${base}/api/leads/999999`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-api-key': chave },
      body: JSON.stringify({ status: 'novo' })
    });
    assert.equal(inexistente.status, 404);
  });

  test('resumo devolve os totais por status', async () => {
    const resposta = await fetch(`${base}/api/leads/resumo`, { headers: { 'x-api-key': chave } });
    const { resumo } = await resposta.json();

    assert.ok(resumo.total >= 2);
    assert.ok(Array.isArray(resumo.por_status));
  });
}
