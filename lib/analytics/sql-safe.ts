/**
 * SQL de Analytics: una consulta de solo lectura sobre las tablas virtuales
 * del proyecto (`events`, `persons`, `person_distinct_ids`, `sessions`).
 *
 * No es un parser de SQL completo: es una lista blanca estricta sobre los
 * tokens. Se rechaza todo lo que no esté permitido:
 * - una sola sentencia que empieza con SELECT o WITH (sin `;` en el medio);
 * - sin comentarios, sin identificadores entre comillas, sin parámetros;
 * - sin palabras de escritura o de motor (INSERT, UPDATE, DELETE, PRAGMA,
 *   ATTACH, RECURSIVE…);
 * - cada función llamada tiene que estar en la lista (nada de json_each,
 *   pragma_*, load_extension…);
 * - ningún identificador puede nombrar una tabla real de la base (se pasa la
 *   lista de sqlite_master) ni empezar con sqlite_ o pragma_.
 * Después se envuelve: las tablas virtuales son CTEs filtradas por
 * project_id y el resultado tiene LIMIT. El servidor además la corre en una
 * transacción de solo lectura.
 */

export const SQL_MAX_ROWS = 1000;

export const VIRTUAL_TABLES = ['events', 'persons', 'person_distinct_ids', 'sessions'] as const;

/** Funciones que se pueden llamar (en minúscula). */
export const ALLOWED_FUNCTIONS = new Set([
  'count', 'sum', 'avg', 'min', 'max', 'total', 'group_concat',
  'abs', 'round', 'lower', 'upper', 'length', 'substr', 'substring', 'trim', 'ltrim', 'rtrim', 'replace', 'instr',
  'coalesce', 'ifnull', 'nullif', 'iif', 'cast', 'typeof', 'printf', 'format', 'hex',
  'date', 'time', 'datetime', 'strftime', 'julianday', 'unixepoch',
  'json_extract', 'json_array_length', 'json_type', 'json_valid', 'json_object', 'json_array', 'json_quote',
  'row_number', 'rank', 'dense_rank', 'percent_rank', 'cume_dist', 'ntile', 'lag', 'lead', 'first_value', 'last_value', 'nth_value',
  'exists', 'in',
]);

/** Palabras que no pueden aparecer (escritura, transacciones, motor). */
const DENIED_KEYWORDS = new Set([
  'insert', 'update', 'delete', 'drop', 'create', 'alter', 'attach', 'detach', 'pragma', 'vacuum', 'reindex', 'analyze',
  'begin', 'commit', 'rollback', 'savepoint', 'release', 'recursive', 'trigger', 'upsert', 'conflict', 'returning', 'into', 'materialized',
]);

/** Palabras clave que pueden ir seguidas de "(" sin ser funciones. */
const PAREN_KEYWORDS = new Set([
  'select', 'from', 'where', 'and', 'or', 'not', 'in', 'exists', 'as', 'on', 'join', 'using', 'over', 'partition', 'filter', 'values',
  'cast', 'case', 'when', 'then', 'else', 'with', 'union', 'all', 'intersect', 'except', 'having', 'by', 'is', 'like', 'between',
]);

export type SqlCheck =
  | { ok: true; sql: string }
  | {
      ok: false;
      error:
        | 'empty'
        | 'too_long'
        | 'multiple_statements'
        | 'comments_not_allowed'
        | 'quoted_identifiers_not_allowed'
        | 'parameters_not_allowed'
        | 'must_start_with_select'
        | 'keyword_not_allowed'
        | 'function_not_allowed'
        | 'table_not_allowed'
        | 'unterminated_string'
        | 'invalid_character';
      detail?: string;
    };

type Token = { kind: 'word' | 'string' | 'number' | 'punct'; text: string };

function tokenize(sql: string): Token[] | SqlCheck {
  const out: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if ((c === '-' && sql[i + 1] === '-') || (c === '/' && sql[i + 1] === '*')) return { ok: false, error: 'comments_not_allowed' };
    if (c === '"' || c === '`' || c === '[') return { ok: false, error: 'quoted_identifiers_not_allowed' };
    if (c === '?' || c === ':' || c === '@' || c === '$') return { ok: false, error: 'parameters_not_allowed' };
    if (c === "'") {
      let j = i + 1;
      let text = "'";
      for (;;) {
        if (j >= sql.length) return { ok: false, error: 'unterminated_string' };
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            text += "''";
            j += 2;
            continue;
          }
          text += "'";
          j++;
          break;
        }
        text += sql[j];
        j++;
      }
      out.push({ kind: 'string', text });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(sql[i + 1] ?? ''))) {
      const m = /^(0x[0-9a-f]+|[0-9]*\.?[0-9]+(e[+-]?[0-9]+)?)/i.exec(sql.slice(i));
      const text = m ? m[0] : c;
      out.push({ kind: 'number', text });
      i += text.length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(sql.slice(i))!;
      // x'..' (blob) no hace falta: se rechaza como identificador seguido de string.
      out.push({ kind: 'word', text: m[0] });
      i += m[0].length;
      continue;
    }
    const two = sql.slice(i, i + 2);
    if (['<=', '>=', '<>', '!=', '==', '||', '<<', '>>'].includes(two)) {
      out.push({ kind: 'punct', text: two });
      i += 2;
      continue;
    }
    if ('(),.*+-/%=<>&|~;'.includes(c)) {
      out.push({ kind: 'punct', text: c });
      i++;
      continue;
    }
    return { ok: false, error: 'invalid_character', detail: c };
  }
  return out;
}

/**
 * Valida la consulta. `realTables` son los nombres de las tablas y vistas de
 * la base (sqlite_master): ninguno puede aparecer como identificador.
 */
export function checkSql(input: string, realTables: Iterable<string>): SqlCheck {
  const sql = input.trim();
  if (!sql) return { ok: false, error: 'empty' };
  if (sql.length > 10_000) return { ok: false, error: 'too_long' };
  const toks = tokenize(sql);
  if (!Array.isArray(toks)) return toks;
  // Un `;` final se tolera; cualquier otro es una segunda sentencia.
  while (toks.length && toks[toks.length - 1].text === ';') toks.pop();
  if (!toks.length) return { ok: false, error: 'empty' };
  if (toks.some((t) => t.text === ';')) return { ok: false, error: 'multiple_statements' };
  const first = toks[0].text.toLowerCase();
  if (toks[0].kind !== 'word' || (first !== 'select' && first !== 'with')) return { ok: false, error: 'must_start_with_select' };

  const virtual = new Set<string>(VIRTUAL_TABLES);
  const forbidden = new Set<string>();
  for (const t of realTables) {
    const n = t.toLowerCase();
    if (!virtual.has(n)) forbidden.add(n);
  }

  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.kind === 'string' && k > 0 && toks[k - 1].kind === 'word' && /^x$/i.test(toks[k - 1].text)) {
      return { ok: false, error: 'invalid_character', detail: "x''" };
    }
    if (t.kind !== 'word') continue;
    const w = t.text.toLowerCase();
    if (DENIED_KEYWORDS.has(w)) return { ok: false, error: 'keyword_not_allowed', detail: t.text };
    if (w.startsWith('sqlite_') || w.startsWith('pragma_')) return { ok: false, error: 'table_not_allowed', detail: t.text };
    if (forbidden.has(w)) return { ok: false, error: 'table_not_allowed', detail: t.text };
    const next = toks[k + 1];
    if (next?.text === '(' && !PAREN_KEYWORDS.has(w) && !ALLOWED_FUNCTIONS.has(w)) {
      return { ok: false, error: 'function_not_allowed', detail: t.text };
    }
  }
  return { ok: true, sql };
}

/** Columnas de las tablas virtuales (para la ayuda del editor y la doc). */
export const VIRTUAL_COLUMNS: Record<(typeof VIRTUAL_TABLES)[number], string[]> = {
  events: [
    'uuid', 'event', 'distinct_id', 'person_id', 'timestamp', 'time', 'session_id', 'properties', 'current_url', 'pathname', 'host',
    'referrer', 'referring_domain', 'utm_source', 'utm_medium', 'utm_campaign', 'browser', 'os', 'device_type', 'country',
  ],
  persons: ['id', 'properties', 'is_identified', 'created_at', 'last_seen'],
  person_distinct_ids: ['distinct_id', 'person_id'],
  sessions: [
    'id', 'distinct_id', 'started_at', 'ended_at', 'duration_sec', 'pageviews', 'event_count', 'entry_path', 'exit_path',
    'referring_domain', 'utm_source', 'country', 'device_type', 'browser',
  ],
};

/**
 * Consulta lista para correr: las CTEs del proyecto (un parámetro por CTE,
 * todos el id del proyecto) y la del usuario como subconsulta con LIMIT.
 */
export function wrapSql(userSql: string, projectId: string): { sql: string; args: string[] } {
  const ctes = `WITH
  events AS (
    SELECT e.uuid, e.event, e.distinct_id, COALESCE(m.person_id, e.distinct_id) AS person_id, e.ts AS timestamp,
      datetime(e.ts / 1000, 'unixepoch') AS time, e.session_id, e.properties, e.url AS current_url, e.pathname, e.host,
      e.referrer, e.referring_domain, e.utm_source, e.utm_medium, e.utm_campaign, e.browser, e.os, e.device AS device_type, e.country
    FROM analytics_events e
    LEFT JOIN analytics_person_ids m ON m.project_id = e.project_id AND m.distinct_id = e.distinct_id
    WHERE e.project_id = ?
  ),
  persons AS (
    SELECT id, properties, is_identified, created_at, last_seen FROM analytics_persons WHERE project_id = ?
  ),
  person_distinct_ids AS (
    SELECT distinct_id, person_id FROM analytics_person_ids WHERE project_id = ?
  ),
  sessions AS (
    SELECT id, distinct_id, started_at, ended_at, (ended_at - started_at) / 1000 AS duration_sec, pageviews, events AS event_count,
      entry_path, exit_path, referring_domain, utm_source, country, device AS device_type, browser
    FROM analytics_sessions WHERE project_id = ?
  )`;
  return { sql: `${ctes}\nSELECT * FROM (\n${userSql}\n) LIMIT ${SQL_MAX_ROWS + 1}`, args: [projectId, projectId, projectId, projectId] };
}
