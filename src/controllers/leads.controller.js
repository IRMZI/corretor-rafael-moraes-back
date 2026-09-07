import { ErroHttp } from '../middlewares/erros.js';
import { logger } from '../utils/logger.js';
import { leadSchema, listarLeadsSchema, atualizarStatusSchema } from '../validators/lead.schema.js';
import * as leads from '../services/leads.service.js';

/* Traduz o erro do zod para um objeto { campo: mensagem }, no formato
   que a landing page consegue exibir campo a campo. */
function erroDeValidacao(resultado) {
  const detalhes = {};
  for (const problema of resultado.error.issues) {
    const campo = problema.path.join('.') || 'payload';
    if (!detalhes[campo]) detalhes[campo] = problema.message;
  }
  return new ErroHttp(422, 'Dados invalidos.', detalhes);
}

function idValido(valor) {
  const id = Number.parseInt(valor, 10);
  if (!Number.isInteger(id) || id < 1) throw new ErroHttp(400, 'Id invalido.');
  return id;
}

export async function receberLead(req, res) {
  /* Honeypot: campo escondido no formulario. Se veio preenchido e robo.
     Respondemos 202 para o robo achar que deu certo e nao ficar tentando. */
  if (typeof req.body?.empresa === 'string' && req.body.empresa.trim() !== '') {
    logger.warn('Lead descartado pelo honeypot', { ip: req.ip });
    return res.status(202).json({ ok: true, mensagem: 'Recebido.' });
  }

  const resultado = leadSchema.safeParse(req.body ?? {});
  if (!resultado.success) throw erroDeValidacao(resultado);

  const dados = resultado.data;
  const whatsappNumeros = dados.whatsapp.replace(/\D/g, '');

  const duplicado = await leads.buscarDuplicado(whatsappNumeros);
  if (duplicado) {
    logger.info('Lead duplicado ignorado', { id: duplicado.id });
    return res.status(200).json({ ok: true, duplicado: true, lead: { id: duplicado.id, criado_em: duplicado.criado_em } });
  }

  const lead = await leads.criarLead({
    ...dados,
    whatsapp_numeros: whatsappNumeros,
    ip: req.ip,
    user_agent: req.get('user-agent')?.slice(0, 500) || null
  });

  logger.info('Novo lead recebido', { id: lead.id, objetivo: lead.objetivo, cidade: lead.cidade });

  return res.status(201).json({
    ok: true,
    mensagem: 'Lead recebido com sucesso.',
    lead: { id: lead.id, criado_em: lead.criado_em }
  });
}

export async function listar(req, res) {
  const resultado = listarLeadsSchema.safeParse(req.query);
  if (!resultado.success) throw erroDeValidacao(resultado);

  const { leads: registros, paginacao } = await leads.listarLeads(resultado.data);
  return res.json({ ok: true, ...paginacao, leads: registros });
}

export async function detalhar(req, res) {
  const lead = await leads.buscarLeadPorId(idValido(req.params.id));
  if (!lead) throw new ErroHttp(404, 'Lead nao encontrado.');
  return res.json({ ok: true, lead });
}

export async function atualizar(req, res) {
  const resultado = atualizarStatusSchema.safeParse(req.body ?? {});
  if (!resultado.success) throw erroDeValidacao(resultado);

  const lead = await leads.atualizarStatus(idValido(req.params.id), resultado.data);
  if (!lead) throw new ErroHttp(404, 'Lead nao encontrado.');
  return res.json({ ok: true, lead });
}

export async function resumo(_req, res) {
  return res.json({ ok: true, resumo: await leads.resumoLeads() });
}
