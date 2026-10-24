/**
 * CRM — visibilidad por owner y equipos de venta. Server-only.
 *
 * Setting del workspace para el rol member (admins y owner ven todo):
 *   'all'  → todos los registros
 *   'mine' → solo los registros cuyo owner es la persona
 *   'team' → los suyos + los de sus compañeros de equipo (crm_sales_teams)
 *
 * Un "scope" es la lista de owners visibles (null = sin restricción). Los
 * listados, búsquedas, exports, reportes y la API v1 (la key actúa como la
 * persona que la creó) lo aplican con ownerScopeSql(); los GET de un registro
 * con canSeeOwner() (404 si no se ve, para no confirmar que existe).
 * Registros sin owner cuentan como del dueño del workspace (COALESCE).
 */
import { getDb, type CrmSalesTeamRow, type Db } from './db';
import { isWorkspacePerson } from './crm-refs';
import { roleAtLeast, type TeamRole } from './teams';

export const MEMBER_VISIBILITIES = ['all', 'mine', 'team'] as const;
export type MemberVisibility = (typeof MEMBER_VISIBILITIES)[number];

/** null = ve todo; si no, ids de owners visibles. */
export type OwnerScope = string[] | null;

export interface Viewer {
  /** Workspace (dueño). */
  workspaceId: string;
  /** Persona real que mira. */
  personId: string;
  role: TeamRole;
}

export function normalizeVisibility(v: unknown): MemberVisibility {
  return v === 'mine' || v === 'team' ? v : 'all';
}

export async function getMemberVisibility(workspaceId: string, db: Db = getDb()): Promise<MemberVisibility> {
  const row = (await db
    .prepare('SELECT member_visibility FROM crm_settings WHERE user_id = ?')
    .get(workspaceId)) as { member_visibility: string } | undefined;
  return normalizeVisibility(row?.member_visibility);
}

export async function setMemberVisibility(
  workspaceId: string,
  visibility: MemberVisibility,
  db: Db = getDb(),
): Promise<MemberVisibility> {
  const v = normalizeVisibility(visibility);
  await db
    .prepare(
      `INSERT INTO crm_settings (user_id, member_visibility, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET member_visibility = excluded.member_visibility, updated_at = excluded.updated_at`,
    )
    .run(workspaceId, v);
  return v;
}

/** Compañeros de equipo de la persona (incluida ella), en todos sus equipos. */
export async function teammatesOf(workspaceId: string, personId: string, db: Db = getDb()): Promise<string[]> {
  const rows = (await db
    .prepare(
      `SELECT DISTINCT m2.person_id FROM crm_sales_team_members m1
       JOIN crm_sales_team_members m2 ON m2.team_id = m1.team_id
       WHERE m1.user_id = ? AND m1.person_id = ?`,
    )
    .all(workspaceId, personId)) as Array<{ person_id: string }>;
  return [...new Set([personId, ...rows.map((r) => r.person_id)])];
}

/** Scope de un viewer. Admins/owner y el setting 'all' → null (todo). */
export async function ownerScopeFor(viewer: Viewer, db: Db = getDb()): Promise<OwnerScope> {
  if (roleAtLeast(viewer.role, 'admin') || viewer.personId === viewer.workspaceId) return null;
  const visibility = await getMemberVisibility(viewer.workspaceId, db);
  if (visibility === 'all') return null;
  if (visibility === 'mine') return [viewer.personId];
  return teammatesOf(viewer.workspaceId, viewer.personId, db);
}

/** Scope de la sesión (usuario de lib/session.ts). */
export async function sessionScope(user: {
  id: string;
  role: TeamRole;
  actingUser?: { id: string } | null;
}): Promise<OwnerScope> {
  return ownerScopeFor({ workspaceId: user.id, personId: user.actingUser?.id ?? user.id, role: user.role });
}

/** Scope de una API key (actúa como la persona que la creó). */
export async function apiScope(auth: { user: { id: string }; personId: string; role: TeamRole }): Promise<OwnerScope> {
  return ownerScopeFor({ workspaceId: auth.user.id, personId: auth.personId, role: auth.role });
}

/** Condición SQL (sin AND inicial) para `alias.owner_id` dentro del scope. '' si no restringe. */
export function ownerScopeSql(alias: string, scope: OwnerScope | undefined): { sql: string; args: string[] } {
  if (!scope) return { sql: '', args: [] };
  if (!scope.length) return { sql: '0', args: [] };
  return {
    sql: `COALESCE(${alias}.owner_id, ${alias}.user_id) IN (${scope.map(() => '?').join(',')})`,
    args: [...scope],
  };
}

/** ' AND <cond>' para agregar a un WHERE sobre `alias` (o una tabla sin alias); '' si no restringe. */
export function scopeAnd(alias: string, scope: OwnerScope | undefined): { sql: string; args: string[] } {
  const c = ownerScopeSql(alias, scope);
  return c.sql ? { sql: ` AND ${c.sql}`, args: c.args } : { sql: '', args: [] };
}

/** ¿Se ve un registro con ese owner? (owner null = dueño del workspace). */
export function canSeeOwner(scope: OwnerScope | undefined, ownerId: string | null, workspaceId: string): boolean {
  if (!scope) return true;
  return scope.includes(ownerId ?? workspaceId);
}

/** Filtra filas con owner_id por scope. */
export function filterByScope<T extends { owner_id: string | null; user_id: string }>(
  rows: T[],
  scope: OwnerScope | undefined,
): T[] {
  if (!scope) return rows;
  return rows.filter((r) => canSeeOwner(scope, r.owner_id, r.user_id));
}

/**
 * Actividades visibles: si están vinculadas a registros, todos esos registros
 * deben verse; si no tienen registro, cuenta su owner.
 */
export function activityScopeSql(alias: string, scope: OwnerScope | undefined): { sql: string; args: string[] } {
  if (!scope) return { sql: '', args: [] };
  if (!scope.length) return { sql: '0', args: [] };
  const inList = `(${scope.map(() => '?').join(',')})`;
  const sql = `(
    (${alias}.contact_id IS NOT NULL OR ${alias}.company_id IS NOT NULL OR ${alias}.deal_id IS NOT NULL
      OR COALESCE(${alias}.owner_id, ${alias}.user_id) IN ${inList})
    AND (${alias}.contact_id IS NULL OR EXISTS (SELECT 1 FROM crm_contacts vsc WHERE vsc.id = ${alias}.contact_id AND COALESCE(vsc.owner_id, vsc.user_id) IN ${inList}))
    AND (${alias}.company_id IS NULL OR EXISTS (SELECT 1 FROM crm_companies vsco WHERE vsco.id = ${alias}.company_id AND COALESCE(vsco.owner_id, vsco.user_id) IN ${inList}))
    AND (${alias}.deal_id IS NULL OR EXISTS (SELECT 1 FROM crm_deals vsd WHERE vsd.id = ${alias}.deal_id AND COALESCE(vsd.owner_id, vsd.user_id) IN ${inList}))
  )`;
  return { sql, args: [...scope, ...scope, ...scope, ...scope] };
}

type RecordTable = 'crm_contacts' | 'crm_companies' | 'crm_deals';

/** ¿El viewer ve este registro? false también si no existe en el workspace. */
export async function canSeeRecord(
  workspaceId: string,
  table: RecordTable,
  id: string,
  scope: OwnerScope | undefined,
  db: Db = getDb(),
): Promise<boolean> {
  const row = (await db.prepare(`SELECT owner_id FROM ${table} WHERE id = ? AND user_id = ?`).get(id, workspaceId)) as
    | { owner_id: string | null }
    | undefined;
  if (!row) return false;
  return canSeeOwner(scope, row.owner_id, workspaceId);
}

/** Igual que canSeeRecord pero con el tipo de entidad ('contact' | 'company' | 'deal'). */
export async function canSeeEntity(
  workspaceId: string,
  entity: 'contact' | 'company' | 'deal',
  id: string,
  scope: OwnerScope | undefined,
): Promise<boolean> {
  if (!scope) return true;
  const table: RecordTable = entity === 'contact' ? 'crm_contacts' : entity === 'company' ? 'crm_companies' : 'crm_deals';
  return canSeeRecord(workspaceId, table, id, scope);
}

/**
 * ¿Ve una fila con owner (lead, registro de objeto propio)? false si no
 * existe en el workspace.
 */
export async function canSeeOwnedRow(
  workspaceId: string,
  table: 'crm_leads' | 'crm_object_records',
  id: string,
  scope: OwnerScope | undefined,
  db: Db = getDb(),
): Promise<boolean> {
  const row = (await db.prepare(`SELECT owner_id FROM ${table} WHERE id = ? AND user_id = ?`).get(id, workspaceId)) as
    | { owner_id: string | null }
    | undefined;
  if (!row) return false;
  return canSeeOwner(scope, row.owner_id, workspaceId);
}

/** ¿Ve todos los registros referenciados por una actividad? */
export async function canSeeActivityRefs(
  workspaceId: string,
  refs: { contact_id?: string | null; company_id?: string | null; deal_id?: string | null; owner_id?: string | null },
  scope: OwnerScope | undefined,
): Promise<boolean> {
  if (!scope) return true;
  if (refs.contact_id && !(await canSeeRecord(workspaceId, 'crm_contacts', refs.contact_id, scope))) return false;
  if (refs.company_id && !(await canSeeRecord(workspaceId, 'crm_companies', refs.company_id, scope))) return false;
  if (refs.deal_id && !(await canSeeRecord(workspaceId, 'crm_deals', refs.deal_id, scope))) return false;
  if (!refs.contact_id && !refs.company_id && !refs.deal_id) {
    return canSeeOwner(scope, refs.owner_id ?? null, workspaceId);
  }
  return true;
}

/** Ids (del workspace) que el viewer ve; descarta el resto. Para acciones en lote. */
export async function visibleIds(
  workspaceId: string,
  table: RecordTable,
  ids: string[],
  scope: OwnerScope | undefined,
  db: Db = getDb(),
): Promise<string[]> {
  if (!scope) return ids;
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const cond = ownerScopeSql('x', scope);
  const rows = (await db
    .prepare(
      `SELECT x.id FROM ${table} x WHERE x.user_id = ? AND x.id IN (${unique.map(() => '?').join(',')}) AND ${cond.sql}`,
    )
    .all(workspaceId, ...unique, ...cond.args)) as Array<{ id: string }>;
  const ok = new Set(rows.map((r) => r.id));
  return unique.filter((id) => ok.has(id));
}

/**
 * Lista de asociaciones de un registro (lib/crm-assoc → listAssociations) sin
 * los registros asociados que el viewer no ve.
 */
export async function scopeAssociationList<
  T extends {
    companies?: Array<{ id: string }>;
    contacts?: Array<{ id: string }>;
    deals?: Array<{ id: string }>;
    parent?: { id: string } | null;
    children?: Array<{ id: string }>;
  },
>(workspaceId: string, list: T, scope: OwnerScope | undefined, db: Db = getDb()): Promise<T> {
  if (!scope) return list;
  const keep = async <R extends { id: string }>(rows: R[] | undefined, table: RecordTable): Promise<R[] | undefined> => {
    if (!rows) return rows;
    const ok = new Set(await visibleIds(workspaceId, table, rows.map((r) => r.id), scope, db));
    return rows.filter((r) => ok.has(r.id));
  };
  const out: T = { ...list };
  if (list.companies) out.companies = await keep(list.companies, 'crm_companies');
  if (list.contacts) out.contacts = await keep(list.contacts, 'crm_contacts');
  if (list.deals) out.deals = await keep(list.deals, 'crm_deals');
  if (list.children) out.children = await keep(list.children, 'crm_companies');
  if (list.parent) {
    out.parent = (await canSeeRecord(workspaceId, 'crm_companies', list.parent.id, scope, db)) ? list.parent : null;
  }
  return out;
}

/** ¿El viewer ve ambos extremos de una asociación? */
export async function canSeeBoth(
  workspaceId: string,
  a: { fromType: 'contact' | 'company' | 'deal'; fromId: string; toType: 'contact' | 'company' | 'deal'; toId: string },
  scope: OwnerScope | undefined,
): Promise<boolean> {
  if (!scope) return true;
  return (
    (await canSeeEntity(workspaceId, a.fromType, a.fromId, scope)) &&
    (await canSeeEntity(workspaceId, a.toType, a.toId, scope))
  );
}

/** ¿El viewer ve este quote? Se ve si ve su deal. */
export async function canSeeQuote(
  workspaceId: string,
  quoteId: string,
  scope: OwnerScope | undefined,
  db: Db = getDb(),
): Promise<boolean> {
  const row = (await db.prepare('SELECT deal_id FROM crm_quotes WHERE id = ? AND user_id = ?').get(quoteId, workspaceId)) as
    | { deal_id: string }
    | undefined;
  if (!row) return false;
  return canSeeRecord(workspaceId, 'crm_deals', row.deal_id, scope, db);
}

/** Condición SQL: el deal `dealExpr` (columna) está dentro del scope. '' si no restringe. */
export function dealScopeSql(dealExpr: string, scope: OwnerScope | undefined): { sql: string; args: string[] } {
  if (!scope) return { sql: '', args: [] };
  if (!scope.length) return { sql: '0', args: [] };
  return {
    sql: `EXISTS (SELECT 1 FROM crm_deals vdq WHERE vdq.id = ${dealExpr} AND COALESCE(vdq.owner_id, vdq.user_id) IN (${scope.map(() => '?').join(',')}))`,
    args: [...scope],
  };
}

/** ¿El viewer ve esta actividad? (false si no existe en el workspace). */
export async function canSeeActivity(
  workspaceId: string,
  id: string,
  scope: OwnerScope | undefined,
  db: Db = getDb(),
): Promise<boolean> {
  const row = (await db
    .prepare('SELECT contact_id, company_id, deal_id, owner_id FROM crm_activities WHERE id = ? AND user_id = ?')
    .get(id, workspaceId)) as
    | { contact_id: string | null; company_id: string | null; deal_id: string | null; owner_id: string | null }
    | undefined;
  if (!row) return false;
  return canSeeActivityRefs(workspaceId, row, scope);
}

// ---------- Equipos de venta ----------

export interface SalesTeam extends CrmSalesTeamRow {
  members: string[];
}

export async function listSalesTeams(workspaceId: string, db: Db = getDb()): Promise<SalesTeam[]> {
  const teams = (await db
    .prepare('SELECT * FROM crm_sales_teams WHERE user_id = ? ORDER BY name COLLATE NOCASE ASC')
    .all(workspaceId)) as CrmSalesTeamRow[];
  if (!teams.length) return [];
  const members = (await db
    .prepare('SELECT team_id, person_id FROM crm_sales_team_members WHERE user_id = ?')
    .all(workspaceId)) as Array<{ team_id: string; person_id: string }>;
  return teams.map((t) => ({ ...t, members: members.filter((m) => m.team_id === t.id).map((m) => m.person_id) }));
}

export async function getSalesTeam(workspaceId: string, id: string, db: Db = getDb()): Promise<SalesTeam | null> {
  return (await listSalesTeams(workspaceId, db)).find((t) => t.id === id) ?? null;
}

/** Deja solo personas del workspace (descarta ids ajenos). */
async function validPeople(workspaceId: string, ids: string[], db: Db): Promise<string[]> {
  const out: string[] = [];
  for (const id of [...new Set(ids)]) {
    if (await isWorkspacePerson(workspaceId, id, db)) out.push(id);
  }
  return out;
}

export async function createSalesTeam(
  workspaceId: string,
  input: { name: string; members?: string[] },
  db: Db = getDb(),
): Promise<SalesTeam> {
  const id = crypto.randomUUID();
  await db
    .prepare('INSERT INTO crm_sales_teams (id, user_id, name) VALUES (?, ?, ?)')
    .run(id, workspaceId, input.name.trim().slice(0, 80));
  if (input.members) await setSalesTeamMembers(workspaceId, id, input.members, db);
  return (await getSalesTeam(workspaceId, id, db))!;
}

export async function updateSalesTeam(
  workspaceId: string,
  id: string,
  input: { name?: string; members?: string[] },
  db: Db = getDb(),
): Promise<SalesTeam | null> {
  const existing = await getSalesTeam(workspaceId, id, db);
  if (!existing) return null;
  if (input.name !== undefined) {
    await db
      .prepare('UPDATE crm_sales_teams SET name = ? WHERE id = ? AND user_id = ?')
      .run(input.name.trim().slice(0, 80), id, workspaceId);
  }
  if (input.members) await setSalesTeamMembers(workspaceId, id, input.members, db);
  return getSalesTeam(workspaceId, id, db);
}

export async function setSalesTeamMembers(
  workspaceId: string,
  teamId: string,
  members: string[],
  db: Db = getDb(),
): Promise<string[]> {
  const people = await validPeople(workspaceId, members, db);
  await db.prepare('DELETE FROM crm_sales_team_members WHERE team_id = ? AND user_id = ?').run(teamId, workspaceId);
  for (const p of people) {
    await db
      .prepare('INSERT OR IGNORE INTO crm_sales_team_members (team_id, user_id, person_id) VALUES (?, ?, ?)')
      .run(teamId, workspaceId, p);
  }
  return people;
}

export async function deleteSalesTeam(workspaceId: string, id: string, db: Db = getDb()): Promise<boolean> {
  return (await db.prepare('DELETE FROM crm_sales_teams WHERE id = ? AND user_id = ?').run(id, workspaceId)).changes > 0;
}

// ---------- Fichas: registros asociados que el viewer no ve ----------

type Owned = { owner_id: string | null; user_id: string };

/** Ficha de contacto sin las empresas/deals que el viewer no ve. */
export function scopeContactDetail<
  T extends { company: Owned | null; companies: Owned[]; deals: Owned[] },
>(detail: T, scope: OwnerScope | undefined): T {
  if (!scope) return detail;
  return {
    ...detail,
    company: detail.company && canSeeOwner(scope, detail.company.owner_id, detail.company.user_id) ? detail.company : null,
    companies: filterByScope(detail.companies, scope),
    deals: filterByScope(detail.deals, scope),
  };
}

/** Ficha de empresa sin contactos/deals/hijas que el viewer no ve. */
export function scopeCompanyDetail<T extends { contacts: Owned[]; deals: Owned[]; children: Owned[] }>(
  detail: T,
  scope: OwnerScope | undefined,
): T {
  if (!scope) return detail;
  return {
    ...detail,
    contacts: filterByScope(detail.contacts, scope),
    deals: filterByScope(detail.deals, scope),
    children: filterByScope(detail.children, scope),
  };
}

/** Ficha de deal sin contactos/empresas que el viewer no ve. */
export function scopeDealDetail<T extends { contacts: Owned[]; company: Owned | null; companies: Owned[] }>(
  detail: T,
  scope: OwnerScope | undefined,
): T {
  if (!scope) return detail;
  return {
    ...detail,
    contacts: filterByScope(detail.contacts, scope),
    company: detail.company && canSeeOwner(scope, detail.company.owner_id, detail.company.user_id) ? detail.company : null,
    companies: filterByScope(detail.companies, scope),
  };
}
