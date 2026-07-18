/**
 * Reports — funnel/forecast para un pipeline arbitrario.
 * getCrmReports (lib/crm) siempre usa el pipeline default; cuando el usuario
 * elige otro pipeline vía ?pipeline=, recomputamos solo estas dos series con
 * el mismo SQL de lib/crm.ts. El resto del reporte es global (no por pipeline).
 */
import { getDb } from '@/lib/db';
import type { CrmReports, FunnelStage } from '@/lib/crm';

export async function funnelForPipeline(userId: string, pipelineId: string): Promise<FunnelStage[]> {
  return (await getDb()
    .prepare(
      `SELECT s.id, s.name, s.probability, s.is_won, s.is_lost,
         COUNT(d.id) AS count, COALESCE(SUM(d.amount), 0) AS amount
       FROM crm_stages s
       LEFT JOIN crm_deals d ON d.stage_id = s.id AND d.user_id = ?
       WHERE s.pipeline_id = ?
       GROUP BY s.id
       ORDER BY s.position ASC`,
    )
    .all(userId, pipelineId)) as FunnelStage[];
}

export async function forecastForPipeline(
  userId: string,
  pipelineId: string,
): Promise<CrmReports['forecastByStage']> {
  return (await getDb()
    .prepare(
      `SELECT s.id, s.name, s.probability,
         COUNT(d.id) AS count,
         COALESCE(SUM(d.amount), 0) AS amount,
         COALESCE(SUM(d.amount * s.probability / 100.0), 0) AS forecast
       FROM crm_stages s
       LEFT JOIN crm_deals d ON d.stage_id = s.id AND d.user_id = ? AND d.closed_at IS NULL
       WHERE s.pipeline_id = ?
       GROUP BY s.id
       ORDER BY s.position ASC`,
    )
    .all(userId, pipelineId)) as CrmReports['forecastByStage'];
}
