/**
 * Alcance por persona para lo que la ficha de un registro muestra además del
 * registro en sí: el valor en deals de una empresa y su árbol, y a qué deals
 * se puede nombrar. Con `scope` null (admins, o miembros que ven todo) no
 * restringe nada.
 */
import { getDb, type Db } from './db';
import { companyRollup, descendantCompanyIds, type CompanyRollup } from './crm-assoc';
import { baseAmountSql, getCrmSettings } from './crm-currency';
import { scopeAnd, type OwnerScope } from './crm-visibility';

const placeholders = (ids: string[]) => ids.map(() => '?').join(',');

/** De una lista de ids de una tabla del CRM, los que son del workspace y la persona puede ver. */
export async function visibleRecordIds(
  workspaceId: string,
  table: 'crm_companies' | 'crm_deals' | 'crm_contacts',
  ids: string[],
  scope: OwnerScope | undefined,
  db: Db = getDb(),
): Promise<Set<string>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Set();
  const cond = scopeAnd(table, scope);
  const rows = (await db
    .prepare(`SELECT id FROM ${table} WHERE user_id = ? AND id IN (${placeholders(unique)})${cond.sql}`)
    .all(workspaceId, ...unique, ...cond.args)) as Array<{ id: string }>;
  return new Set(rows.map((r) => r.id));
}

/**
 * Valor de deals de la empresa y de su árbol de hijas, contando solo lo que
 * la persona puede ver: deals de su alcance y descendientes de su alcance.
 * Los totales, la cantidad de deals y la cantidad de hijas no incluyen nada
 * oculto. Sin restricción devuelve lo mismo que `companyRollup`.
 */
export async function scopedCompanyRollup(
  workspaceId: string,
  companyId: string,
  scope: OwnerScope | undefined,
  db: Db = getDb(),
): Promise<CompanyRollup> {
  if (!scope) return companyRollup(workspaceId, companyId, db);
  const { baseCurrency } = await getCrmSettings(workspaceId, db);
  const descendants = [
    ...(await visibleRecordIds(workspaceId, 'crm_companies', await descendantCompanyIds(workspaceId, companyId, db), scope, db)),
  ];
  const amt = baseAmountSql('d');
  const dealScope = scopeAnd('d', scope);
  async function sums(ids: string[]): Promise<{ open: number; won: number; count: number }> {
    const row = (await db
      .prepare(
        `SELECT COUNT(*) AS c,
           COALESCE(SUM(CASE WHEN COALESCE(s.is_won, 0) = 0 AND COALESCE(s.is_lost, 0) = 0 THEN ${amt} END), 0) AS open,
           COALESCE(SUM(CASE WHEN s.is_won = 1 THEN ${amt} END), 0) AS won
         FROM crm_deals d
         LEFT JOIN crm_stages s ON s.id = d.stage_id
         WHERE d.user_id = ? AND d.id IN (SELECT deal_id FROM crm_deal_companies WHERE company_id IN (${placeholders(ids)}))${dealScope.sql}`,
      )
      .get(workspaceId, ...ids, ...dealScope.args)) as { c: number; open: number; won: number };
    return { open: Number(row.open), won: Number(row.won), count: Number(row.c) };
  }
  return {
    currency: baseCurrency,
    own: await sums([companyId]),
    total: await sums([companyId, ...descendants]),
    childCount: descendants.length,
  };
}

/**
 * Ficha de empresa (ya pasada por scopeCompanyDetail) con lo que la persona
 * ve también en el valor de deals y en la cadena de madres: el rollup solo
 * cuenta deals e hijas de su alcance, y las madres que no ve no salen ni por
 * nombre. Sin restricción devuelve la ficha tal cual.
 */
export async function scopedCompanyDetail<
  T extends {
    company: { id: string };
    parent: { id: string; name: string } | null;
    ancestors: Array<{ id: string; name: string }>;
    rollup: CompanyRollup;
  },
>(workspaceId: string, detail: T, scope: OwnerScope | undefined, db: Db = getDb()): Promise<T> {
  if (!scope) return detail;
  const visible = await visibleRecordIds(workspaceId, 'crm_companies', detail.ancestors.map((a) => a.id), scope, db);
  return {
    ...detail,
    rollup: await scopedCompanyRollup(workspaceId, detail.company.id, scope, db),
    ancestors: detail.ancestors.filter((a) => visible.has(a.id)),
    parent: detail.parent && visible.has(detail.parent.id) ? detail.parent : null,
  };
}
