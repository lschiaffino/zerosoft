/**
 * CRM en vivo: el SQL de los triggers (lo usa la migración 20261123_0440_crm_live,
 * no importa lib/db). Ver lib/crm-live.ts.
 */

/** Columnas de mantenimiento: cambiarlas no es un cambio que otra pantalla tenga que ver. */
export const CRM_LIVE_SKIP_COLUMNS: readonly string[] = ['score_updated_at', 'enriched_at'];

/**
 * Cuerpo de trigger: sube el contador del workspace `ws` (una expresión SQL,
 * p. ej. `NEW.user_id`) y marca cada registro de `pairs` ([entidad, expresión
 * del id]) con el contador nuevo. Un workspace o un id nulo no escribe nada
 * (una asociación cuyo deal ya se borró en la misma cascada).
 */
export function crmLiveBumpSql(ws: string, pairs: Array<[string, string]>): string {
  const lines = [
    `INSERT INTO crm_live_rev (user_id, rev) SELECT ${ws}, 1 WHERE ${ws} IS NOT NULL
      ON CONFLICT(user_id) DO UPDATE SET rev = rev + 1;`,
  ];
  for (const [entity, id] of pairs) {
    if (!/^[a-z_]+$/.test(entity)) throw new Error('crm-live: invalid entity');
    lines.push(
      `INSERT INTO crm_live_changes (user_id, entity, record_id, rev)
        SELECT ${ws}, '${entity}', ${id}, (SELECT r.rev FROM crm_live_rev r WHERE r.user_id = ${ws})
        WHERE ${ws} IS NOT NULL AND ${id} IS NOT NULL
        ON CONFLICT(user_id, entity, record_id) DO UPDATE SET rev = excluded.rev;`,
    );
  }
  return lines.join('\n');
}
