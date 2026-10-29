/**
 * Piezas de SQL de las consultas de Analytics (puras): filtros de
 * propiedades, cohortes y joins. Todo valor va como parámetro; las claves de
 * propiedades van dentro del path JSON como parámetro también (`$."clave"`).
 */
import type { CohortDefinition, PropertyFilter } from './types';

export type Arg = string | number | null;
export interface Frag {
  sql: string;
  args: Arg[];
}

/** Propiedades de evento con columna propia (más rápidas que json_extract). */
export const EVENT_COLUMNS: Record<string, string> = {
  event: 'e.event',
  distinct_id: 'e.distinct_id',
  $current_url: 'e.url',
  $pathname: 'e.pathname',
  $host: 'e.host',
  $referrer: 'e.referrer',
  $referring_domain: 'e.referring_domain',
  utm_source: 'e.utm_source',
  utm_medium: 'e.utm_medium',
  utm_campaign: 'e.utm_campaign',
  $browser: 'e.browser',
  $os: 'e.os',
  $device_type: 'e.device',
  $geoip_country_code: 'e.country',
  $session_id: 'e.session_id',
};

/** Path JSON de una clave (la clave ya viene validada: sin comillas ni barras). */
export function jsonPath(key: string): string {
  if (/["\\]/.test(key)) throw new Error('invalid_property_key');
  return `$."${key}"`;
}

/** Valor de una propiedad como texto ('true'/'false' para booleanos, como en JS). */
export function propText(key: string, type: 'event' | 'person', eventAlias = 'e', personAlias = 'p'): Frag {
  if (type === 'event' && EVENT_COLUMNS[key]) return { sql: EVENT_COLUMNS[key].replace(/^e\./, `${eventAlias}.`), args: [] };
  const col = type === 'person' ? `${personAlias}.properties` : `${eventAlias}.properties`;
  const path = jsonPath(key);
  return {
    sql: `(CASE json_type(${col}, ?) WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' ELSE CAST(json_extract(${col}, ?) AS TEXT) END)`,
    args: [path, path],
  };
}

function propRaw(key: string, type: 'event' | 'person', eventAlias = 'e', personAlias = 'p'): Frag {
  if (type === 'event' && EVENT_COLUMNS[key]) return { sql: EVENT_COLUMNS[key].replace(/^e\./, `${eventAlias}.`), args: [] };
  const col = type === 'person' ? `${personAlias}.properties` : `${eventAlias}.properties`;
  return { sql: `json_extract(${col}, ?)`, args: [jsonPath(key)] };
}

const likeEscape = (v: string) => v.replace(/[\\%_]/g, (m) => `\\${m}`);

/** Un filtro → condición SQL. Igualdades sin distinguir mayúsculas (como matchProperty). */
export function filterSql(f: Pick<PropertyFilter, 'key' | 'op' | 'value' | 'type'>, eventAlias = 'e', personAlias = 'p'): Frag {
  const type = f.type ?? 'event';
  const value = f.value === undefined || f.value === null ? '' : String(f.value);
  switch (f.op) {
    case 'is_set': {
      const r = propRaw(f.key, type, eventAlias, personAlias);
      return { sql: `${r.sql} IS NOT NULL`, args: r.args };
    }
    case 'is_not_set': {
      const r = propRaw(f.key, type, eventAlias, personAlias);
      return { sql: `${r.sql} IS NULL`, args: r.args };
    }
    case 'eq': {
      const t = propText(f.key, type, eventAlias, personAlias);
      return { sql: `lower(${t.sql}) = lower(?)`, args: [...t.args, value] };
    }
    case 'neq': {
      const t = propText(f.key, type, eventAlias, personAlias);
      return { sql: `(${t.sql} IS NULL OR lower(${t.sql}) != lower(?))`, args: [...t.args, ...t.args, value] };
    }
    case 'contains': {
      const t = propText(f.key, type, eventAlias, personAlias);
      return { sql: `${t.sql} LIKE ? ESCAPE '\\'`, args: [...t.args, `%${likeEscape(value)}%`] };
    }
    case 'not_contains': {
      const t = propText(f.key, type, eventAlias, personAlias);
      return { sql: `(${t.sql} IS NULL OR ${t.sql} NOT LIKE ? ESCAPE '\\')`, args: [...t.args, ...t.args, `%${likeEscape(value)}%`] };
    }
    case 'gt':
    case 'lt': {
      const r = propRaw(f.key, type, eventAlias, personAlias);
      const n = Number(f.value);
      if (!Number.isFinite(n)) return { sql: '0', args: [] };
      return { sql: `(${r.sql} IS NOT NULL AND CAST(${r.sql} AS REAL) ${f.op === 'gt' ? '>' : '<'} ?)`, args: [...r.args, ...r.args, n] };
    }
    default:
      return { sql: '1', args: [] };
  }
}

/** Varios filtros (AND). '' si no hay. */
export function filtersSql(filters: ReadonlyArray<Pick<PropertyFilter, 'key' | 'op' | 'value' | 'type'>>, eventAlias = 'e', personAlias = 'p'): Frag {
  if (!filters.length) return { sql: '', args: [] };
  const parts = filters.map((f) => filterSql(f, eventAlias, personAlias));
  return { sql: parts.map((p) => p.sql).join(' AND '), args: parts.flatMap((p) => p.args) };
}

export function needsPerson(filters: ReadonlyArray<Pick<PropertyFilter, 'type'>>): boolean {
  return filters.some((f) => f.type === 'person');
}

/** Joins a la persona de cada evento (la clave de persona es m.person_id, o el distinct_id si no hay). */
export function personJoins(withProps: boolean, eventAlias = 'e'): string {
  const ids = `LEFT JOIN analytics_person_ids m ON m.project_id = ${eventAlias}.project_id AND m.distinct_id = ${eventAlias}.distinct_id`;
  return withProps ? `${ids} LEFT JOIN analytics_persons p ON p.id = m.person_id` : ids;
}

export const PERSON_KEY = 'COALESCE(m.person_id, e.distinct_id)';

/**
 * Personas de una cohorte (subconsulta de ids de persona): las que cumplen
 * las propiedades y/o hicieron el evento al menos N veces en los últimos D días.
 */
export function cohortSql(projectId: string, def: CohortDefinition, now: number): Frag {
  const parts: Frag[] = [];
  if (def.properties.length) {
    const f = filtersSql(def.properties.map((x) => ({ ...x, type: 'person' as const })), 'e', 'cp');
    parts.push({ sql: `SELECT cp.id FROM analytics_persons cp WHERE cp.project_id = ? AND ${f.sql}`, args: [projectId, ...f.args] });
  }
  if (def.behavior) {
    parts.push({
      sql: `SELECT COALESCE(cm.person_id, ce.distinct_id) FROM analytics_events ce
            LEFT JOIN analytics_person_ids cm ON cm.project_id = ce.project_id AND cm.distinct_id = ce.distinct_id
            WHERE ce.project_id = ? AND ce.event = ? AND ce.ts >= ?
            GROUP BY 1 HAVING COUNT(*) >= ?`,
      args: [projectId, def.behavior.event, now - def.behavior.days * 86_400_000, def.behavior.minCount],
    });
  }
  if (!parts.length) return { sql: 'SELECT cp.id FROM analytics_persons cp WHERE cp.project_id = ?', args: [projectId] };
  return { sql: parts.map((p) => p.sql).join(' INTERSECT '), args: parts.flatMap((p) => p.args) };
}
