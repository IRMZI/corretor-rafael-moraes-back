import { pool } from '../db/index.js';
import { identificarCampanha, identificarDispositivo } from '../utils/campanha.js';

/* Registra um lote de eventos criando/atualizando visitante e sessao.
   Tudo em uma transacao: ou a jornada entra inteira, ou nao entra. */
export async function registrarEventos(payload, contexto) {
  const cliente = await pool.connect();

  try {
    await cliente.query('BEGIN');

    const campanha = identificarCampanha(payload.utm, payload.referrer);
    const dispositivo = identificarDispositivo(contexto.userAgent || '');
    const utmJson = JSON.stringify(payload.utm || {});

    /* Visitante: na primeira vez guardamos a campanha de origem (first-touch);
       nas seguintes so atualizamos o ultimo acesso e os contadores. */
    const { rows: visitanteRows } = await cliente.query(
      `INSERT INTO visitantes
         (visitante_uid, campanha, origem, midia, campanha_id, referrer, utm, dispositivo, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
       ON CONFLICT (visitante_uid) DO UPDATE
         SET ultimo_acesso_em = now(),
             ip = EXCLUDED.ip,
             user_agent = EXCLUDED.user_agent,
             dispositivo = EXCLUDED.dispositivo
       RETURNING id`,
      [
        payload.visitante_uid,
        campanha.campanha,
        campanha.origem,
        campanha.midia,
        campanha.campanha_id,
        payload.referrer,
        utmJson,
        dispositivo,
        contexto.ip,
        contexto.userAgent
      ]
    );
    const visitanteId = visitanteRows[0].id;

    /* Sessao: a duracao e o maior tempo ativo ja reportado pelo navegador
       (o contador do track.js so cresce e e reenviado a cada heartbeat). */
    const { rows: sessaoRows } = await cliente.query(
      `INSERT INTO sessoes
         (sessao_uid, visitante_id, pagina_entrada, referrer, campanha, origem, midia,
          campanha_id, utm, dispositivo, ip, user_agent, duracao_segundos)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13)
       ON CONFLICT (sessao_uid) DO UPDATE
         SET ultimo_evento_em = now(),
             duracao_segundos = GREATEST(sessoes.duracao_segundos, EXCLUDED.duracao_segundos)
       RETURNING id, (xmax = 0) AS nova`,
      [
        payload.sessao_uid,
        visitanteId,
        payload.pagina,
        payload.referrer,
        campanha.campanha,
        campanha.origem,
        campanha.midia,
        campanha.campanha_id,
        utmJson,
        dispositivo,
        contexto.ip,
        contexto.userAgent,
        payload.tempo_ativo_segundos
      ]
    );
    const sessaoId = sessaoRows[0].id;
    const sessaoNova = sessaoRows[0].nova;

    const eventos = payload.eventos || [];
    if (eventos.length) {
      const valores = [];
      const marcadores = eventos.map((evento, indice) => {
        const base = indice * 5;
        valores.push(
          sessaoId,
          visitanteId,
          evento.tipo,
          evento.pagina || payload.pagina,
          JSON.stringify(evento.dados || {})
        );
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::jsonb)`;
      });

      await cliente.query(
        `INSERT INTO eventos (sessao_id, visitante_id, tipo, pagina, dados)
         VALUES ${marcadores.join(', ')}`,
        valores
      );

      await cliente.query(
        'UPDATE sessoes SET total_eventos = total_eventos + $2 WHERE id = $1',
        [sessaoId, eventos.length]
      );
    }

    /* Contadores do visitante recalculados a partir das sessoes: nao dependem
       de o lote ter chegado em ordem nem de reenvio do mesmo beacon. */
    await cliente.query(
      `UPDATE visitantes v
          SET total_eventos = total_eventos + $2,
              total_sessoes = (SELECT count(*) FROM sessoes WHERE visitante_id = v.id),
              tempo_total_segundos = (SELECT COALESCE(sum(duracao_segundos), 0) FROM sessoes WHERE visitante_id = v.id)
        WHERE v.id = $1`,
      [visitanteId, eventos.length]
    );

    await cliente.query('COMMIT');
    return { visitanteId, sessaoId, sessaoNova, eventosGravados: eventos.length };
  } catch (erro) {
    await cliente.query('ROLLBACK');
    throw erro;
  } finally {
    cliente.release();
  }
}

/* Chamado quando o lead e gravado: liga a conversao ao visitante/sessao. */
export async function marcarConversao(visitanteUid, sessaoUid) {
  if (!visitanteUid) return { visitanteId: null, sessaoId: null };

  const { rows } = await pool.query(
    `UPDATE visitantes
        SET convertido = true,
            convertido_em = COALESCE(convertido_em, now())
      WHERE visitante_uid = $1
      RETURNING id`,
    [visitanteUid]
  );
  const visitanteId = rows[0]?.id || null;
  if (!visitanteId) return { visitanteId: null, sessaoId: null };

  let sessaoId = null;
  if (sessaoUid) {
    const { rows: sessaoRows } = await pool.query(
      'UPDATE sessoes SET convertida = true WHERE sessao_uid = $1 AND visitante_id = $2 RETURNING id',
      [sessaoUid, visitanteId]
    );
    sessaoId = sessaoRows[0]?.id || null;
  }

  return { visitanteId, sessaoId };
}
