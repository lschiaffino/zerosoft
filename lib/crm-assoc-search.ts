/**
 * CRM: la búsqueda del selector "+ Agregar" de las tarjetas de asociaciones
 * de la ficha (como en HubSpot: buscar entre todos los registros, no entre
 * los primeros de una lista). Server-side, con el alcance de quien busca:
 * un registro que no ve no aparece. Devuelve solo nombre y un dato de
 * fábrica (dominio, email, etapa), nunca propiedades propias.
 */
import { getDb } from './db';
import { escapeLike } from './crm-filters';
import { scopeAnd, type OwnerScope } from './crm-visibility';

export type AssocSearchType = 'contact' | 'company' | 'deal';
export const ASSOC_SEARCH_TYPES: readonly AssocSearchType[] = ['contact', 'company', 'deal'];
export const ASSOC_SEARCH_LIMIT = 20;

export interface AssocSearchHit {
  id: string;
  name: string;
  meta: string;
}

export async function searchAssociable(
  workspaceId: string,
  type: AssocSearchType,
  q: string,
  scope: OwnerScope | undefined,
  exclude: readonly string[] = [],
): Promise<AssocSearchHit[]> {
  const db = getDb();
  const like = `%${escapeLike(q.trim().slice(0, 100))}%`;
  const ex = exclude.slice(0, 200);
  const exSql = (alias: string) => (ex.length ? ` AND ${alias}.id NOT IN (${ex.map(() => '?').join(',')})` : '');
  if (type === 'contact') {
    const sc = scopeAnd('c', scope);
    const rows = (await db
      .prepare(
        `SELECT c.id, trim(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) AS name, c.email AS meta
         FROM crm_contacts c
         WHERE c.user_id = ? AND ((COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) LIKE ? ESCAPE '\\' OR c.email LIKE ? ESCAPE '\\')${sc.sql}${exSql('c')}
         ORDER BY c.first_name COLLATE NOCASE, c.last_name COLLATE NOCASE, c.id
         LIMIT ?`,
      )
      .all(workspaceId, like, like, ...sc.args, ...ex, ASSOC_SEARCH_LIMIT)) as Array<{ id: string; name: string; meta: string | null }>;
    return rows.map((r) => ({ id: r.id, name: r.name || r.meta || '—', meta: r.name ? r.meta ?? '' : '' }));
  }
  if (type === 'company') {
    const sc = scopeAnd('co', scope);
    const rows = (await db
      .prepare(
        `SELECT co.id, co.name, co.domain AS meta FROM crm_companies co
         WHERE co.user_id = ? AND (co.name LIKE ? ESCAPE '\\' OR co.domain LIKE ? ESCAPE '\\')${sc.sql}${exSql('co')}
         ORDER BY co.name COLLATE NOCASE, co.id
         LIMIT ?`,
      )
      .all(workspaceId, like, like, ...sc.args, ...ex, ASSOC_SEARCH_LIMIT)) as Array<{ id: string; name: string; meta: string | null }>;
    return rows.map((r) => ({ id: r.id, name: r.name, meta: r.meta ?? '' }));
  }
  const sc = scopeAnd('d', scope);
  const rows = (await db
    .prepare(
      `SELECT d.id, d.name, COALESCE(s.name, '') AS meta FROM crm_deals d
       LEFT JOIN crm_stages s ON s.id = d.stage_id
       WHERE d.user_id = ? AND d.name LIKE ? ESCAPE '\\'${sc.sql}${exSql('d')}
       ORDER BY d.name COLLATE NOCASE, d.id
       LIMIT ?`,
    )
    .all(workspaceId, like, ...sc.args, ...ex, ASSOC_SEARCH_LIMIT)) as Array<{ id: string; name: string; meta: string }>;
  return rows;
}
