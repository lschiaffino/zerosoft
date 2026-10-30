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
 * - paréntesis balanceados, sin CROSS/NATURAL ni FROM con comas, como mucho
 *   dos tablas (expandiendo las CTEs) y, si son dos, un solo JOIN entre tablas
 *   virtuales por una clave conocida (ver checkJoins): ninguna consulta puede
 *   multiplicar filas.
 * Después se envuelve: las tablas virtuales son CTEs filtradas por
 * project_id, con tope de filas (events, además, a los últimos 90 días) y
 * el resultado tiene LIMIT. lib/analytics/sql-run.ts la corre con tope de tiempo y en solo
 * lectura (PRAGMA query_only en un proceso aparte, o transacción de lectura
 * en Turso).
 */

export const SQL_MAX_ROWS = 1000;

export const VIRTUAL_TABLES = ['events', 'persons', 'person_distinct_ids', 'sessions'] as const;

/** Funciones que se pueden llamar (en minúscula). */
export const ALLOWED_FUNCTIONS = new Set([
  'count', 'sum', 'avg', 'min', 'max', 'total', 'group_concat',
  // Sin printf/format/replace/hex: pueden armar textos enormes con poca consulta.
  'abs', 'round', 'lower', 'upper', 'length', 'substr', 'substring', 'trim', 'ltrim', 'rtrim', 'instr',
  'coalesce', 'ifnull', 'nullif', 'iif', 'cast', 'typeof',
  'date', 'time', 'datetime', 'strftime', 'julianday', 'unixepoch',
  'json_extract', 'json_array_length', 'json_type', 'json_valid', 'json_object', 'json_array', 'json_quote',
  'row_number', 'rank', 'dense_rank', 'percent_rank', 'cume_dist', 'ntile', 'lag', 'lead', 'first_value', 'last_value', 'nth_value',
  'exists', 'in',
]);

/** Palabras que no pueden aparecer (escritura, transacciones, motor). */
const DENIED_KEYWORDS = new Set([
  'insert', 'update', 'delete', 'drop', 'create', 'alter', 'attach', 'detach', 'pragma', 'vacuum', 'reindex', 'analyze',
  'begin', 'commit', 'rollback', 'savepoint', 'release', 'recursive', 'trigger', 'upsert', 'conflict', 'returning', 'into', 'materialized',
  // Joins sin condición (producto cartesiano).
  'cross', 'natural',
]);

/** Tablas virtuales que puede nombrar una consulta (FROM/JOIN), como mucho. */
export const SQL_MAX_TABLE_REFS = 2;
/**
 * Filas que cada tabla virtual puede tener como mucho (events: las más nuevas
 * de la ventana). Con los joins solo por clave, ninguna consulta recorre más de
 * unas pocas veces este número: es el límite de trabajo en Turso, donde la
 * consulta corre en el servidor y libsql no tiene cancelación ni timeout por
 * sentencia (acá solo se deja de esperar).
 */
export const SQL_TABLE_ROW_CAP = 100_000;
/** Ventana de la tabla events: los últimos N días. */
export const SQL_WINDOW_DAYS = 90;

const CLAUSE_END = new Set(['where', 'group', 'order', 'limit', 'having', 'union', 'except', 'intersect', 'window', 'select']);

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
        | 'invalid_character'
        | 'unbalanced_parentheses'
        | 'join_without_condition'
        | 'join_not_allowed'
        | 'too_many_tables';
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
  // Paréntesis balanceados (la consulta va dentro de un SELECT * FROM (…)).
  let depth = 0;
  for (const t of toks) {
    if (t.text === '(') depth++;
    if (t.text === ')' && --depth < 0) return { ok: false, error: 'unbalanced_parentheses' };
  }
  if (depth !== 0) return { ok: false, error: 'unbalanced_parentheses' };
  const joins = checkJoins(toks, virtual);
  if (joins) return { ok: false, error: joins };
  return { ok: true, sql };
}

/**
 * Joins y referencias a tablas (lo que puede multiplicar filas):
 * - se cuentan las referencias de FROM/JOIN de toda la consulta, expandiendo
 *   las CTEs (una CTE vale las tablas que lee, cada vez que se la nombra);
 *   como mucho SQL_MAX_TABLE_REFS en total;
 * - si hay dos, tienen que ser un solo JOIN entre dos tablas virtuales (no
 *   CTEs ni subconsultas) unido por una clave conocida (events.person_id =
 *   persons.id, events.session_id = sessions.id…), con `a.col = b.col` primero
 *   y, si sigue algo, solo con AND (sin OR arriba): el resultado nunca tiene
 *   más filas que la tabla más grande. Nada de FROM con comas ni USING.
 * Así no entran el producto cartesiano, los joins con ON 1=1 o con OR, ni las
 * subconsultas correlacionadas sobre la misma tabla.
 */
const JOIN_KEYS = new Set(
  [
    ['events.person_id', 'persons.id'],
    ['events.distinct_id', 'person_distinct_ids.distinct_id'],
    ['events.session_id', 'sessions.id'],
    ['person_distinct_ids.person_id', 'persons.id'],
    ['sessions.distinct_id', 'person_distinct_ids.distinct_id'],
  ].flatMap(([a, b]) => [`${a}=${b}`, `${b}=${a}`]),
);

type JoinError = 'join_without_condition' | 'too_many_tables' | 'join_not_allowed';

function checkJoins(toks: Token[], virtual: Set<string>): JoinError | null {
  const lower = toks.map((t) => (t.kind === 'word' ? t.text.toLowerCase() : t.text));
  const depthAt: number[] = [];
  let d = 0;
  for (const t of toks) {
    if (t.text === ')') d--;
    depthAt.push(d);
    if (t.text === '(') d++;
  }
  /** Índice del ')' que cierra el '(' en i. */
  const closeOf = (i: number) => {
    for (let j = i + 1; j < toks.length; j++) if (toks[j].text === ')' && depthAt[j] === depthAt[i]) return j;
    return toks.length - 1;
  };

  // CTEs: WITH name [(cols)] AS ( body ), … al principio de cualquier nivel.
  const cte = new Map<string, number>();
  const cteRanges: Array<[number, number, string]> = [];
  for (let i = 0; i < toks.length; i++) {
    if (lower[i] !== 'with') continue;
    let j = i + 1;
    for (;;) {
      const name = lower[j];
      if (toks[j]?.kind !== 'word') break;
      j++;
      if (toks[j]?.text === '(') j = closeOf(j) + 1;
      if (lower[j] !== 'as' || toks[j + 1]?.text !== '(') break;
      const end = closeOf(j + 1);
      cteRanges.push([j + 2, end, name]);
      j = end + 1;
      if (toks[j]?.text !== ',') break;
      j++;
    }
  }
  const inCte = (k: number) => cteRanges.find(([a, b]) => k >= a && k < b);

  /** Referencias de FROM/JOIN en [a, b) (las CTEs ya contadas valen lo suyo). */
  const refsIn = (a: number, b: number, skipCtes: boolean): number => {
    let n = 0;
    for (let k = a; k < b; k++) {
      if (skipCtes && inCte(k)) continue;
      if (lower[k] !== 'from' && lower[k] !== 'join' && !(lower[k] === ',' && fromList(k))) continue;
      const next = toks[k + 1];
      if (!next || next.text === '(') continue; // subconsulta: su FROM cuenta adentro
      n += cte.get(lower[k + 1]) ?? 1;
    }
    return n;
  };
  // Una coma dentro de un FROM (a la misma profundidad) es otra tabla.
  const fromList = (k: number) => {
    for (let j = k - 1; j >= 0; j--) {
      if (depthAt[j] < depthAt[k]) return false;
      if (depthAt[j] > depthAt[k]) continue;
      if (lower[j] === 'from') return true;
      if (CLAUSE_END.has(lower[j]) || lower[j] === 'select') return false;
    }
    return false;
  };
  for (const [a, b, name] of cteRanges) cte.set(name, refsIn(a, b, false));
  const total = refsIn(0, toks.length, true) + 0;
  if (total > SQL_MAX_TABLE_REFS) return 'too_many_tables';

  // Cada FROM: sin comas; cada JOIN entre dos tablas virtuales por una clave.
  let joins = 0;
  for (let i = 0; i < toks.length; i++) {
    if (lower[i] !== 'from') continue;
    const base = depthAt[i];
    const aliases = new Map<string, string>();
    const take = (k: number): number => {
      // tabla [AS] alias → índice siguiente
      const table = lower[k];
      let j = k + 1;
      if (lower[j] === 'as') j++;
      const alias = toks[j]?.kind === 'word' && !CLAUSE_END.has(lower[j]) && !['join', 'on', 'left', 'inner', 'using', 'outer'].includes(lower[j]) ? lower[j++] : table;
      aliases.set(alias, table);
      return j;
    };
    if (toks[i + 1]?.text === '(') continue;
    let j = take(i + 1);
    while (j < toks.length && depthAt[j] >= base) {
      if (depthAt[j] > base) {
        j++;
        continue;
      }
      const w = lower[j];
      if (CLAUSE_END.has(w) || w === ')') break;
      if (w === ',') return 'join_without_condition';
      if (w === 'left' || w === 'inner' || w === 'outer') {
        j++;
        continue;
      }
      if (w !== 'join') {
        j++;
        continue;
      }
      joins++;
      const left = [...aliases.values()][0];
      if (toks[j + 1]?.text === '(') return 'join_not_allowed';
      const right = lower[j + 1];
      if (!virtual.has(left) || !virtual.has(right) || cte.has(left) || cte.has(right)) return 'join_not_allowed';
      j = take(j + 1);
      if (lower[j] !== 'on') return 'join_without_condition';
      // a . col = b . col
      const [a, d1, ca, eq, b, d2, cb] = lower.slice(j + 1, j + 8);
      if (d1 !== '.' || d2 !== '.' || (eq !== '=' && eq !== '==') || a === b) return 'join_not_allowed';
      const ta = aliases.get(a);
      const tb = aliases.get(b);
      if (!ta || !tb || !JOIN_KEYS.has(`${ta}.${ca}=${tb}.${cb}`)) return 'join_not_allowed';
      j += 8;
      // Lo que sigue en el ON solo puede ser AND (sin OR a este nivel).
      while (j < toks.length && depthAt[j] >= base) {
        if (depthAt[j] === base && (CLAUSE_END.has(lower[j]) || ['join', 'left', 'inner', ')'].includes(lower[j]))) break;
        if (depthAt[j] === base && lower[j] === 'or') return 'join_not_allowed';
        j++;
      }
    }
  }
  if (total === 2 && joins !== 1) return 'too_many_tables';
  return null;
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
export function wrapSql(userSql: string, projectId: string, now = Date.now()): { sql: string; args: string[] } {
  const ctes = `WITH
  events AS (
    SELECT e.uuid, e.event, e.distinct_id, COALESCE(m.person_id, e.distinct_id) AS person_id, e.ts AS timestamp,
      datetime(e.ts / 1000, 'unixepoch') AS time, e.session_id, e.properties, e.url AS current_url, e.pathname, e.host,
      e.referrer, e.referring_domain, e.utm_source, e.utm_medium, e.utm_campaign, e.browser, e.os, e.device AS device_type, e.country
    FROM analytics_events e
    LEFT JOIN analytics_person_ids m ON m.project_id = e.project_id AND m.distinct_id = e.distinct_id
    WHERE e.project_id = ? AND e.ts >= CAST(? AS INTEGER)
    ORDER BY e.ts DESC LIMIT ${SQL_TABLE_ROW_CAP}
  ),
  persons AS (
    SELECT id, properties, is_identified, created_at, last_seen FROM analytics_persons WHERE project_id = ?
    ORDER BY last_seen DESC LIMIT ${SQL_TABLE_ROW_CAP}
  ),
  person_distinct_ids AS (
    SELECT distinct_id, person_id FROM analytics_person_ids WHERE project_id = ? LIMIT ${SQL_TABLE_ROW_CAP}
  ),
  sessions AS (
    SELECT id, distinct_id, started_at, ended_at, (ended_at - started_at) / 1000 AS duration_sec, pageviews, events AS event_count,
      entry_path, exit_path, referring_domain, utm_source, country, device AS device_type, browser
    FROM analytics_sessions WHERE project_id = ?
    ORDER BY started_at DESC LIMIT ${SQL_TABLE_ROW_CAP}
  )`;
  return { sql: `${ctes}\nSELECT * FROM (\n${userSql}\n) LIMIT ${SQL_MAX_ROWS + 1}`, args: [projectId, String(now - SQL_WINDOW_DAYS * 86_400_000), projectId, projectId, projectId] };
}
