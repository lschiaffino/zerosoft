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
export type RecordTable = 'crm_companies' | 'crm_deals' | 'crm_contacts';

export async function visibleRecordIds(
  workspaceId: string,
  table: RecordTable,
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
 * nombre ni por id (`company.parent_company_id` queda en null). Sin
 * restricción devuelve la ficha tal cual.
 */
export async function scopedCompanyDetail<
  T extends {
    company: { id: string; parent_company_id?: string | null };
    parent: { id: string; name: string } | null;
    ancestors: Array<{ id: string; name: string }>;
    rollup: CompanyRollup;
  },
>(workspaceId: string, detail: T, scope: OwnerScope | undefined, db: Db = getDb()): Promise<T> {
  if (!scope) return detail;
  const parentId = detail.company.parent_company_id ?? null;
  const visible = await visibleRecordIds(
    workspaceId,
    'crm_companies',
    [...detail.ancestors.map((a) => a.id), ...(parentId ? [parentId] : [])],
    scope,
    db,
  );
  // El id de una madre que no ve tampoco sale en la empresa misma.
  const company = parentId && !visible.has(parentId) ? { ...detail.company, parent_company_id: null } : detail.company;
  return {
    ...detail,
    company,
    rollup: await scopedCompanyRollup(workspaceId, detail.company.id, scope, db),
    ancestors: detail.ancestors.filter((a) => visible.has(a.id)),
    parent: detail.parent && visible.has(detail.parent.id) ? detail.parent : null,
  };
}

// ---------- Asociados fuera de alcance ----------

/**
 * Un asociado que una fila nombra (el contacto de un lead, la empresa de un
 * contacto): `id` es la columna con su id, `fields` las columnas que lo
 * describen (nombre, email, dominio) y `flag` la columna que se marca en true
 * cuando la persona no lo ve.
 */
export interface PrivateRefSpec {
  table: RecordTable;
  id: string;
  fields: readonly string[];
  flag: string;
}

/** Asociados de uso común. Todas las fichas y listas usan estas marcas. */
export const PRIVATE_REFS = {
  contact: (fields: readonly string[] = ['contact_name', 'contact_email']): PrivateRefSpec => ({
    table: 'crm_contacts',
    id: 'contact_id',
    fields,
    flag: 'contact_private',
  }),
  company: (fields: readonly string[] = ['company_name', 'company_domain'], id = 'company_id'): PrivateRefSpec => ({
    table: 'crm_companies',
    id,
    fields,
    flag: 'company_private',
  }),
  deal: (fields: readonly string[] = ['deal_name']): PrivateRefSpec => ({ table: 'crm_deals', id: 'deal_id', fields, flag: 'deal_private' }),
  parent: (): PrivateRefSpec => ({ table: 'crm_companies', id: 'parent_company_id', fields: [], flag: 'parent_private' }),
} as const;

/** Marcas que agrega maskPrivateRefs (true = hay un asociado que la persona no ve). */
export interface PrivateRefFlags {
  contact_private?: boolean;
  company_private?: boolean;
  deal_private?: boolean;
  parent_private?: boolean;
}

/**
 * Filas sin los asociados que la persona no ve: su id y sus columnas quedan
 * en null y la marca en true, así la UI muestra "Registro privado" sin link.
 * Un asociado inexistente o de otro workspace cuenta como no visible. Sin
 * restricción devuelve las filas tal cual.
 */
export async function maskPrivateRefs<T extends object>(
  workspaceId: string,
  rows: T[],
  specs: readonly PrivateRefSpec[],
  scope: OwnerScope | undefined,
  db: Db = getDb(),
): Promise<Array<T & PrivateRefFlags>> {
  if (!scope || !rows.length || !specs.length) return rows as Array<T & PrivateRefFlags>;
  const out = rows.map((r) => ({ ...r }) as Record<string, unknown>);
  for (const spec of specs) {
    const ids = out.map((r) => r[spec.id]).filter((v): v is string => typeof v === 'string' && v !== '');
    if (!ids.length) continue;
    const visible = await visibleRecordIds(workspaceId, spec.table, ids, scope, db);
    for (const r of out) {
      const id = r[spec.id];
      if (typeof id !== 'string' || id === '' || visible.has(id)) continue;
      r[spec.id] = null;
      for (const f of spec.fields) if (f in r) r[f] = null;
      r[spec.flag] = true;
    }
  }
  return out as Array<T & PrivateRefFlags>;
}

/** maskPrivateRefs para una sola fila (null pasa como null). */
export async function maskPrivateRef<T extends object>(
  workspaceId: string,
  row: T | null,
  specs: readonly PrivateRefSpec[],
  scope: OwnerScope | undefined,
  db: Db = getDb(),
): Promise<(T & PrivateRefFlags) | null> {
  if (!row) return null;
  return (await maskPrivateRefs(workspaceId, [row], specs, scope, db))[0];
}
