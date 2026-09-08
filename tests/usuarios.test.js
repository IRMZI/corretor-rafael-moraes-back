import test from 'node:test';
import assert from 'node:assert/strict';

/* Contas do painel: hash da senha, login pelo banco, revogacao e a credencial
   do ambiente como reserva enquanto nao existe nenhuma conta.

   Os testes de hash rodam sempre. Os de login precisam de um PostgreSQL
   descartavel em TEST_DATABASE_URL (ou DATABASE_URL). */

/* O env.js le as variaveis no momento do import, entao elas precisam estar de
   pe antes de qualquer import do src. */
const urlBanco = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAIL = 'dev@pushagencia.com.br';
process.env.ADMIN_PASSWORD = 'senha-do-ambiente';
process.env.SESSION_SECRET = 'segredo-de-teste';
process.env.CORS_ORIGINS = '';
process.env.RATE_LIMIT_MAX = '1000';
if (urlBanco) process.env.DATABASE_URL = urlBanco;

const { gerarHash, conferirSenha } = await import('../src/services/usuarios.service.js');

test('a senha guardada e um hash scrypt, nao o texto digitado', async () => {
  const hash = await gerarHash('senha-do-corretor');
  assert.ok(hash.startsWith('scrypt$'), 'o hash deve identificar o algoritmo e o custo');
  assert.ok(!hash.includes('senha-do-corretor'), 'a senha nao pode aparecer no hash');
});

test('hashes da mesma senha sao diferentes entre si', async () => {
  const [a, b] = await Promise.all([gerarHash('mesma-senha'), gerarHash('mesma-senha')]);
  assert.notEqual(a, b, 'cada hash tem seu proprio salt');
  assert.equal(await conferirSenha('mesma-senha', a), true);
  assert.equal(await conferirSenha('mesma-senha', b), true);
});

test('confere a senha certa e recusa a errada', async () => {
  const hash = await gerarHash('senha-correta');
  assert.equal(await conferirSenha('senha-correta', hash), true);
  assert.equal(await conferirSenha('senha-errada', hash), false);
  assert.equal(await conferirSenha('', hash), false);
});

test('hash corrompido devolve false em vez de estourar', async () => {
  for (const invalido of ['', 'texto-solto', 'scrypt$1$2$3', 'md5$16384$8$1$aaaa$bbbb', null]) {
    assert.equal(await conferirSenha('qualquer', invalido), false, `hash invalido: ${invalido}`);
  }
});

if (!urlBanco) {
  test('testes de login ignorados: defina TEST_DATABASE_URL', { skip: true }, () => {});
} else {
  const { criarApp } = await import('../src/app.js');
  const { migrar } = await import('../src/db/migrate.js');
  const { query, fecharPool } = await import('../src/db/index.js');
  const usuarios = await import('../src/services/usuarios.service.js');

  await migrar();
  await query('TRUNCATE usuarios RESTART IDENTITY');

  const servidor = criarApp().listen(0);
  await new Promise((resolve) => servidor.once('listening', resolve));
  const base = `http://127.0.0.1:${servidor.address().port}`;

  const chamar = (rota, opcoes = {}) =>
    fetch(base + rota, {
      method: opcoes.method || 'GET',
      headers: {
        ...(opcoes.body ? { 'Content-Type': 'application/json' } : {}),
        ...(opcoes.cookie ? { cookie: opcoes.cookie } : {})
      },
      body: opcoes.body ? JSON.stringify(opcoes.body) : undefined
    });

  const entrar = (email, senha) => chamar('/api/admin/login', { method: 'POST', body: { email, senha } });
  const cookieDe = (resposta) => (resposta.headers.get('set-cookie') || '').split(';')[0];

  test.after(async () => {
    /* Devolve a tabela vazia: outras suites entram pela credencial do ambiente,
       que so vale enquanto nao existe conta cadastrada. */
    await query('TRUNCATE usuarios RESTART IDENTITY');
    servidor.close();
    await fecharPool();
  });

  test('sem contas cadastradas, a credencial do ambiente ainda entra', async () => {
    const resposta = await entrar('dev@pushagencia.com.br', 'senha-do-ambiente');
    assert.equal(resposta.status, 200);

    const sessao = await chamar('/api/admin/eu', { cookie: cookieDe(resposta) });
    assert.equal(sessao.status, 200, 'a sessao aberta pelo ambiente deve valer');
  });

  test('conta criada entra com a propria senha', async () => {
    await usuarios.salvarUsuario({
      email: 'Rafael@WallStreet.com.br',
      nome: 'Rafael Moraes',
      senha: 'senha-do-rafael'
    });

    const resposta = await entrar('rafael@wallstreet.com.br', 'senha-do-rafael');
    assert.equal(resposta.status, 200);

    const corpo = await resposta.json();
    assert.equal(corpo.usuario.email, 'rafael@wallstreet.com.br', 'o e-mail e guardado em minusculas');
    assert.equal(corpo.usuario.nome, 'Rafael Moraes');

    const { rows } = await query('SELECT ultimo_acesso_em FROM usuarios WHERE email = $1', [
      'rafael@wallstreet.com.br'
    ]);
    assert.ok(rows[0].ultimo_acesso_em, 'o login deve registrar o ultimo acesso');
  });

  test('e-mail com caixa diferente entra igual', async () => {
    const resposta = await entrar('  RAFAEL@wallstreet.com.br ', 'senha-do-rafael');
    assert.equal(resposta.status, 200);
  });

  test('senha errada e recusada', async () => {
    const resposta = await entrar('rafael@wallstreet.com.br', 'chute');
    assert.equal(resposta.status, 401);
  });

  test('com contas cadastradas, a credencial do ambiente para de valer', async () => {
    const resposta = await entrar('dev@pushagencia.com.br', 'senha-do-ambiente');
    assert.equal(resposta.status, 401, 'a porta de reserva fecha depois da primeira conta');
  });

  test('desativar a conta corta o acesso na sessao que ja estava aberta', async () => {
    const resposta = await entrar('rafael@wallstreet.com.br', 'senha-do-rafael');
    const cookie = cookieDe(resposta);
    assert.equal((await chamar('/api/admin/eu', { cookie })).status, 200);

    await usuarios.definirAtivo('rafael@wallstreet.com.br', false);
    assert.equal(
      (await chamar('/api/admin/eu', { cookie })).status,
      401,
      'a sessao deve cair sem esperar o cookie expirar'
    );
    assert.equal((await entrar('rafael@wallstreet.com.br', 'senha-do-rafael')).status, 401);

    await usuarios.definirAtivo('rafael@wallstreet.com.br', true);
    assert.equal((await entrar('rafael@wallstreet.com.br', 'senha-do-rafael')).status, 200);
  });

  test('criar de novo com o mesmo e-mail troca a senha', async () => {
    await usuarios.salvarUsuario({ email: 'rafael@wallstreet.com.br', senha: 'senha-nova' });
    assert.equal((await entrar('rafael@wallstreet.com.br', 'senha-nova')).status, 200);
    assert.equal((await entrar('rafael@wallstreet.com.br', 'senha-do-rafael')).status, 401);

    const { rows } = await query('SELECT nome FROM usuarios WHERE email = $1', ['rafael@wallstreet.com.br']);
    assert.equal(rows[0].nome, 'Rafael Moraes', 'trocar a senha nao pode apagar o nome');
  });
}
