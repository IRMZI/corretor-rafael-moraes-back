import { query } from '../db/index.js';
import { env } from '../config/env.js';

const COLUNAS = `
  id, nome, email, whatsapp, whatsapp_numeros, cidade, objetivo, tipo_imovel,
  faixa_investimento, origem, pagina, referrer, utm, status, observacoes,
  enviado_em, criado_em, atualizado_em
`;

/* Reenvio do mesmo formulario (duplo clique, refresh) nao vira lead novo:
   dentro da janela configurada devolvemos o lead ja gravado. */
export async function buscarDuplicado(whatsappNumeros) {
  const { rows } = await query(
    `SELECT ${COLUNAS}
       FROM leads
      WHERE whatsapp_numeros = $1
        AND criado_em > now() - ($2 || ' minutes')::interval
      ORDER BY criado_em DESC
      LIMIT 1`,
    [whatsappNumeros, String(env.dedupeWindowMinutes)]
  );
  return rows[0] || null;
}

export async function criarLead(lead) {
  const { rows } = await query(
    `INSERT INTO leads
       (nome, email, whatsapp, whatsapp_numeros, cidade, objetivo, tipo_imovel,
        faixa_investimento, origem, pagina, referrer, utm, enviado_em, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15)
     RETURNING ${COLUNAS}`,
    [
      lead.nome,
      lead.email,
      lead.whatsapp,
      lead.whatsapp_numeros,
      lead.cidade,
      lead.objetivo,
      lead.tipo_imovel,
      lead.faixa_investimento,
      lead.origem,
      lead.pagina,
      lead.referrer,
      JSON.stringify(lead.utm || {}),
      lead.enviado_em,
      lead.ip,
      lead.user_agent
    ]
  );
  return rows[0];
}

export async function listarLeads(filtros) {
  const condicoes = [];
  const valores = [];

  /* Cada filtro vira um placeholder proprio ($1, $2...): nada de interpolar
     valor do usuario dentro do SQL. */
  const proximo = (valor) => {
    valores.push(valor);
    return `$${valores.length}`;
  };

  if (filtros.status) condicoes.push(`status = ${proximo(filtros.status)}`);
  if (filtros.objetivo) condicoes.push(`objetivo = ${proximo(filtros.objetivo)}`);
  if (filtros.tipo_imovel) condicoes.push(`tipo_imovel = ${proximo(filtros.tipo_imovel)}`);
  if (filtros.desde) condicoes.push(`criado_em >= ${proximo(filtros.desde)}`);
  if (filtros.ate) condicoes.push(`criado_em <= ${proximo(filtros.ate)}`);
  if (filtros.busca) {
    const termo = proximo(`%${filtros.busca}%`);
    condicoes.push(
      `(nome ILIKE ${termo} OR email ILIKE ${termo} OR whatsapp_numeros ILIKE ${termo} OR cidade ILIKE ${termo})`
    );
  }

  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
  const limite = proximo(filtros.por_pagina);
  const deslocamento = proximo((filtros.pagina - 1) * filtros.por_pagina);

  const { rows } = await query(
    `SELECT ${COLUNAS}, count(*) OVER () AS total_registros
       FROM leads
       ${where}
      ORDER BY criado_em DESC
      LIMIT ${limite} OFFSET ${deslocamento}`,
    valores
  );

  const total = rows.length ? Number(rows[0].total_registros) : 0;
  const leads = rows.map(({ total_registros, ...lead }) => lead);

  return {
    leads,
    paginacao: {
      pagina: filtros.pagina,
      por_pagina: filtros.por_pagina,
      total,
      total_paginas: Math.max(1, Math.ceil(total / filtros.por_pagina))
    }
  };
}

export async function buscarLeadPorId(id) {
  const { rows } = await query(`SELECT ${COLUNAS} FROM leads WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function atualizarStatus(id, { status, observacoes }) {
  const { rows } = await query(
    `UPDATE leads
        SET status = $2,
            observacoes = COALESCE($3, observacoes)
      WHERE id = $1
      RETURNING ${COLUNAS}`,
    [id, status, observacoes ?? null]
  );
  return rows[0] || null;
}

export async function resumoLeads() {
  const [porStatus, porObjetivo, totais] = await Promise.all([
    query('SELECT status, count(*)::int AS total FROM leads GROUP BY status ORDER BY total DESC'),
    query('SELECT objetivo, count(*)::int AS total FROM leads GROUP BY objetivo ORDER BY total DESC'),
    query(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE criado_em > now() - interval '24 hours')::int AS ultimas_24h,
             count(*) FILTER (WHERE criado_em > now() - interval '7 days')::int  AS ultimos_7_dias,
             count(*) FILTER (WHERE criado_em > now() - interval '30 days')::int AS ultimos_30_dias
        FROM leads
    `)
  ]);

  return {
    ...totais.rows[0],
    por_status: porStatus.rows,
    por_objetivo: porObjetivo.rows
  };
}
