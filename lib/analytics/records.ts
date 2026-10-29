/**
 * Lo que la persona crea en Analytics, por proyecto: insights guardados,
 * tableros, cohortes y feature flags. Todo se busca por (project_id, id): el
 * proyecto ya se validó contra el workspace en la ruta. Server-only.
 */
import { nanoid } from 'nanoid';
import { getDb } from '../db';
import { likeContains } from '../track-views';
import {
  cohortDefinitionSchema,
  insightQuerySchema,
  type CohortDefinition,
  type CohortDto,
  type DashboardDto,
  type FlagDto,
  type FlagInput,
  type InsightDto,
  type InsightQuery,
} from './types';
import { forgetFlagsCache } from './flags';

const now = () => new Date().toISOString();
const cleanName = (s: string, fallback: string) => s.trim().slice(0, 200) || fallback;

function parseJson<T>(raw: unknown, fallback: T): T {
  try {
    return JSON.parse(String(raw ?? '')) as T;
  } catch {
    return fallback;
  }
}

// ---------- Insights ----------

interface InsightRow {
  id: string;
  kind: string;
  name: string;
  description: string;
  query: string;
  created_at: string;
  updated_at: string;
}

function toInsight(r: InsightRow): InsightDto {
  const parsed = insightQuerySchema.safeParse(parseJson(r.query, {}));
  const query: InsightQuery = parsed.success ? parsed.data : insightQuerySchema.parse({ kind: 'trends', series: [{ event: '$pageview' }] });
  return { id: r.id, kind: query.kind, name: r.name, description: r.description, query, createdAt: r.created_at, updatedAt: r.updated_at };
}

export async function listInsights(projectId: string, q?: string): Promise<InsightDto[]> {
  const rows = q
    ? await getDb()
        .prepare(`SELECT * FROM analytics_insights WHERE project_id = ? AND name LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT 200`)
        .all(projectId, likeContains(q))
    : await getDb().prepare('SELECT * FROM analytics_insights WHERE project_id = ? ORDER BY updated_at DESC LIMIT 500').all(projectId);
  return (rows as unknown as InsightRow[]).map(toInsight);
}

export async function getInsight(projectId: string, id: string): Promise<InsightDto | null> {
  const r = (await getDb().prepare('SELECT * FROM analytics_insights WHERE id = ? AND project_id = ?').get(id, projectId)) as InsightRow | undefined;
  return r ? toInsight(r) : null;
}

export async function createInsight(projectId: string, personId: string, input: { name: string; description?: string; query: InsightQuery }): Promise<InsightDto> {
  const id = `ai_${nanoid(12)}`;
  const ts = now();
  await getDb()
    .prepare('INSERT INTO analytics_insights (id, project_id, kind, name, description, query, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, projectId, input.query.kind, cleanName(input.name, 'Untitled insight'), (input.description ?? '').slice(0, 2000), JSON.stringify(input.query), personId, ts, ts);
  return (await getInsight(projectId, id))!;
}

export async function updateInsight(
  projectId: string,
  id: string,
  patch: { name?: string; description?: string; query?: InsightQuery },
): Promise<InsightDto | null> {
  const cur = await getInsight(projectId, id);
  if (!cur) return null;
  const query = patch.query ?? cur.query;
  await getDb()
    .prepare('UPDATE analytics_insights SET name = ?, description = ?, kind = ?, query = ?, updated_at = ? WHERE id = ? AND project_id = ?')
    .run(
      patch.name !== undefined ? cleanName(patch.name, cur.name) : cur.name,
      patch.description !== undefined ? patch.description.slice(0, 2000) : cur.description,
      query.kind,
      JSON.stringify(query),
      now(),
      id,
      projectId,
    );
  return getInsight(projectId, id);
}

export async function deleteInsight(projectId: string, id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM analytics_insights WHERE id = ? AND project_id = ?').run(id, projectId);
  return res.changes > 0;
}

// ---------- Tableros ----------

interface DashboardRow {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  items: string | null;
}

function toDashboard(r: DashboardRow): DashboardDto {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    insightIds: r.items ? String(r.items).split(',').filter(Boolean) : [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const DASHBOARD_SELECT = `SELECT d.*, (SELECT group_concat(insight_id) FROM (SELECT insight_id FROM analytics_dashboard_items WHERE dashboard_id = d.id ORDER BY position, insight_id)) AS items
  FROM analytics_dashboards d`;

export async function listDashboards(projectId: string, q?: string): Promise<DashboardDto[]> {
  const rows = q
    ? await getDb().prepare(`${DASHBOARD_SELECT} WHERE d.project_id = ? AND d.name LIKE ? ESCAPE '\\' ORDER BY d.name LIMIT 200`).all(projectId, likeContains(q))
    : await getDb().prepare(`${DASHBOARD_SELECT} WHERE d.project_id = ? ORDER BY d.name COLLATE NOCASE LIMIT 500`).all(projectId);
  return (rows as unknown as DashboardRow[]).map(toDashboard);
}

export async function getDashboard(projectId: string, id: string): Promise<DashboardDto | null> {
  const r = (await getDb().prepare(`${DASHBOARD_SELECT} WHERE d.id = ? AND d.project_id = ?`).get(id, projectId)) as DashboardRow | undefined;
  return r ? toDashboard(r) : null;
}

export async function createDashboard(projectId: string, personId: string, input: { name: string; description?: string }): Promise<DashboardDto> {
  const id = `ad_${nanoid(12)}`;
  const ts = now();
  await getDb()
    .prepare('INSERT INTO analytics_dashboards (id, project_id, name, description, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, projectId, cleanName(input.name, 'Untitled dashboard'), (input.description ?? '').slice(0, 2000), personId, ts, ts);
  return (await getDashboard(projectId, id))!;
}

export async function updateDashboard(projectId: string, id: string, patch: { name?: string; description?: string; insightIds?: string[] }): Promise<DashboardDto | null> {
  const cur = await getDashboard(projectId, id);
  if (!cur) return null;
  const db = getDb();
  await db
    .prepare('UPDATE analytics_dashboards SET name = ?, description = ?, updated_at = ? WHERE id = ? AND project_id = ?')
    .run(
      patch.name !== undefined ? cleanName(patch.name, cur.name) : cur.name,
      patch.description !== undefined ? patch.description.slice(0, 2000) : cur.description,
      now(),
      id,
      projectId,
    );
  if (patch.insightIds) {
    // Solo insights del mismo proyecto, en el orden pedido.
    const valid = new Set((await listInsights(projectId)).map((i) => i.id));
    const ids = [...new Set(patch.insightIds)].filter((x) => valid.has(x)).slice(0, 50);
    await db.prepare('DELETE FROM analytics_dashboard_items WHERE dashboard_id = ?').run(id);
    for (const [i, insightId] of ids.entries()) {
      await db.prepare('INSERT INTO analytics_dashboard_items (dashboard_id, insight_id, position) VALUES (?, ?, ?)').run(id, insightId, i);
    }
  }
  return getDashboard(projectId, id);
}

export async function deleteDashboard(projectId: string, id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM analytics_dashboards WHERE id = ? AND project_id = ?').run(id, projectId);
  return res.changes > 0;
}

// ---------- Cohortes ----------

interface CohortRow {
  id: string;
  name: string;
  definition: string;
  created_at: string;
  updated_at: string;
}

function toCohort(r: CohortRow): CohortDto {
  const parsed = cohortDefinitionSchema.safeParse(parseJson(r.definition, {}));
  return {
    id: r.id,
    name: r.name,
    definition: parsed.success ? parsed.data : { properties: [], behavior: null },
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listCohorts(projectId: string, q?: string): Promise<CohortDto[]> {
  const rows = q
    ? await getDb().prepare(`SELECT * FROM analytics_cohorts WHERE project_id = ? AND name LIKE ? ESCAPE '\\' ORDER BY name LIMIT 200`).all(projectId, likeContains(q))
    : await getDb().prepare('SELECT * FROM analytics_cohorts WHERE project_id = ? ORDER BY updated_at DESC LIMIT 500').all(projectId);
  return (rows as unknown as CohortRow[]).map(toCohort);
}

export async function getCohort(projectId: string, id: string): Promise<CohortDto | null> {
  const r = (await getDb().prepare('SELECT * FROM analytics_cohorts WHERE id = ? AND project_id = ?').get(id, projectId)) as CohortRow | undefined;
  return r ? toCohort(r) : null;
}

export async function createCohort(projectId: string, personId: string, input: { name: string; definition: CohortDefinition }): Promise<CohortDto> {
  const id = `ac_${nanoid(12)}`;
  const ts = now();
  await getDb()
    .prepare('INSERT INTO analytics_cohorts (id, project_id, name, definition, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, projectId, cleanName(input.name, 'Untitled cohort'), JSON.stringify(input.definition), personId, ts, ts);
  return (await getCohort(projectId, id))!;
}

export async function updateCohort(projectId: string, id: string, patch: { name?: string; definition?: CohortDefinition }): Promise<CohortDto | null> {
  const cur = await getCohort(projectId, id);
  if (!cur) return null;
  await getDb()
    .prepare('UPDATE analytics_cohorts SET name = ?, definition = ?, updated_at = ? WHERE id = ? AND project_id = ?')
    .run(patch.name !== undefined ? cleanName(patch.name, cur.name) : cur.name, JSON.stringify(patch.definition ?? cur.definition), now(), id, projectId);
  return getCohort(projectId, id);
}

export async function deleteCohort(projectId: string, id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM analytics_cohorts WHERE id = ? AND project_id = ?').run(id, projectId);
  return res.changes > 0;
}

// ---------- Flags ----------

interface FlagRow {
  id: string;
  key: string;
  name: string;
  active: number;
  rollout: number;
  variants: string;
  conditions: string;
  created_at: string;
  updated_at: string;
}

export function toFlag(r: FlagRow): FlagDto {
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    active: Number(r.active) === 1,
    rollout: Number(r.rollout),
    variants: parseJson(r.variants, []),
    conditions: parseJson(r.conditions, []),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listFlags(projectId: string, q?: string): Promise<FlagDto[]> {
  const rows = q
    ? await getDb()
        .prepare(`SELECT * FROM analytics_flags WHERE project_id = ? AND (key LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\') ORDER BY key LIMIT 200`)
        .all(projectId, likeContains(q), likeContains(q))
    : await getDb().prepare('SELECT * FROM analytics_flags WHERE project_id = ? ORDER BY updated_at DESC LIMIT 500').all(projectId);
  return (rows as unknown as FlagRow[]).map(toFlag);
}

export async function getFlag(projectId: string, id: string): Promise<FlagDto | null> {
  const r = (await getDb().prepare('SELECT * FROM analytics_flags WHERE id = ? AND project_id = ?').get(id, projectId)) as FlagRow | undefined;
  return r ? toFlag(r) : null;
}

export async function createFlag(projectId: string, personId: string, input: FlagInput): Promise<FlagDto | 'duplicate_key'> {
  const id = `af_${nanoid(12)}`;
  const ts = now();
  try {
    await getDb()
      .prepare(
        `INSERT INTO analytics_flags (id, project_id, key, name, active, rollout, variants, conditions, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, projectId, input.key, input.name, input.active ? 1 : 0, input.rollout, JSON.stringify(input.variants), JSON.stringify(input.conditions), personId, ts, ts);
  } catch (err) {
    if (/UNIQUE/i.test(String(err))) return 'duplicate_key';
    throw err;
  }
  forgetFlagsCache(projectId);
  return (await getFlag(projectId, id))!;
}

export async function updateFlag(projectId: string, id: string, patch: Partial<FlagInput>): Promise<FlagDto | null | 'duplicate_key'> {
  const cur = await getFlag(projectId, id);
  if (!cur) return null;
  const next = { ...cur, ...patch };
  try {
    await getDb()
      .prepare(
        `UPDATE analytics_flags SET key = ?, name = ?, active = ?, rollout = ?, variants = ?, conditions = ?, updated_at = ? WHERE id = ? AND project_id = ?`,
      )
      .run(next.key, next.name, next.active ? 1 : 0, next.rollout, JSON.stringify(next.variants), JSON.stringify(next.conditions), now(), id, projectId);
  } catch (err) {
    if (/UNIQUE/i.test(String(err))) return 'duplicate_key';
    throw err;
  }
  forgetFlagsCache(projectId);
  return getFlag(projectId, id);
}

export async function deleteFlag(projectId: string, id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM analytics_flags WHERE id = ? AND project_id = ?').run(id, projectId);
  forgetFlagsCache(projectId);
  return res.changes > 0;
}
