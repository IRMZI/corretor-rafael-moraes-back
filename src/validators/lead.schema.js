import { z } from 'zod';

/* objetivo, tipo_imovel e faixa_investimento chegam dos <select> da landing page
   (comprar/vender/investir/alugar/pesquisando, apartamento/casa/terreno/...).
   Sao validados como texto livre de proposito: se o formulario ganhar uma opcao
   nova, o lead continua entrando em vez de ser recusado.
   Ja o status e interno e fechado - precisa casar com o CHECK da tabela leads. */
export const STATUS = ['novo', 'em_contato', 'qualificado', 'convertido', 'descartado'];

const texto = (max) => z.string().trim().max(max);
const opcional = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((valor) => valor || null)
    .nullable()
    .optional()
    .catch(null);

export const leadSchema = z.object({
  nome: texto(120)
    .min(5, 'Informe seu nome completo.')
    .refine((valor) => valor.split(/\s+/).length >= 2, 'Informe nome e sobrenome.'),

  email: texto(160).pipe(z.email('Informe um e-mail valido.')).transform((v) => v.toLowerCase()),

  whatsapp: texto(30)
    .min(10, 'Informe um WhatsApp valido com DDD.')
    .refine((valor) => valor.replace(/\D/g, '').length >= 10, 'Informe um WhatsApp valido com DDD.')
    .refine((valor) => valor.replace(/\D/g, '').length <= 15, 'WhatsApp com digitos demais.'),

  cidade: texto(120).min(2, 'Informe a cidade ou regiao desejada.'),

  objetivo: texto(40).min(1, 'Selecione o que voce procura.'),
  tipo_imovel: texto(40).min(1, 'Selecione o tipo de imovel.'),
  faixa_investimento: opcional(40),

  origem: texto(60).default('landing-page').catch('landing-page'),
  pagina: opcional(500),
  referrer: opcional(500),

  utm: z
    .record(z.string().max(80), z.string().max(300))
    .default({})
    .catch({}),

  enviado_em: z
    .string()
    .datetime()
    .nullable()
    .optional()
    .catch(null),

  /* Ids do track.js: ligam a conversao ao visitante anonimo e a sua jornada. */
  visitante_uid: z.string().trim().max(64).nullable().optional().catch(null),
  sessao_uid: z.string().trim().max(64).nullable().optional().catch(null),

  /* Honeypot: preenchido = robo. Validado no controller, nao aqui. */
  empresa: z.string().max(200).optional()
});

/* Filtros da listagem administrativa. */
export const listarLeadsSchema = z.object({
  pagina: z.coerce.number().int().min(1).default(1).catch(1),
  por_pagina: z.coerce.number().int().min(1).max(100).default(20).catch(20),
  status: z.enum(STATUS).optional(),
  objetivo: z.string().trim().max(40).optional(),
  tipo_imovel: z.string().trim().max(40).optional(),
  busca: z.string().trim().max(120).optional(),
  tag: z.string().trim().max(40).optional(),
  campanha: z.string().trim().max(120).optional(),
  desde: z.string().datetime().optional(),
  ate: z.string().datetime().optional()
});

export const definirTagsSchema = z.object({
  tags: z
    .array(z.string().trim().min(1).max(40).toLowerCase())
    .max(20)
    .transform((tags) => [...new Set(tags)]),
  valor_venda: z.coerce.number().min(0).max(1_000_000_000).nullable().optional().catch(null)
});

export const atualizarStatusSchema = z.object({
  status: z.enum(STATUS, 'Status invalido.'),
  observacoes: z.string().trim().max(2000).nullable().optional()
});
