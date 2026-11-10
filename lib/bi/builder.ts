/**
 * Constructor sin código → SQL. Puro (lo usan el servidor, la vista previa
 * del editor y los tests). Toda columna y tabla se valida contra el esquema
 * de la fuente antes de escribirla: nada del pedido llega al SQL sin pasar
 * por el esquema o por un literal escapado.
 */
import type { Bucket, BuilderQuery, Dialect, SchemaTable } from './types';

export class BuildError extends Error {
  constructor(
    public code: string,
    public detail?: string,
  ) {
    super(code);
  }
}

const PLAIN = /^[a-z_][a-z0-9_]*$/i;

export function quoteIdent(name: string, dialect: Dialect): string {
  if (dialect === 'sqlite') {
    // Las tablas propias se validan con la lista blanca, que no acepta comillas.
    if (!PLAIN.test(name)) throw new BuildError('bad_identifier', name);
    return name;
  }
  return name
    .split('.')
    .map((part) => (dialect === 'mysql' ? `\`${part.replace(/`/g, '``')}\`` : `"${part.replace(/"/g, '""')}"`))
    .join('.');
}

/** Literal SQL seguro para el dialecto. */
export function literal(value: unknown, dialect: Dialect): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new BuildError('bad_value');
    // Entre paréntesis: un negativo después de un "-" no arma un comentario (--5).
    return value < 0 ? `(${value})` : String(value);
  }
  if (typeof value === 'boolean') return value ? '1' : '0';
  let s = String(value);
  // Sin caracteres de control (NUL corta strings en algunos drivers).
  s = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  if (dialect === 'mysql') s = s.replace(/\\/g, '\\\\');
  // Postgres: E'…' interpreta la barra igual con cualquier standard_conforming_strings.
  if (dialect === 'postgres' && s.includes('\\')) return `E'${s.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
  return `'${s.replace(/'/g, "''")}'`;
}

function bucketExpr(col: string, bucket: Bucket, dialect: Dialect): string {
  if (dialect === 'sqlite') {
    if (bucket === 'day') return `date(${col})`;
    if (bucket === 'week') return `date(${col}, 'weekday 0', '-6 days')`;
    if (bucket === 'month') return `strftime('%Y-%m-01', ${col})`;
    return `strftime('%Y-01-01', ${col})`;
  }
  if (dialect === 'postgres') return `CAST(date_trunc('${bucket}', ${col}) AS date)`;
  if (bucket === 'day') return `DATE(${col})`;
  if (bucket === 'week') return `DATE(DATE_SUB(${col}, INTERVAL WEEKDAY(${col}) DAY))`;
  if (bucket === 'month') return `DATE_FORMAT(${col}, '%Y-%m-01')`;
  return `DATE_FORMAT(${col}, '%Y-01-01')`;
}

interface Resolved {
  sql: string;
  /** Nombre de salida (alias legible). */
  label: string;
  type: string;
}

export interface BuiltQuery {
  sql: string;
  /** Columnas de salida en orden. */
  outputs: string[];
}

export function buildSql(q: BuilderQuery, schema: SchemaTable[], dialect: Dialect, opts: { allowedJoins?: ReadonlySet<string> } = {}): BuiltQuery {
  const byName = new Map(schema.map((t) => [t.name.toLowerCase(), t]));
  const base = byName.get(q.table.toLowerCase());
  if (!base) throw new BuildError('unknown_table', q.table);
  const aliasOf = new Map<string, string>([[base.name.toLowerCase(), 't0']]);
  const tables = new Map<string, typeof base>([['t0', base]]);
  const joins: string[] = [];

  const resolve = (ref: string): Resolved => {
    const dot = ref.lastIndexOf('.');
    let table = base;
    let alias = 't0';
    let colName = ref;
    if (dot > 0) {
      const tName = ref.slice(0, dot).toLowerCase();
      const a = aliasOf.get(tName);
      if (!a) throw new BuildError('unknown_column', ref);
      alias = a;
      table = tables.get(a)!;
      colName = ref.slice(dot + 1);
    }
    const col = table.columns.find((c) => c.name.toLowerCase() === colName.toLowerCase());
    if (!col) throw new BuildError('unknown_column', ref);
    return { sql: `${alias}.${quoteIdent(col.name, dialect)}`, label: dot > 0 ? `${table.name.split('.').pop()}_${col.name}` : col.name, type: col.type };
  };

  q.joins.forEach((j, i) => {
    const t = byName.get(j.table.toLowerCase());
    if (!t || aliasOf.has(t.name.toLowerCase())) throw new BuildError('unknown_table', j.table);
    const alias = `t${i + 1}`;
    aliasOf.set(t.name.toLowerCase(), alias);
    tables.set(alias, t);
    const left = resolve(j.left);
    const right = resolve(j.right.includes('.') ? j.right : `${t.name}.${j.right}`);
    if (opts.allowedJoins) {
      const lt = j.left.includes('.') ? j.left : `${base.name}.${j.left}`;
      const rt = j.right.includes('.') ? j.right : `${t.name}.${j.right}`;
      if (!opts.allowedJoins.has(`${lt.toLowerCase()}=${rt.toLowerCase()}`)) throw new BuildError('join_not_allowed', `${lt} = ${rt}`);
    }
    joins.push(`${j.type === 'inner' ? 'JOIN' : 'LEFT JOIN'} ${quoteIdent(t.name, dialect)} ${alias} ON ${left.sql} = ${right.sql}`);
  });

  const where: string[] = [];
  for (const f of q.filters) {
    const c = resolve(f.column);
    const v = f.value;
    switch (f.op) {
      case 'empty':
        where.push(`(${c.sql} IS NULL OR ${c.sql} = '')`);
        break;
      case 'not_empty':
        where.push(`(${c.sql} IS NOT NULL AND ${c.sql} <> '')`);
        break;
      case 'contains':
      case 'not_contains': {
        const needle = literal(String(v ?? '').toLowerCase(), dialect);
        const expr =
          dialect === 'sqlite' ? `instr(lower(${c.sql}), ${needle}) > 0` : dialect === 'postgres' ? `strpos(lower(CAST(${c.sql} AS text)), ${needle}) > 0` : `LOCATE(${needle}, LOWER(${c.sql})) > 0`;
        where.push(f.op === 'contains' ? expr : `NOT (${expr})`);
        break;
      }
      case 'starts': {
        const needle = literal(String(v ?? '').toLowerCase(), dialect);
        const len = String(v ?? '').length;
        where.push(dialect === 'sqlite' ? `substr(lower(${c.sql}), 1, ${len}) = ${needle}` : `LOWER(SUBSTRING(CAST(${c.sql} AS ${dialect === 'mysql' ? 'CHAR' : 'text'}), 1, ${len})) = ${needle}`);
        break;
      }
      case 'last_days': {
        const n = Math.max(1, Math.min(3650, Math.floor(Number(v) || 30)));
        where.push(
          dialect === 'sqlite'
            ? `date(${c.sql}) >= date('now', '-${n} days')`
            : dialect === 'postgres'
              ? `${c.sql} >= CURRENT_DATE - ${n}`
              : `${c.sql} >= CURDATE() - INTERVAL ${n} DAY`,
        );
        break;
      }
      default: {
        if (v === undefined || v === '') throw new BuildError('filter_value_required', f.column);
        const lit = c.type === 'number' && typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? literal(Number(v), dialect) : literal(v, dialect);
        where.push(`${c.sql} ${f.op === '!=' ? '<>' : f.op} ${lit}`);
      }
    }
  }

  const selects: string[] = [];
  const groups: string[] = [];
  const outputs: string[] = [];
  const used = new Set<string>();
  const out = (label: string) => {
    const clean = label.replace(/[^a-z0-9_]/gi, '_').toLowerCase().replace(/^([0-9])/, '_$1') || 'col';
    let name = clean;
    let n = 2;
    while (used.has(name)) name = `${clean}_${n++}`;
    used.add(name);
    outputs.push(name);
    return name;
  };
  for (const b of q.breakouts) {
    const c = resolve(b.column);
    const expr = b.bucket && c.type === 'date' ? bucketExpr(c.sql, b.bucket, dialect) : c.sql;
    selects.push(`${expr} AS ${out(c.label)}`);
    groups.push(expr);
  }
  for (const a of q.aggregations) {
    if (a.fn === 'count') {
      selects.push(`COUNT(*) AS ${out('count')}`);
      continue;
    }
    if (!a.column) throw new BuildError('aggregation_column_required', a.fn);
    const c = resolve(a.column);
    const fn = a.fn === 'distinct' ? 'COUNT(DISTINCT' : a.fn.toUpperCase() + '(';
    selects.push(`${fn}${a.fn === 'distinct' ? ' ' : ''}${c.sql}) AS ${out(`${a.fn}_${c.label}`)}`);
  }
  if (!selects.length) {
    // Sin resumen: las columnas de la tabla base (y las unidas, con prefijo).
    for (const [alias, t] of tables) {
      for (const col of t.columns) {
        const label = alias === 't0' ? col.name : `${t.name.split('.').pop()}_${col.name}`;
        selects.push(`${alias}.${quoteIdent(col.name, dialect)} AS ${out(label)}`);
      }
    }
  }

  const orders: string[] = [];
  for (const s of q.sort) {
    if (outputs.includes(s.column)) orders.push(`${s.column} ${s.dir.toUpperCase()}`);
    else orders.push(`${resolve(s.column).sql} ${s.dir.toUpperCase()}`);
  }
  if (!orders.length && groups.length) orders.push(`${outputs[0]} ASC`);

  const limit = q.limit ?? (groups.length || q.aggregations.length ? undefined : 2000);
  const sql = [
    `SELECT ${selects.join(', ')}`,
    `FROM ${quoteIdent(base.name, dialect)} t0`,
    ...joins,
    where.length ? `WHERE ${where.join(' AND ')}` : '',
    groups.length ? `GROUP BY ${groups.join(', ')}` : '',
    orders.length ? `ORDER BY ${orders.join(', ')}` : '',
    limit ? `LIMIT ${limit}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return { sql, outputs };
}

/**
 * Variables del SQL: {{nombre}} se reemplaza por el literal del valor y
 * [[ … {{nombre}} … ]] desaparece si la variable está vacía (como en Metabase).
 */
export function applyParams(
  sql: string,
  params: Array<{ name: string; type: 'text' | 'number' | 'date'; default?: string }>,
  values: Record<string, string | undefined>,
  dialect: Dialect,
): string {
  const valueOf = (name: string): string | undefined => {
    const p = params.find((x) => x.name.toLowerCase() === name.toLowerCase());
    const raw = values[name] ?? values[name.toLowerCase()] ?? p?.default;
    return raw === undefined || raw === '' ? undefined : raw;
  };
  const lit = (name: string): string => {
    const p = params.find((x) => x.name.toLowerCase() === name.toLowerCase());
    const v = valueOf(name);
    if (v === undefined) throw new BuildError('param_required', name);
    if (p?.type === 'number') {
      const n = Number(v);
      if (!Number.isFinite(n)) throw new BuildError('param_not_number', name);
      return literal(n, dialect);
    }
    if (p?.type === 'date' && !/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/.test(v)) throw new BuildError('param_not_date', name);
    return literal(v, dialect);
  };
  assertPlaceholdersInCode(sql);
  const optional = sql.replace(/\[\[([\s\S]*?)\]\]/g, (_m, inner: string) => {
    const names = [...inner.matchAll(/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi)].map((m) => m[1]);
    return names.every((n) => valueOf(n) !== undefined) ? inner : '';
  });
  return optional.replace(/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi, (_m, name: string) => lit(name));
}

/**
 * Una variable va donde iría un valor, nunca adentro de comillas ni de un
 * comentario: ahí el valor dejaría de ser un literal.
 */
export function assertPlaceholdersInCode(sql: string): void {
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const two = sql.slice(i, i + 2);
    if (two === '{{') {
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const end = sql.indexOf(c, i + 1);
      const body = end < 0 ? sql.slice(i + 1) : sql.slice(i + 1, end);
      if (body.includes('{{')) throw new BuildError('param_in_quotes');
      // Comilla doble escapada ('' o "") sigue el mismo literal.
      i = end < 0 ? sql.length : end + 1;
      continue;
    }
    if (two === '--') {
      const end = sql.indexOf('\n', i);
      if ((end < 0 ? sql.slice(i) : sql.slice(i, end)).includes('{{')) throw new BuildError('param_in_quotes');
      i = end < 0 ? sql.length : end + 1;
      continue;
    }
    if (two === '/*') {
      const end = sql.indexOf('*/', i + 2);
      if ((end < 0 ? sql.slice(i) : sql.slice(i, end)).includes('{{')) throw new BuildError('param_in_quotes');
      i = end < 0 ? sql.length : end + 2;
      continue;
    }
    i++;
  }
}

/** Variables que usa un SQL (para armar el formulario). */
export function paramNames(sql: string): string[] {
  return [...new Set([...sql.matchAll(/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi)].map((m) => m[1]))];
}
