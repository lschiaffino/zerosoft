/**
 * Personas de Analytics: lista con búsqueda (por distinct_id, email, nombre u
 * otra propiedad), detalle con su línea de tiempo y borrado (con todos sus
 * eventos y sesiones). Server-only.
 */
import { getDb } from '../db';
import { likeContains } from '../track-views';
import { cohortSql, type Arg } from './sql-build';
import { toLiveEvent } from './query';
import type { CohortDefinition, LiveEvent, PersonRow } from './types';

type Row = Record<string, unknown>;

function props(raw: unknown): Record<string, unknown> {
  try {
    const v = JSON.parse(String(raw ?? '{}'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function toPerson(r: Row): PersonRow {
  return {
    id: String(r.id),
    distinctIds: r.ids ? String(r.ids).split('\u0001').filter(Boolean) : [],
    properties: props(r.properties),
    isIdentified: Number(r.is_identified) === 1,
    createdAt: Number(r.created_at),
    lastSeen: Number(r.last_seen),
  };
}

const IDS = `(SELECT group_concat(distinct_id, char(1)) FROM (SELECT distinct_id FROM analytics_person_ids WHERE project_id = p.project_id AND person_id = p.id LIMIT 20)) AS ids`;

export interface PersonsQuery {
  q?: string | null;
  cohort?: CohortDefinition | null;
  ids?: string[] | null;
  limit?: number;
  offset?: number;
}

export async function listPersons(projectId: string, opts: PersonsQuery = {}, now = Date.now()): Promise<{ persons: PersonRow[]; hasMore: boolean }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const parts = ['p.project_id = ?'];
  const args: Arg[] = [projectId];
  const q = opts.q?.trim();
  if (q) {
    parts.push(
      `(p.properties LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM analytics_person_ids s WHERE s.project_id = p.project_id AND s.person_id = p.id AND s.distinct_id LIKE ? ESCAPE '\\'))`,
    );
    args.push(likeContains(q), likeContains(q));
  }
  if (opts.cohort) {
    const sub = cohortSql(projectId, opts.cohort, now);
    parts.push(`p.id IN (${sub.sql})`);
    args.push(...sub.args);
  }
  if (opts.ids) {
    const ids = opts.ids.slice(0, 200);
    if (!ids.length) return { persons: [], hasMore: false };
    parts.push(`p.id IN (${ids.map(() => '?').join(',')})`);
    args.push(...ids);
  }
  const rows = (await getDb()
    .prepare(`SELECT p.*, ${IDS} FROM analytics_persons p WHERE ${parts.join(' AND ')} ORDER BY p.last_seen DESC, p.id LIMIT ? OFFSET ?`)
    .all(...args, limit + 1, Math.max(0, opts.offset ?? 0))) as Row[];
  return { persons: rows.slice(0, limit).map(toPerson), hasMore: rows.length > limit };
}

export async function countPersons(projectId: string, cohort: CohortDefinition, now = Date.now()): Promise<number> {
  const sub = cohortSql(projectId, cohort, now);
  const row = (await getDb().prepare(`SELECT COUNT(*) AS n FROM (${sub.sql})`).get(...sub.args)) as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

export async function getPerson(projectId: string, id: string): Promise<PersonRow | null> {
  const r = (await getDb().prepare(`SELECT p.*, ${IDS} FROM analytics_persons p WHERE p.id = ? AND p.project_id = ?`).get(id, projectId)) as Row | undefined;
  return r ? toPerson(r) : null;
}

/** Persona de un distinct_id (para el endpoint de borrado por key secreta). */
export async function personIdByDistinctId(projectId: string, distinctId: string): Promise<string | null> {
  const r = (await getDb()
    .prepare('SELECT person_id FROM analytics_person_ids WHERE project_id = ? AND distinct_id = ?')
    .get(projectId, distinctId)) as { person_id: string } | undefined;
  return r?.person_id ?? null;
}

/** Eventos de la persona (todos sus distinct_ids), lo más nuevo primero. */
export async function personEvents(projectId: string, personId: string, opts: { before?: number | null; limit?: number } = {}): Promise<LiveEvent[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const rows = (await getDb()
    .prepare(
      `SELECT id, event, distinct_id, ts, url, pathname, browser, os, device, country, properties FROM analytics_events
       WHERE project_id = ? AND distinct_id IN (SELECT distinct_id FROM analytics_person_ids WHERE project_id = ? AND person_id = ?)
       ${opts.before ? 'AND ts < ?' : ''} ORDER BY ts DESC LIMIT ?`,
    )
    .all(...([projectId, projectId, personId, ...(opts.before ? [opts.before] : []), limit] as Arg[]))) as Row[];
  return rows.map(toLiveEvent);
}

/**
 * Borra la persona con sus eventos, sesiones y distinct_ids (privacidad: el
 * "delete person" de PostHog). Por tandas para no pasar el tiempo de la
 * función con una persona de muchos eventos; devuelve los eventos borrados.
 */
export async function deletePerson(projectId: string, personId: string): Promise<{ deleted: boolean; events: number }> {
  const db = getDb();
  const ids = ((await db
    .prepare('SELECT distinct_id FROM analytics_person_ids WHERE project_id = ? AND person_id = ?')
    .all(projectId, personId)) as Array<{ distinct_id: string }>).map((r) => r.distinct_id);
  const exists = await db.prepare('SELECT 1 AS x FROM analytics_persons WHERE id = ? AND project_id = ?').get(personId, projectId);
  if (!exists && !ids.length) return { deleted: false, events: 0 };
  let events = 0;
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const marks = chunk.map(() => '?').join(',');
    for (let round = 0; round < 200; round++) {
      const res = await db
        .prepare(`DELETE FROM analytics_events WHERE id IN (SELECT id FROM analytics_events WHERE project_id = ? AND distinct_id IN (${marks}) LIMIT 5000)`)
        .run(projectId, ...chunk);
      events += res.changes;
      if (res.changes < 5000) break;
    }
    await db.prepare(`DELETE FROM analytics_sessions WHERE project_id = ? AND distinct_id IN (${marks})`).run(projectId, ...chunk);
  }
  await db.prepare('DELETE FROM analytics_person_ids WHERE project_id = ? AND person_id = ?').run(projectId, personId);
  await db.prepare('DELETE FROM analytics_persons WHERE id = ? AND project_id = ?').run(personId, projectId);
  return { deleted: true, events };
}
