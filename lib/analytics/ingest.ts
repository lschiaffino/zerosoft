/**
 * Ingesta de Analytics, la parte con base: guarda un lote de eventos con sus
 * personas, sesiones y grupos en un solo batch (una transacción, un viaje a
 * Turso). Lo llaman /api/ingest/e (snippet y servidores) y los tests.
 */
import type { InStatement } from '@libsql/client';
import { ensureMigrated, getClient, getDb } from '../db';
import { contextFromHeaders } from '../track';
import { clientIp } from '../rate-limit';
import {
  eventColumns,
  initialProps,
  maskIp,
  planPersons,
  type CleanEvent,
  type PersonState,
  type RequestContext,
} from './ingest-core';
import type { ProjectRow } from './projects';

/** Contexto del pedido: user agent, país y IP (sin headers que pueda inventar el cliente). */
export function requestContext(req: Request): RequestContext {
  const c = contextFromHeaders(req.headers);
  const ua = req.headers.get('user-agent') ?? '';
  // Sin user agent (un servidor): el navegador y el sistema los dice el evento.
  const hasUa = ua.trim().length > 0;
  return {
    country: c.country,
    device: hasUa ? c.device : null,
    browser: hasUa ? c.browser : null,
    os: hasUa ? c.os : null,
    ip: clientIp(req),
  };
}

const DAY = 86_400_000;

function dayOf(ts: number, offsetMin: number): string {
  return new Date(ts + offsetMin * 60_000).toISOString().slice(0, 10);
}

/**
 * Guarda los eventos. Devuelve cuántos entraron (los repetidos por uuid se
 * ignoran). Las personas se resuelven con lo que ya hay en la base para los
 * distinct_ids del lote (una lectura) y el resto va en un batch de escritura.
 */
export async function storeEvents(project: ProjectRow, events: CleanEvent[], ctx: RequestContext | null): Promise<number> {
  if (!events.length) return 0;
  await ensureMigrated();
  const pid = project.id;
  const db = getDb();

  // Personas que ya existen para los ids del lote (incluidos anónimos y alias).
  const ids = new Set<string>();
  for (const e of events) {
    ids.add(e.distinctId);
    const anon = e.properties.$anon_distinct_id;
    if (typeof anon === 'string' && anon) ids.add(anon.slice(0, 200));
    const alias = e.properties.alias;
    if (e.event === '$create_alias' && typeof alias === 'string' && alias) ids.add(alias.slice(0, 200));
  }
  const list = [...ids];
  const existing = new Map<string, PersonState>();
  if (list.length) {
    const rows = (await db
      .prepare(
        `SELECT m.distinct_id, m.person_id, COALESCE(p.is_identified, 0) AS identified FROM analytics_person_ids m
         LEFT JOIN analytics_persons p ON p.id = m.person_id
         WHERE m.project_id = ? AND m.distinct_id IN (${list.map(() => '?').join(',')})`,
      )
      .all(pid, ...list)) as Array<{ distinct_id: string; person_id: string; identified: number }>;
    for (const r of rows) existing.set(r.distinct_id, { personId: r.person_id, identified: Number(r.identified) === 1 });
  }

  const ip = ctx ? (project.anonymize_ip === 1 ? maskIp(ctx.ip) : ctx.ip && ctx.ip !== 'unknown' ? ctx.ip : null) : null;
  const rows = events.map((e) => ({ e, cols: eventColumns(e.properties, ctx) }));
  const plan = planPersons(
    pid,
    rows.map(({ e, cols }) => ({ ...e, initial: initialProps(cols) })),
    existing,
  );

  const stmts: InStatement[] = [];
  // 1. Eventos: un solo INSERT de varias filas (los uuid repetidos se ignoran).
  const COLS = 20;
  const placeholders = `(${Array(COLS).fill('?').join(',')})`;
  for (let i = 0; i < rows.length; i += 40) {
    const chunk = rows.slice(i, i + 40);
    stmts.push({
      sql: `INSERT OR IGNORE INTO analytics_events (project_id, uuid, event, distinct_id, ts, session_id, properties, url, pathname, host, referrer,
              referring_domain, utm_source, utm_medium, utm_campaign, browser, os, device, country, ip)
            VALUES ${chunk.map(() => placeholders).join(',')}`,
      args: chunk.flatMap(({ e, cols }) => [
        pid,
        e.uuid,
        e.event,
        e.distinctId,
        e.ts,
        cols.session_id,
        JSON.stringify(e.properties),
        cols.url,
        cols.pathname,
        cols.host,
        cols.referrer,
        cols.referring_domain,
        cols.utm_source,
        cols.utm_medium,
        cols.utm_campaign,
        cols.browser,
        cols.os,
        cols.device,
        cols.country,
        ip,
      ]),
    });
  }
  // 2. Personas nuevas y sus distinct_ids.
  for (const w of plan.writes.filter((x) => x.created)) {
    stmts.push({
      sql: `INSERT OR IGNORE INTO analytics_persons (id, project_id, properties, is_identified, created_at, last_seen) VALUES (?, ?, '{}', 0, ?, ?)`,
      args: [w.personId, pid, w.firstSeen, w.lastSeen],
    });
  }
  for (const m of plan.mappings) {
    stmts.push({
      sql: 'INSERT OR IGNORE INTO analytics_person_ids (project_id, distinct_id, person_id) VALUES (?, ?, ?)',
      args: [pid, m.distinctId, m.personId],
    });
  }
  // 3. Fusiones: la persona anónima pasa a la identificada (sus propiedades quedan debajo).
  for (const m of plan.merges) {
    stmts.push(
      {
        sql: `UPDATE analytics_persons SET properties = json_patch(COALESCE((SELECT properties FROM analytics_persons WHERE id = ?), '{}'), properties),
                created_at = MIN(created_at, COALESCE((SELECT created_at FROM analytics_persons WHERE id = ?), created_at))
              WHERE id = ? AND project_id = ?`,
        args: [m.from, m.from, m.into, pid],
      },
      { sql: 'UPDATE analytics_person_ids SET person_id = ? WHERE project_id = ? AND person_id = ?', args: [m.into, pid, m.from] },
      { sql: 'DELETE FROM analytics_persons WHERE id = ? AND project_id = ?', args: [m.from, pid] },
    );
  }
  // 4. Propiedades: $set_once queda debajo de lo que había, $set encima.
  for (const w of plan.writes) {
    stmts.push({
      sql: `UPDATE analytics_persons SET properties = json_patch(json_patch(?, properties), ?), last_seen = MAX(last_seen, ?),
              created_at = MIN(created_at, ?), is_identified = MAX(is_identified, ?)
            WHERE id = ? AND project_id = ?`,
      args: [JSON.stringify(w.setOnce), JSON.stringify(w.set), w.lastSeen, w.firstSeen, w.identified ? 1 : 0, w.personId, pid],
    });
  }
  // 5. Sesiones: una fila por $session_id, con entrada, salida y pageviews.
  const sessions = new Map<
    string,
    { distinctId: string; start: number; end: number; pageviews: number; events: number; entry: string | null; exit: string | null; exitTs: number; cols: (typeof rows)[number]['cols'] }
  >();
  for (const { e, cols } of rows) {
    if (!cols.session_id) continue;
    let s = sessions.get(cols.session_id);
    if (!s) {
      s = { distinctId: e.distinctId, start: e.ts, end: e.ts, pageviews: 0, events: 0, entry: null, exit: null, exitTs: 0, cols };
      sessions.set(cols.session_id, s);
    }
    s.start = Math.min(s.start, e.ts);
    s.end = Math.max(s.end, e.ts);
    s.events++;
    if (e.event === '$pageview') {
      s.pageviews++;
      if (!s.entry) s.entry = cols.pathname;
      if (e.ts >= s.exitTs) {
        s.exit = cols.pathname;
        s.exitTs = e.ts;
      }
    }
  }
  for (const [id, s] of sessions) {
    stmts.push({
      sql: `INSERT INTO analytics_sessions (project_id, id, distinct_id, started_at, ended_at, pageviews, events, entry_path, exit_path, referring_domain, utm_source, country, device, browser)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (project_id, id) DO UPDATE SET
              entry_path = CASE WHEN excluded.started_at < started_at OR entry_path IS NULL THEN COALESCE(excluded.entry_path, entry_path) ELSE entry_path END,
              exit_path = CASE WHEN excluded.ended_at >= ended_at THEN COALESCE(excluded.exit_path, exit_path) ELSE exit_path END,
              started_at = MIN(started_at, excluded.started_at),
              ended_at = MAX(ended_at, excluded.ended_at),
              pageviews = pageviews + excluded.pageviews,
              events = events + excluded.events`,
      args: [
        pid,
        id.slice(0, 100),
        s.distinctId,
        s.start,
        s.end,
        s.pageviews,
        s.events,
        s.entry,
        s.exit,
        s.cols.referring_domain,
        s.cols.utm_source,
        s.cols.country,
        s.cols.device,
        s.cols.browser,
      ],
    });
  }
  // 6. Grupos ($groupidentify).
  for (const { e } of rows) {
    if (e.event !== '$groupidentify') continue;
    const type = typeof e.properties.$group_type === 'string' ? e.properties.$group_type.slice(0, 64) : '';
    const key = typeof e.properties.$group_key === 'string' ? e.properties.$group_key.slice(0, 200) : '';
    if (!type || !key) continue;
    const set = e.properties.$group_set && typeof e.properties.$group_set === 'object' ? e.properties.$group_set : {};
    stmts.push({
      sql: `INSERT INTO analytics_groups (project_id, group_type, group_key, properties, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (project_id, group_type, group_key) DO UPDATE SET properties = json_patch(properties, excluded.properties), updated_at = excluded.updated_at`,
      args: [pid, type, key, JSON.stringify(set), e.ts, e.ts],
    });
  }
  // 7. Eventos atrasados (más de 2 días): el rollup diario rehace desde ese día.
  const oldest = Math.min(...events.map((e) => e.ts));
  if (oldest < Date.now() - 2 * DAY && project.rolled_through) {
    const day = dayOf(oldest, Number(project.tz_offset_min));
    stmts.push({
      sql: 'UPDATE analytics_projects SET dirty_from = MIN(COALESCE(dirty_from, ?), ?) WHERE id = ?',
      args: [day, day, pid],
    });
  }

  const results = await getClient().batch(stmts, 'write');
  return results.slice(0, Math.ceil(rows.length / 40)).reduce((a, r) => a + Number(r.rowsAffected), 0);
}
