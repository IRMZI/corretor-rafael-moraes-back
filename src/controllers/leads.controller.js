import { ErroHttp } from '../middlewares/erros.js';
import { logger } from '../utils/logger.js';
import {
  leadSchema,
  listarLeadsSchema,
  atualizarStatusSchema,
  definirTagsSchema
} from '../validators/lead.schema.js';
import * as leads from '../services/leads.service.js';
import { marcarConversao } from '../services/tracking.service.js';
import { identificarCampanha } from '../utils/campanha.js';
import * as vendas from '../services/vendas.service.js';
import { jornadaDoVisitante } from '../services/metricas.service.js';

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

  /* Fecha o ciclo do rastreamento: o visitante anonimo vira conversao. */
  const { visitanteId, sessaoId } = await marcarConversao(dados.visitante_uid, dados.sessao_uid);
  const campanha = identificarCampanha(dados.utm, dados.referrer);

  const lead = await leads.criarLead({
    ...dados,
    whatsapp_numeros: whatsappNumeros,
    visitante_id: visitanteId,
    sessao_id: sessaoId,
    campanha: campanha.campanha,
    origem_trafego: campanha.origem,
    midia: campanha.midia,
    campanha_id: campanha.campanha_id,
    ip: req.ip,
    user_agent: req.get('user-agent')?.slice(0, 500) || null
  });

  logger.info('Novo lead recebido', { id: lead.id, campanha: lead.campanha, cidade: lead.cidade });

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

  /* O painel abre o lead ja com a jornada do visitante e a venda, se houver. */
  const [jornada, venda] = await Promise.all([
    lead.visitante_id ? jornadaDoVisitante(lead.visitante_id) : null,
    vendas.buscarVendaDoLead(lead.id)
  ]);

  return res.json({
    ok: true,
    lead,
    venda,
    jornada: jornada ? { visitante: jornada.visitante, sessoes: jornada.sessoes } : null
  });
}

/* Tags da conversao. Marcar "vendido" dispara o evento de venda;
   desmarcar desfaz o registro. */
export async function salvarTags(req, res) {
  const id = idValido(req.params.id);
  const resultado = definirTagsSchema.safeParse(req.body ?? {});
  if (!resultado.success) throw erroDeValidacao(resultado);

  const { tags, valor_venda: valorVenda } = resultado.data;
  const anterior = await leads.buscarLeadPorId(id);
  if (!anterior) throw new ErroHttp(404, 'Lead nao encontrado.');

  const estavaVendido = anterior.tags.includes(vendas.TAG_VENDIDO);
  const ficouVendido = tags.includes(vendas.TAG_VENDIDO);

  let lead = await leads.definirTags(id, tags);
  let venda = null;
  let integracoes = null;

  if (ficouVendido) {
    const registro = await vendas.registrarVenda(id, { valor: valorVenda ?? null });
    if (registro) {
      venda = registro.venda;
      /* So dispara o evento na primeira marcacao: reenvio e acao explicita. */
      if (!registro.jaExistia) integracoes = await vendas.dispararEventoVenda(registro.lead, registro.venda);
      lead = await leads.buscarLeadPorId(id);
    }
  } else if (estavaVendido) {
    await vendas.desfazerVenda(id);
    lead = await leads.buscarLeadPorId(id);
  }

  return res.json({ ok: true, lead, venda, integracoes });
}

/* Reenvio manual do evento de venda (quando a Meta/GA4 falhou ou o token mudou). */
export async function reenviarVenda(req, res) {
  const id = idValido(req.params.id);
  const lead = await leads.buscarLeadPorId(id);
  if (!lead) throw new ErroHttp(404, 'Lead nao encontrado.');

  const venda = await vendas.buscarVendaDoLead(id);
  if (!venda) throw new ErroHttp(409, 'Este lead ainda nao esta marcado como vendido.');

  const integracoes = await vendas.dispararEventoVenda(lead, venda);
  return res.json({ ok: true, venda: { ...venda, integracoes }, integracoes });
}

export async function listarTags(_req, res) {
  return res.json({ ok: true, tags: await leads.tagsExistentes() });
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
