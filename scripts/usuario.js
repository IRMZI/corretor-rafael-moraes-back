#!/usr/bin/env node
/* Contas do painel /admin, pela linha de comando.
 *
 *   npm run usuario:criar -- --email=rafael@wallstreet.com.br --nome="Rafael Moraes"
 *   npm run usuario:criar -- --email=rafael@wallstreet.com.br --senha="uma senha boa"
 *   npm run usuario:listar
 *   npm run usuario:desativar -- --email=alguem@empresa.com.br
 *   npm run usuario:ativar -- --email=alguem@empresa.com.br
 *
 * Sem --senha, uma senha forte e sorteada e mostrada uma unica vez.
 * Rodar "criar" para um e-mail que ja existe troca a senha dele.
 */
import { randomInt } from 'node:crypto';
import 'dotenv/config';
import { migrar } from '../src/db/migrate.js';
import { fecharPool } from '../src/db/index.js';
import * as usuarios from '../src/services/usuarios.service.js';

const SENHA_MINIMA = 10;
/* Sem caracteres que se confundem ao ditar por telefone: 0/O, 1/l/I. */
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

function lerArgumentos(lista) {
  const dados = {};
  for (const item of lista) {
    const par = item.match(/^--([^=]+)=?(.*)$/);
    if (par) dados[par[1]] = par[2];
  }
  return dados;
}

function sortearSenha(tamanho = 16) {
  let senha = '';
  for (let i = 0; i < tamanho; i += 1) senha += ALFABETO[randomInt(ALFABETO.length)];
  return senha;
}

function exigirEmail(valor) {
  const email = usuarios.normalizarEmail(valor);
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) {
    throw new Error('Informe um e-mail valido em --email.');
  }
  return email;
}

function formatarData(valor) {
  return valor ? new Date(valor).toLocaleString('pt-BR') : '-';
}

async function criar(argumentos) {
  const email = exigirEmail(argumentos.email);
  const nome = argumentos.nome || null;

  let senha = argumentos.senha;
  let sorteada = false;
  if (!senha) {
    senha = sortearSenha();
    sorteada = true;
  }
  if (senha.length < SENHA_MINIMA) {
    throw new Error(`A senha precisa de pelo menos ${SENHA_MINIMA} caracteres.`);
  }

  const jaExistia = Boolean(await usuarios.buscarPorEmail(email));
  const usuario = await usuarios.salvarUsuario({ email, nome, senha });

  console.log('');
  console.log(jaExistia ? '  Senha atualizada.' : '  Conta criada.');
  console.log('  ------------------------------------------');
  console.log(`  E-mail: ${usuario.email}`);
  if (usuario.nome) console.log(`  Nome:   ${usuario.nome}`);
  if (sorteada) {
    console.log(`  Senha:  ${senha}`);
    console.log('  ------------------------------------------');
    console.log('  Esta senha nao fica guardada em lugar nenhum e nao aparece de novo.');
    console.log('  Copie agora e mande por um canal privado.');
  } else {
    console.log('  ------------------------------------------');
    console.log('  Senha definida por voce (nao e exibida aqui).');
  }
  console.log('');
  console.log('  Para trocar depois, rode o mesmo comando com o mesmo e-mail.');
  console.log('');
}

async function listar() {
  const lista = await usuarios.listarUsuarios();
  if (!lista.length) {
    console.log('\n  Nenhuma conta cadastrada. Enquanto isso, o login aceita ADMIN_EMAIL / ADMIN_PASSWORD.\n');
    return;
  }
  console.log('');
  for (const usuario of lista) {
    const situacao = usuario.ativo ? 'ativo   ' : 'inativo ';
    console.log(`  ${situacao} ${usuario.email.padEnd(34)} ultimo acesso: ${formatarData(usuario.ultimo_acesso_em)}`);
  }
  console.log(`\n  ${lista.length} conta(s).\n`);
}

async function mudarSituacao(argumentos, ativo) {
  const email = exigirEmail(argumentos.email);
  const usuario = await usuarios.definirAtivo(email, ativo);
  if (!usuario) throw new Error(`Nenhuma conta com o e-mail ${email}.`);
  console.log(`\n  ${usuario.email} agora esta ${usuario.ativo ? 'ativo' : 'inativo'}.`);
  if (!usuario.ativo) console.log('  A sessao aberta dessa pessoa para de valer na proxima requisicao.');
  console.log('');
}

const comandos = {
  criar,
  listar,
  desativar: (argumentos) => mudarSituacao(argumentos, false),
  ativar: (argumentos) => mudarSituacao(argumentos, true)
};

const [comando, ...resto] = process.argv.slice(2);

if (!comando || !comandos[comando]) {
  console.error(`\n  Use: node scripts/usuario.js <${Object.keys(comandos).join('|')}> [--email=...] [--nome=...] [--senha=...]\n`);
  process.exit(1);
}

try {
  /* Idempotente: garante a tabela mesmo em banco que ainda nao migrou. */
  await migrar();
  await comandos[comando](lerArgumentos(resto));
  await fecharPool();
} catch (erro) {
  console.error(`\n  ${erro.message}\n`);
  await fecharPool().catch(() => {});
  process.exit(1);
}
