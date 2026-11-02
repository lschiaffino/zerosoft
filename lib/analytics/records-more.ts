/**
 * Más registros de Analytics por proyecto: acciones, anotaciones, definiciones
 * de eventos, miembros de cohortes estáticas y links públicos. El proyecto ya
 * se validó contra el workspace en la ruta. Server-only.
 */
import { randomBytes } from 'crypto';
import { nanoid } from 'nanoid';
import { getDb } from '../db';
import { actionStepSchema, ACTION_PREFIX, type ActionDto, type AnnotationDto, type EventDefinitionDto } from './types';
import { z } from 'zod';

const nowIso = () => new Date().toISOString();
const DAY = 86_400_000;

// ---------- Acciones ----------

interface ActionRow {
  id: string;
  name: string;
  description: string;
  steps: string;
  created_at: string;
  updated_at: string;
}

function toAction(r: ActionRow): ActionDto {
  let steps: ActionDto['steps'] = [];
  try {
    const parsed = z.array(actionStepSchema).safeParse(JSON.parse(r.steps));
    if (parsed.success) steps = parsed.data;
  } catch {
    steps = [];
  }
  return { id: r.id, name: r.name, description: r.description, steps, createdAt: r.created_at, updatedAt: r.updated_at };
}

export async function listActions(projectId: string): Promise<ActionDto[]> {
  const rows = await getDb().prepare('SELECT * FROM analytics_actions WHERE project_id = ? ORDER BY updated_at DESC LIMIT 500').all(projectId);
  return (rows as unknown as ActionRow[]).map(toAction);
}

export async function getAction(projectId: string, id: string): Promise<ActionDto | null> {
  const r = (await getDb().prepare('SELECT * FROM analytics_actions WHERE id = ? AND project_id = ?').get(id, projectId)) as ActionRow | undefined;
  return r ? toAction(r) : null;
}

export async function createAction(projectId: string, personId: string, input: Pick<ActionDto, 'name' | 'description' | 'steps'>): Promise<ActionDto> {
  const id = `aa_${nanoid(12)}`;
  const ts = nowIso();
  await getDb()
    .prepare('INSERT INTO analytics_actions (id, project_id, name, description, steps, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, projectId, input.name, input.description, JSON.stringify(input.steps), personId, ts, ts);
  return (await getAction(projectId, id))!;
}

export async function updateAction(projectId: string, id: string, patch: Partial<Pick<ActionDto, 'name' | 'description' | 'steps'>>): Promise<ActionDto | null> {
  const cur = await getAction(projectId, id);
  if (!cur) return null;
  await getDb()
    .prepare('UPDATE analytics_actions SET name = ?, description = ?, steps = ?, updated_at = ? WHERE id = ? AND project_id = ?')
    .run(patch.name ?? cur.name, patch.description ?? cur.description, JSON.stringify(patch.steps ?? cur.steps), nowIso(), id, projectId);
  return getAction(projectId, id);
}

export async function deleteAction(projectId: string, id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM analytics_actions WHERE id = ? AND project_id = ?').run(id, projectId);
  return res.changes > 0;
}

export function isActionRef(event: string): boolean {
  return event.startsWith(ACTION_PREFIX);
}

// ---------- Anotaciones ----------

interface AnnotationRow {
  id: string;
  day: string;
  content: string;
  created_at: string;
}

const toAnnotation = (r: AnnotationRow): AnnotationDto => ({ id: r.id, date: r.day, content: r.content, createdAt: r.created_at });

export async function listAnnotations(projectId: string): Promise<AnnotationDto[]> {
  const rows = await getDb().prepare('SELECT id, day, content, created_at FROM analytics_annotations WHERE project_id = ? ORDER BY day DESC, created_at DESC LIMIT 500').all(projectId);
  return (rows as unknown as AnnotationRow[]).map(toAnnotation);
}

export async function createAnnotation(projectId: string, personId: string, input: { date: string; content: string }): Promise<AnnotationDto> {
  const id = `an_${nanoid(12)}`;
  const ts = nowIso();
  await getDb()
    .prepare('INSERT INTO analytics_annotations (id, project_id, day, content, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, projectId, input.date, input.content, personId, ts, ts);
  return { id, date: input.date, content: input.content, createdAt: ts };
}

export async function updateAnnotation(projectId: string, id: string, patch: { date: string; content: string }): Promise<boolean> {
  const res = await getDb().prepare('UPDATE analytics_annotations SET day = ?, content = ?, updated_at = ? WHERE id = ? AND project_id = ?').run(patch.date, patch.content, nowIso(), id, projectId);
  return res.changes > 0;
}

export async function deleteAnnotation(projectId: string, id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM analytics_annotations WHERE id = ? AND project_id = ?').run(id, projectId);
  return res.changes > 0;
}

// ---------- Definiciones de eventos ----------

/** Eventos vistos en 30 días más los que tienen definición. */
export async function listEventDefinitions(projectId: string, now = Date.now()): Promise<EventDefinitionDto[]> {
  const db = getDb();
  const [seen, defs] = await Promise.all([
    db.prepare('SELECT event, COUNT(*) AS n, MAX(ts) AS last FROM analytics_events WHERE project_id = ? AND ts >= ? GROUP BY event ORDER BY n DESC LIMIT 300').all(projectId, now - 30 * DAY),
    db.prepare('SELECT event, description, verified, hidden FROM analytics_event_defs WHERE project_id = ? LIMIT 500').all(projectId),
  ]);
  const byEvent = new Map((defs as Array<{ event: string; description: string; verified: number; hidden: number }>).map((d) => [d.event, d]));
  const out: EventDefinitionDto[] = (seen as Array<{ event: string; n: number; last: number }>).map((r) => {
    const d = byEvent.get(r.event);
    byEvent.delete(r.event);
    return { event: r.event, description: d?.description ?? '', verified: Number(d?.verified ?? 0) === 1, hidden: Number(d?.hidden ?? 0) === 1, count30d: Number(r.n), lastSeen: Number(r.last) };
  });
  for (const d of byEvent.values()) {
    out.push({ event: d.event, description: d.description, verified: Number(d.verified) === 1, hidden: Number(d.hidden) === 1, count30d: 0, lastSeen: null });
  }
  return out;
}

export async function hiddenEvents(projectId: string): Promise<Set<string>> {
  const rows = (await getDb().prepare('SELECT event FROM analytics_event_defs WHERE project_id = ? AND hidden = 1 LIMIT 500').all(projectId)) as Array<{ event: string }>;
  return new Set(rows.map((r) => r.event));
}

export async function saveEventDefinition(projectId: string, event: string, patch: { description: string; verified: boolean; hidden: boolean }): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO analytics_event_defs (project_id, event, description, verified, hidden, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (project_id, event) DO UPDATE SET description = excluded.description, verified = excluded.verified, hidden = excluded.hidden, updated_at = excluded.updated_at`,
    )
    .run(projectId, event, patch.description, patch.verified ? 1 : 0, patch.hidden ? 1 : 0, nowIso());
}

// ---------- Cohortes estáticas ----------

export const STATIC_COHORT_MAX = 50_000;

/**
 * Suma personas a una cohorte estática. Cada valor es un id de persona, un
 * distinct_id o un email; lo que no matchea se cuenta y no se guarda.
 */
export async function addCohortMembers(projectId: string, cohortId: string, values: string[]): Promise<{ added: number; notFound: number }> {
  const db = getDb();
  const list = [...new Set(values.map((v) => v.trim()).filter(Boolean))].slice(0, STATIC_COHORT_MAX);
  let added = 0;
  let notFound = 0;
  for (let i = 0; i < list.length; i += 200) {
    const chunk = list.slice(i, i + 200);
    const marks = chunk.map(() => '?').join(',');
    const found = (await db
      .prepare(
        `SELECT p.id AS person, p.id AS v FROM analytics_persons p WHERE p.project_id = ? AND p.id IN (${marks})
         UNION SELECT m.person_id, m.distinct_id FROM analytics_person_ids m WHERE m.project_id = ? AND m.distinct_id IN (${marks})
         UNION SELECT p.id, lower(json_extract(p.properties, '$.email')) FROM analytics_persons p WHERE p.project_id = ? AND lower(json_extract(p.properties, '$.email')) IN (${marks})`,
      )
      .all(projectId, ...chunk, projectId, ...chunk, projectId, ...chunk.map((c) => c.toLowerCase()))) as Array<{ person: string; v: string }>;
    const matched = new Set(found.map((f) => String(f.v).toLowerCase()));
    notFound += chunk.filter((c) => !matched.has(c.toLowerCase())).length;
    for (const person of new Set(found.map((f) => f.person))) {
      const res = await db.prepare('INSERT OR IGNORE INTO analytics_cohort_members (cohort_id, project_id, person_key) VALUES (?, ?, ?)').run(cohortId, projectId, person);
      added += res.changes;
    }
  }
  return { added, notFound };
}

/** Lee una lista de CSV o texto: la primera columna de cada línea, sin encabezado obvio. */
export function parseMemberList(text: string): string[] {
  const lines = text.split(/\r?\n/).map((l) => l.split(/[,;\t]/)[0].trim().replace(/^"|"$/g, '')).filter(Boolean);
  if (lines.length && /^(id|email|distinct_id|distinctid|person|user)$/i.test(lines[0])) lines.shift();
  return lines.map((l) => l.slice(0, 200));
}

// ---------- Links públicos ----------

export interface ShareRow {
  id: string;
  token: string;
  project_id: string;
  insight_id: string | null;
  dashboard_id: string | null;
  created_at: string;
}

export function isAnalyticsShareToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export async function listShares(projectId: string, target: { insightId?: string; dashboardId?: string }): Promise<ShareRow[]> {
  const col = target.insightId ? 'insight_id' : 'dashboard_id';
  return (await getDb()
    .prepare(`SELECT id, token, project_id, insight_id, dashboard_id, created_at FROM analytics_shares WHERE project_id = ? AND ${col} = ? ORDER BY created_at DESC LIMIT 10`)
    .all(projectId, target.insightId ?? target.dashboardId ?? '')) as unknown as ShareRow[];
}

export async function createShare(projectId: string, personId: string, target: { insightId?: string; dashboardId?: string }): Promise<ShareRow> {
  const id = `as_${nanoid(12)}`;
  const token = randomBytes(32).toString('base64url');
  const ts = nowIso();
  await getDb()
    .prepare('INSERT INTO analytics_shares (id, token, project_id, insight_id, dashboard_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, token, projectId, target.insightId ?? null, target.dashboardId ?? null, personId, ts);
  return { id, token, project_id: projectId, insight_id: target.insightId ?? null, dashboard_id: target.dashboardId ?? null, created_at: ts };
}

/** ¿Lo que se quiere tocar se ve en algún link público? Un insight también, si está en un tablero compartido. */
export async function hasActiveShare(projectId: string, target: { insightId?: string; dashboardId?: string }): Promise<boolean> {
  const row = target.insightId
    ? await getDb()
        .prepare(
          `SELECT 1 AS x FROM analytics_shares s WHERE s.project_id = ? AND (s.insight_id = ? OR s.dashboard_id IN (SELECT dashboard_id FROM analytics_dashboard_items WHERE insight_id = ?)) LIMIT 1`,
        )
        .get(projectId, target.insightId, target.insightId)
    : await getDb().prepare('SELECT 1 AS x FROM analytics_shares WHERE project_id = ? AND dashboard_id = ? LIMIT 1').get(projectId, target.dashboardId ?? '');
  return Boolean(row);
}

export async function revokeShare(projectId: string, id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM analytics_shares WHERE id = ? AND project_id = ?').run(id, projectId);
  return res.changes > 0;
}

/** Share por token, solo si su proyecto sigue vivo. */
export async function shareByToken(token: string): Promise<ShareRow | null> {
  if (!isAnalyticsShareToken(token)) return null;
  const row = (await getDb()
    .prepare(
      `SELECT s.id, s.token, s.project_id, s.insight_id, s.dashboard_id, s.created_at FROM analytics_shares s
       JOIN analytics_projects p ON p.id = s.project_id WHERE s.token = ? AND p.deleted_at IS NULL`,
    )
    .get(token)) as ShareRow | undefined;
  return row ?? null;
}
