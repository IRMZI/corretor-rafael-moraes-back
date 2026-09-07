import { query } from '../db/index.js';

/* Todas as consultas recebem os dias do periodo em $1 e montam o intervalo no
   proprio Postgres, para nao depender do fuso horario do servidor Node. */
const DESDE = "now() - ($1 || ' days')::interval";

export async function visaoGeral(dias) {
  const [totais, tempo, serie, funil] = await Promise.all([
    query(
      `SELECT
         (SELECT count(DISTINCT visitante_id)::int FROM sessoes WHERE iniciada_em > ${DESDE}) AS visitantes,
         (SELECT count(*)::int FROM sessoes  WHERE iniciada_em > ${DESDE})                     AS acessos,
         (SELECT count(*)::int FROM eventos  WHERE tipo = 'pageview' AND ocorrido_em > ${DESDE}) AS pageviews,
         (SELECT count(*)::int FROM leads    WHERE criado_em > ${DESDE})                       AS conversoes,
         (SELECT count(*)::int FROM leads    WHERE vendido_em > ${DESDE})                      AS vendas,
         (SELECT COALESCE(sum(valor_venda), 0)::float FROM leads WHERE vendido_em > ${DESDE})  AS receita`,
      [String(dias)]
    ),
    /* Tempo medio de permanencia: so sessoes com tempo ativo medido. */
    query(
      `SELECT COALESCE(round(avg(duracao_segundos))::int, 0) AS tempo_medio_segundos,
              COALESCE(round(percentile_cont(0.5) WITHIN GROUP (ORDER BY duracao_segundos))::int, 0) AS tempo_mediano_segundos
         FROM sessoes
        WHERE iniciada_em > ${DESDE} AND duracao_segundos > 0`,
      [String(dias)]
    ),
    /* Serie diaria com os dias vazios preenchidos, para o grafico nao ter buraco. */
    query(
      `WITH dias AS (
         SELECT generate_series(
           date_trunc('day', now() - ($1 || ' days')::interval),
           date_trunc('day', now()),
           interval '1 day'
         ) AS dia
       )
       SELECT to_char(dias.dia, 'YYYY-MM-DD') AS dia,
              COALESCE(a.total, 0)::int AS acessos,
              COALESCE(v.total, 0)::int AS visitantes,
              COALESCE(c.total, 0)::int AS conversoes
         FROM dias
         LEFT JOIN (
           SELECT date_trunc('day', iniciada_em) AS dia, count(*) AS total
             FROM sessoes GROUP BY 1
         ) a ON a.dia = dias.dia
         LEFT JOIN (
           SELECT date_trunc('day', iniciada_em) AS dia, count(DISTINCT visitante_id) AS total
             FROM sessoes GROUP BY 1
         ) v ON v.dia = dias.dia
         LEFT JOIN (
           SELECT date_trunc('day', criado_em) AS dia, count(*) AS total
             FROM leads GROUP BY 1
         ) c ON c.dia = dias.dia
        ORDER BY dias.dia`,
      [String(dias)]
    ),
    /* Funil: quantos passaram por cada etapa da jornada. */
    query(
      `SELECT
         count(DISTINCT s.id)::int AS sessoes,
         count(DISTINCT s.id) FILTER (WHERE e.tipo = 'scroll'
           AND (e.dados->>'profundidade')::int >= 50)::int AS rolaram_metade,
         count(DISTINCT s.id) FILTER (WHERE e.tipo = 'form_inicio')::int AS iniciaram_formulario,
         count(DISTINCT s.id) FILTER (WHERE e.tipo = 'whatsapp')::int AS clicaram_whatsapp,
         count(DISTINCT s.id) FILTER (WHERE s.convertida)::int AS converteram
         FROM sessoes s
         LEFT JOIN eventos e ON e.sessao_id = s.id
        WHERE s.iniciada_em > ${DESDE}`,
      [String(dias)]
    )
  ]);

  const geral = totais.rows[0];
  const taxa = geral.acessos > 0 ? (geral.conversoes / geral.acessos) * 100 : 0;

  return {
    periodo_dias: dias,
    ...geral,
    ...tempo.rows[0],
    taxa_conversao: Number(taxa.toFixed(2)),
    serie: serie.rows,
    funil: funil.rows[0]
  };
}

/* Comparativo pronto para os cards: 7 / 30 / 90 dias lado a lado. */
export async function acessosPorJanela() {
  const { rows } = await query(
    `SELECT
       count(*) FILTER (WHERE iniciada_em > now() - interval '7 days')::int  AS acessos_7,
       count(*) FILTER (WHERE iniciada_em > now() - interval '30 days')::int AS acessos_30,
       count(*) FILTER (WHERE iniciada_em > now() - interval '90 days')::int AS acessos_90,
       count(DISTINCT visitante_id) FILTER (WHERE iniciada_em > now() - interval '7 days')::int  AS visitantes_7,
       count(DISTINCT visitante_id) FILTER (WHERE iniciada_em > now() - interval '30 days')::int AS visitantes_30,
       count(DISTINCT visitante_id) FILTER (WHERE iniciada_em > now() - interval '90 days')::int AS visitantes_90
     FROM sessoes`
  );

  const leads = await query(
    `SELECT
       count(*) FILTER (WHERE criado_em > now() - interval '7 days')::int  AS conversoes_7,
       count(*) FILTER (WHERE criado_em > now() - interval '30 days')::int AS conversoes_30,
       count(*) FILTER (WHERE criado_em > now() - interval '90 days')::int AS conversoes_90
     FROM leads`
  );

  return { ...rows[0], ...leads.rows[0] };
}

/* Desempenho por campanha: cruza as sessoes (trafego) com os leads (resultado).
   FULL JOIN porque pode haver campanha com acesso e sem lead - e vice-versa,
   quando o lead chegou antes do script de rastreamento estar na pagina. */
export async function porCampanha(dias) {
  const { rows } = await query(
    `WITH trafego AS (
       SELECT COALESCE(campanha, 'direto') AS campanha,
              COALESCE(origem, 'direto')   AS origem,
              COALESCE(midia, 'nenhuma')   AS midia,
              count(*)::int                        AS acessos,
              count(DISTINCT visitante_id)::int    AS visitantes,
              COALESCE(round(avg(NULLIF(duracao_segundos, 0)))::int, 0) AS tempo_medio_segundos
         FROM sessoes
        WHERE iniciada_em > now() - ($1 || ' days')::interval
        GROUP BY 1, 2, 3
     ),
     resultado AS (
       SELECT COALESCE(campanha, 'direto')        AS campanha,
              COALESCE(origem_trafego, 'direto')  AS origem,
              COALESCE(midia, 'nenhuma')          AS midia,
              count(*)::int                                     AS leads,
              count(*) FILTER (WHERE vendido_em IS NOT NULL)::int AS vendas,
              COALESCE(sum(valor_venda), 0)::float               AS receita
         FROM leads
        WHERE criado_em > now() - ($1 || ' days')::interval
        GROUP BY 1, 2, 3
     )
     SELECT COALESCE(t.campanha, r.campanha) AS campanha,
            COALESCE(t.origem, r.origem)     AS origem,
            COALESCE(t.midia, r.midia)       AS midia,
            COALESCE(t.acessos, 0)              AS acessos,
            COALESCE(t.visitantes, 0)           AS visitantes,
            COALESCE(t.tempo_medio_segundos, 0) AS tempo_medio_segundos,
            COALESCE(r.leads, 0)                AS leads,
            COALESCE(r.vendas, 0)               AS vendas,
            COALESCE(r.receita, 0)              AS receita,
            CASE WHEN COALESCE(t.acessos, 0) > 0
                 THEN round((COALESCE(r.leads, 0)::numeric / t.acessos) * 100, 2)::float
                 ELSE NULL END AS taxa_conversao
       FROM trafego t
       FULL OUTER JOIN resultado r
         ON r.campanha = t.campanha AND r.origem = t.origem AND r.midia = t.midia
      ORDER BY COALESCE(r.leads, 0) DESC, COALESCE(t.acessos, 0) DESC`,
    [String(dias)]
  );

  return rows;
}

export async function listarVisitantes({ dias, pagina, por_pagina, convertido, campanha, busca }) {
  const valores = [String(dias)];
  const proximo = (valor) => {
    valores.push(valor);
    return `$${valores.length}`;
  };

  const condicoes = [`v.ultimo_acesso_em > now() - ($1 || ' days')::interval`];
  if (convertido !== undefined) condicoes.push(`v.convertido = ${proximo(convertido)}`);
  if (campanha) condicoes.push(`v.campanha = ${proximo(campanha)}`);
  if (busca) {
    const termo = proximo(`%${busca}%`);
    condicoes.push(`(v.visitante_uid ILIKE ${termo} OR v.campanha ILIKE ${termo} OR v.origem ILIKE ${termo})`);
  }

  const limite = proximo(por_pagina);
  const deslocamento = proximo((pagina - 1) * por_pagina);

  const { rows } = await query(
    `SELECT v.id, v.visitante_uid, v.campanha, v.origem, v.midia, v.campanha_id,
            v.referrer, v.utm, v.dispositivo, v.total_sessoes, v.total_eventos,
            v.tempo_total_segundos, v.convertido, v.convertido_em,
            v.primeiro_acesso_em, v.ultimo_acesso_em,
            l.id AS lead_id, l.nome AS lead_nome, l.status AS lead_status,
            count(*) OVER () AS total_registros
       FROM visitantes v
       LEFT JOIN LATERAL (
         SELECT id, nome, status FROM leads WHERE visitante_id = v.id ORDER BY criado_em LIMIT 1
       ) l ON true
      WHERE ${condicoes.join(' AND ')}
      ORDER BY v.ultimo_acesso_em DESC
      LIMIT ${limite} OFFSET ${deslocamento}`,
    valores
  );

  const total = rows.length ? Number(rows[0].total_registros) : 0;
  return {
    visitantes: rows.map(({ total_registros, ...visitante }) => visitante),
    paginacao: {
      pagina,
      por_pagina,
      total,
      total_paginas: Math.max(1, Math.ceil(total / por_pagina))
    }
  };
}

/* Jornada completa: sessoes do visitante com os eventos de cada uma. */
export async function jornadaDoVisitante(id) {
  const { rows: visitante } = await query('SELECT * FROM visitantes WHERE id = $1', [id]);
  if (!visitante.length) return null;

  const [sessoes, eventos, lead] = await Promise.all([
    query('SELECT * FROM sessoes WHERE visitante_id = $1 ORDER BY iniciada_em', [id]),
    query(
      `SELECT id, sessao_id, tipo, pagina, dados, ocorrido_em
         FROM eventos WHERE visitante_id = $1 ORDER BY ocorrido_em LIMIT 500`,
      [id]
    ),
    query('SELECT id, nome, email, whatsapp, status, tags, criado_em FROM leads WHERE visitante_id = $1', [id])
  ]);

  return {
    visitante: visitante[0],
    lead: lead.rows[0] || null,
    sessoes: sessoes.rows.map((sessao) => ({
      ...sessao,
      eventos: eventos.rows.filter((evento) => evento.sessao_id === sessao.id)
    }))
  };
}
