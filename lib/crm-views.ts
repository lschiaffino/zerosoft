/**
 * CRM, vistas guardadas de los listados (B2). Server-only: lectura y
 * escritura de crm_saved_views y crm_view_tabs con los permisos de
 * lib/crm-views-shared.ts.
 *
 * - Una vista privada no existe para nadie más: no se lista, no se abre por id
 *   y editarla o borrarla responde not_found (no se confirma que exista).
 * - Una compartida la edita o borra solo quien la creó o un admin; el resto la
 *   ve y responde forbidden si intenta cambiarla.
 * - Lo que se manda a quien mira pasa por redactViewQuery con sus campos
 *   ocultos (lib/crm-field-perms.ts).
 */
import { getDb, type CrmSavedViewRow, type Db } from './db';
import { roleAtLeast, type TeamRole } from './teams';
import { hiddenFieldsFor } from './crm-field-perms';
import {
  DEFAULT_VIEWS,
  MAX_VIEWS,
  addTab,
  canEditView,
  canSeeView,
  isDefaultViewKey,
  isViewEntity,
  normalizeTabs,
  normalizeVisibility,
  parseTabs,
  pickViewState,
  redactViewQuery,
  viewQueryDropsFilters,
  viewCreator,
  type TabPref,
  type ViewEntity,
  type ViewQuery,
  type ViewViewer,
  type ViewVisibility,
} from './crm-views-shared';

/** Lo que recibe el cliente de una vista: sin user_id, con lo oculto ya quitado. */
export interface SavedViewDto {
  id: string;
  entity: ViewEntity;
  name: string;
  visibility: ViewVisibility;
  teamId: string | null;
  /** Persona que la creó. */
  createdBy: string;
  mine: boolean;
  canEdit: boolean;
  query: ViewQuery;
  /** Filtra por campos que quien mira tiene ocultos: esos filtros no se le aplican. */
  partial: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ViewWriteError = 'not_found' | 'forbidden' | 'invalid_team' | 'too_many';

/** Persona que mira (sesión o API key). */
export async function viewViewerFor(
  who: { workspaceId: string; personId: string; role: TeamRole },
  db: Db = getDb(),
): Promise<ViewViewer> {
  const teams = (await db
    .prepare('SELECT team_id FROM crm_sales_team_members WHERE user_id = ? AND person_id = ?')
    .all(who.workspaceId, who.personId)) as Array<{ team_id: string }>;
  return {
    workspaceId: who.workspaceId,
    personId: who.personId,
    isAdmin: roleAtLeast(who.role, 'admin') || who.personId === who.workspaceId,
    teamIds: new Set(teams.map((t) => t.team_id)),
  };
}

/** Viewer de la sesión (lib/session.ts). */
export function sessionViewViewer(user: { id: string; role: TeamRole; actingUser?: { id: string } | null }): Promise<ViewViewer> {
  return viewViewerFor({ workspaceId: user.id, personId: user.actingUser?.id ?? user.id, role: user.role });
}

function parseQuery(raw: string): ViewQuery {
  try {
    const v: unknown = JSON.parse(raw || '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: ViewQuery = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (typeof val === 'string') out[k] = val;
    return out;
  } catch {
    return {};
  }
}

export function toViewDto(row: CrmSavedViewRow, viewer: ViewViewer, hidden: ReadonlySet<string>): SavedViewDto {
  const entity = row.entity as ViewEntity;
  return {
    id: row.id,
    entity,
    name: row.name,
    visibility: normalizeVisibility(row.visibility),
    teamId: normalizeVisibility(row.visibility) === 'team' ? row.team_id : null,
    createdBy: viewCreator(row),
    mine: viewCreator(row) === viewer.personId,
    canEdit: canEditView(row, viewer),
    query: redactViewQuery(pickViewState(entity, parseQuery(row.query)), hidden),
    partial: viewQueryDropsFilters(pickViewState(entity, parseQuery(row.query)), hidden),
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}

async function hiddenFor(viewer: ViewViewer, entity: string, db: Db): Promise<Set<string>> {
  return hiddenFieldsFor(
    { workspaceId: viewer.workspaceId, personId: viewer.personId, role: viewer.isAdmin ? 'admin' : 'member' },
    entity,
    db,
  );
}

/** Filas de vistas del workspace que la persona ve (sin redactar). */
async function visibleRows(viewer: ViewViewer, entity: ViewEntity | null, db: Db): Promise<CrmSavedViewRow[]> {
  const rows = (await (entity
    ? db
        .prepare('SELECT * FROM crm_saved_views WHERE user_id = ? AND entity = ? ORDER BY created_at ASC, id ASC')
        .all(viewer.workspaceId, entity)
    : db
        .prepare('SELECT * FROM crm_saved_views WHERE user_id = ? ORDER BY created_at ASC, id ASC')
        .all(viewer.workspaceId))) as CrmSavedViewRow[];
  // Solo los objetos con vistas (filas viejas con otra entidad, como 'tasks', se ignoran).
  return rows.filter((r) => isViewEntity(r.entity) && canSeeView(r, viewer));
}

export interface ViewListFilter {
  entity?: ViewEntity;
  /** Texto en el nombre. */
  q?: string;
  /** Persona que la creó. */
  createdBy?: string;
  /** 'mine' = las que creé; o una visibilidad. */
  shared?: 'mine' | ViewVisibility;
}

/** Vistas que la persona ve, ya redactadas. */
export async function listViews(viewer: ViewViewer, f: ViewListFilter = {}, db: Db = getDb()): Promise<SavedViewDto[]> {
  const rows = await visibleRows(viewer, f.entity ?? null, db);
  const hiddenByEntity = new Map<string, Set<string>>();
  const out: SavedViewDto[] = [];
  const q = f.q?.trim().toLowerCase();
  for (const row of rows) {
    if (!hiddenByEntity.has(row.entity)) hiddenByEntity.set(row.entity, await hiddenFor(viewer, row.entity, db));
    const dto = toViewDto(row, viewer, hiddenByEntity.get(row.entity)!);
    if (q && !dto.name.toLowerCase().includes(q)) continue;
    if (f.createdBy && dto.createdBy !== f.createdBy) continue;
    if (f.shared === 'mine' && !dto.mine) continue;
    if (f.shared && f.shared !== 'mine' && dto.visibility !== f.shared) continue;
    out.push(dto);
  }
  return out;
}

/** Una vista por id si la persona la ve; null si no existe o no la ve. */
export async function getView(viewer: ViewViewer, id: string, db: Db = getDb()): Promise<SavedViewDto | null> {
  const row = (await db
    .prepare('SELECT * FROM crm_saved_views WHERE id = ? AND user_id = ?')
    .get(id, viewer.workspaceId)) as CrmSavedViewRow | undefined;
  if (!row || !canSeeView(row, viewer)) return null;
  return toViewDto(row, viewer, await hiddenFor(viewer, row.entity, db));
}

/** Equipo válido para una vista de equipo: uno de la persona (un admin, cualquiera del workspace). */
async function checkTeam(viewer: ViewViewer, teamId: string | null | undefined, db: Db): Promise<boolean> {
  if (!teamId) return false;
  if (viewer.teamIds.has(teamId)) return true;
  if (!viewer.isAdmin) return false;
  return !!(await db.prepare('SELECT 1 FROM crm_sales_teams WHERE id = ? AND user_id = ?').get(teamId, viewer.workspaceId));
}

export interface ViewInput {
  entity: ViewEntity;
  name: string;
  query?: Record<string, unknown>;
  visibility?: ViewVisibility;
  teamId?: string | null;
}

/** Guarda lo que la persona puede ver: sin campos que tiene ocultos. */
async function cleanQuery(viewer: ViewViewer, entity: ViewEntity, query: Record<string, unknown> | undefined, db: Db): Promise<ViewQuery> {
  return redactViewQuery(pickViewState(entity, query ?? {}), await hiddenFor(viewer, entity, db));
}

export async function createView(
  viewer: ViewViewer,
  input: ViewInput,
  db: Db = getDb(),
): Promise<{ ok: true; view: SavedViewDto } | { ok: false; error: ViewWriteError }> {
  const visibility = normalizeVisibility(input.visibility ?? 'private');
  if (visibility === 'team' && !(await checkTeam(viewer, input.teamId, db))) return { ok: false, error: 'invalid_team' };
  const count = (await db
    .prepare('SELECT COUNT(*) AS c FROM crm_saved_views WHERE user_id = ? AND entity = ?')
    .get(viewer.workspaceId, input.entity)) as { c: number };
  if (Number(count.c) >= MAX_VIEWS) return { ok: false, error: 'too_many' };
  const id = crypto.randomUUID();
  const query = await cleanQuery(viewer, input.entity, input.query, db);
  await db
    .prepare(
      `INSERT INTO crm_saved_views (id, user_id, person_id, entity, name, query, visibility, team_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
    .run(
      id,
      viewer.workspaceId,
      viewer.personId,
      input.entity,
      input.name.trim().slice(0, 200),
      JSON.stringify(query),
      visibility,
      visibility === 'team' ? input.teamId! : null,
    );
  // La vista nueva se abre como pestaña de quien la creó.
  const tabs = await getTabs(viewer, input.entity, db);
  await saveTabs(viewer, input.entity, addTab(tabs, id), db);
  return { ok: true, view: (await getView(viewer, id, db))! };
}

export interface ViewPatch {
  name?: string;
  query?: Record<string, unknown>;
  visibility?: ViewVisibility;
  teamId?: string | null;
}

async function editableRow(
  viewer: ViewViewer,
  id: string,
  db: Db,
): Promise<{ ok: true; row: CrmSavedViewRow } | { ok: false; error: ViewWriteError }> {
  const row = (await db
    .prepare('SELECT * FROM crm_saved_views WHERE id = ? AND user_id = ?')
    .get(id, viewer.workspaceId)) as CrmSavedViewRow | undefined;
  if (!row || !canSeeView(row, viewer)) return { ok: false, error: 'not_found' };
  if (!canEditView(row, viewer)) return { ok: false, error: 'forbidden' };
  return { ok: true, row };
}

export async function updateView(
  viewer: ViewViewer,
  id: string,
  patch: ViewPatch,
  db: Db = getDb(),
): Promise<{ ok: true; view: SavedViewDto } | { ok: false; error: ViewWriteError }> {
  const found = await editableRow(viewer, id, db);
  if (!found.ok) return found;
  const { row } = found;
  const entity = row.entity as ViewEntity;
  const visibility = patch.visibility !== undefined ? normalizeVisibility(patch.visibility) : normalizeVisibility(row.visibility);
  let teamId: string | null = null;
  if (visibility === 'team') {
    const wanted = patch.teamId !== undefined ? patch.teamId : row.team_id;
    // El equipo que la vista ya tenía sigue valiendo aunque quien edita (un admin) no esté en él.
    const unchanged = normalizeVisibility(row.visibility) === 'team' && wanted === row.team_id;
    if (!wanted || (!unchanged && !(await checkTeam(viewer, wanted, db)))) return { ok: false, error: 'invalid_team' };
    teamId = wanted;
  }
  const name = patch.name !== undefined ? patch.name.trim().slice(0, 200) : row.name;
  // Una vista que filtra por campos que el editor tiene ocultos no se reescribe: los borraría sin verlos.
  if (patch.query !== undefined && viewQueryDropsFilters(parseQuery(row.query), await hiddenFor(viewer, entity, db))) {
    return { ok: false, error: 'forbidden' };
  }
  // Lo que el editor no ve (campos ocultos para él) no se guarda: la edición reemplaza el estado.
  const query = patch.query !== undefined ? JSON.stringify(await cleanQuery(viewer, entity, patch.query, db)) : row.query;
  await db
    .prepare(
      `UPDATE crm_saved_views SET name = ?, query = ?, visibility = ?, team_id = ?, updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`,
    )
    .run(name, query, visibility, teamId, id, viewer.workspaceId);
  return { ok: true, view: (await getView(viewer, id, db))! };
}

export async function deleteView(
  viewer: ViewViewer,
  id: string,
  db: Db = getDb(),
): Promise<{ ok: true } | { ok: false; error: ViewWriteError }> {
  const found = await editableRow(viewer, id, db);
  if (!found.ok) return found;
  await db.prepare('DELETE FROM crm_saved_views WHERE id = ? AND user_id = ?').run(id, viewer.workspaceId);
  return { ok: true };
}

// ---------- Pestañas ----------

/**
 * Pestañas de la persona para el objeto, sin las vistas que ya no ve. Sin
 * nada guardado: las vistas por defecto y las compartidas que ve.
 */
export async function getTabs(viewer: ViewViewer, entity: ViewEntity, db: Db = getDb()): Promise<TabPref[]> {
  const [row, rows] = await Promise.all([
    db
      .prepare('SELECT tabs FROM crm_view_tabs WHERE user_id = ? AND person_id = ? AND entity = ?')
      .get(viewer.workspaceId, viewer.personId, entity) as Promise<{ tabs: string } | undefined>,
    visibleRows(viewer, entity, db),
  ]);
  const ids = new Set(rows.map((r) => r.id));
  const known = (key: string) => isDefaultViewKey(entity, key) || ids.has(key);
  const saved = parseTabs(row?.tabs);
  if (saved) {
    const tabs = normalizeTabs(saved, known);
    if (tabs.length) return tabs;
  }
  return normalizeTabs([...DEFAULT_VIEWS[entity].map((d) => ({ key: d.key })), ...rows.map((r) => ({ key: r.id }))], known);
}

async function saveTabs(viewer: ViewViewer, entity: ViewEntity, tabs: TabPref[], db: Db): Promise<void> {
  await db
    .prepare(
      `INSERT INTO crm_view_tabs (user_id, person_id, entity, tabs, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, person_id, entity) DO UPDATE SET tabs = excluded.tabs, updated_at = excluded.updated_at`,
    )
    .run(viewer.workspaceId, viewer.personId, entity, JSON.stringify(tabs));
}

/** Guarda las pestañas: solo vistas por defecto o que la persona ve; al menos una. */
export async function setTabs(viewer: ViewViewer, entity: ViewEntity, tabs: TabPref[], db: Db = getDb()): Promise<TabPref[]> {
  const ids = new Set((await visibleRows(viewer, entity, db)).map((r) => r.id));
  const clean = normalizeTabs(tabs, (key) => isDefaultViewKey(entity, key) || ids.has(key));
  const out = clean.length ? clean : [{ key: 'all' }];
  await saveTabs(viewer, entity, out, db);
  return out;
}

// ---------- Para las páginas de listado ----------

export interface ListViewContext {
  views: SavedViewDto[];
  tabs: TabPref[];
  /** La que se abre sin `sv`: la primera pestaña. */
  defaultKey: string;
  /** Vista activa: una por defecto o una guardada que la persona ve. */
  activeKey: string;
  activeQuery: ViewQuery;
  activeView: SavedViewDto | null;
}

/**
 * Vistas, pestañas y vista activa de un listado. Sin `sv`, la primera
 * pestaña; un `sv` que no existe o que la persona no ve cae en "Todos".
 */
export async function listViewContext(
  viewer: ViewViewer,
  entity: ViewEntity,
  sv: string | undefined,
  hidden: ReadonlySet<string>,
  db: Db = getDb(),
): Promise<ListViewContext> {
  const rows = await visibleRows(viewer, entity, db);
  const views = rows.map((r) => toViewDto(r, viewer, hidden));
  const tabs = await getTabs(viewer, entity, db);
  // Sin `sv` se abre la primera pestaña (fijar una vista la deja por defecto, como en HubSpot).
  const defaultKey = tabs[0]?.key ?? 'all';
  const key = sv ?? defaultKey;
  const def = DEFAULT_VIEWS[entity].find((d) => d.key === key);
  const saved = !def ? views.find((v) => v.id === key) ?? null : null;
  if (saved) return { views, tabs, defaultKey, activeKey: saved.id, activeQuery: saved.query, activeView: saved };
  const active = def ?? DEFAULT_VIEWS[entity][0];
  return { views, tabs, defaultKey, activeKey: active.key, activeQuery: active.query, activeView: null };
}
