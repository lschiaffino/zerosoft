/**
 * Extras de web analytics con base: visitantes en este momento y web vitals
 * (p75 con filas acotadas). Server-only.
 */
import { getDb } from '../db';
import { resolveRange } from './compute';
import { personJoins, PERSON_KEY } from './sql-build';
import { computeVitals, webFiltersSql, type VitalRow } from './web-core';
import type { ProjectRow } from './projects';
import type { VitalsResult, WebFilter } from './more-types';

export const VITALS_ROW_CAP = 20_000;
const LIVE_WINDOW_MS = 5 * 60_000;

/** Personas distintas con algún evento en los últimos 5 minutos. */
export async function liveVisitors(project: ProjectRow, now = Date.now()): Promise<number> {
  const r = (await getDb()
    .prepare(`SELECT COUNT(DISTINCT ${PERSON_KEY}) AS n FROM analytics_events e ${personJoins(false)} WHERE e.project_id = ? AND e.ts >= ? AND e.ts <= ?`)
    .get(project.id, now - LIVE_WINDOW_MS, now + 60_000)) as { n: number } | undefined;
  return Number(r?.n ?? 0);
}

const v = (metric: string) => `json_extract(e.properties, '$."$web_vitals_${metric}_value"')`;

export async function webVitals(project: ProjectRow, query: { from?: string; filters?: readonly WebFilter[] }, now = Date.now()): Promise<VitalsResult> {
  const range = resolveRange({ from: query.from ?? '-7d' }, now, Number(project.tz_offset_min));
  const f = webFiltersSql(query.filters ?? []);
  const rows = (await getDb()
    .prepare(
      `SELECT e.pathname AS path, ${v('LCP')} AS LCP, ${v('INP')} AS INP, ${v('CLS')} AS CLS, ${v('FCP')} AS FCP FROM analytics_events e
       WHERE e.project_id = ? AND e.event = '$web_vitals' AND e.ts >= ? AND e.ts <= ?${f.sql ? ` AND ${f.sql}` : ''} ORDER BY e.ts DESC LIMIT ?`,
    )
    .all(project.id, range.from, range.to, ...f.args, VITALS_ROW_CAP + 1)) as unknown as VitalRow[];
  return computeVitals(rows.slice(0, VITALS_ROW_CAP), rows.length > VITALS_ROW_CAP);
}

/** Filtros desde la URL de la API: ?f=path:/x&f=device:Mobile. */
export function parseWebFilters(values: readonly string[]): WebFilter[] {
  const keys = new Set(['path', 'host', 'device', 'country', 'channel', 'referrer', 'utm', 'browser', 'os']);
  const out: WebFilter[] = [];
  for (const raw of values.slice(0, 9)) {
    const at = raw.indexOf(':');
    if (at <= 0) continue;
    const key = raw.slice(0, at);
    const value = raw.slice(at + 1).slice(0, 500);
    if (keys.has(key) && value) out.push({ key: key as WebFilter['key'], value });
  }
  return out;
}
