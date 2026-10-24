/**
 * CRM — reportes propios: guardado (crm_custom_reports) y ejecución. La
 * config (lib/crm-report-builder.ts) se compila a SQL parametrizado: las
 * expresiones salen solo de los mapas de este archivo, nunca del usuario, y
 * los nombres de campos propios se validan contra crm_custom_fields.
 *
 * Asociaciones a muchos (contactos de un deal, deals de una empresa) se
 * resuelven con LEFT JOIN; para que un deal con dos contactos no cuente doble,
 * la métrica se calcula sobre filas DISTINCT (registro medido, dimensiones,
 * valor). La visibilidad por owner se aplica a la fuente y a cada objeto
 * asociado. Server-only.
 */
import { getDb, type Db } from './db';
import { baseAmountSql } from './crm-currency';
import { activityScopeSql, ownerScopeSql, type OwnerScope } from './crm-visibility';
import {
  BUILTIN_FIELDS,
  CUSTOM_FIELD_ENTITY,
  FILTER_OPS,
  SOURCE_OBJECT,
  configObjectsValid,
  fieldName,
  fieldObject,
  reportConfigSchema,
  usedObjects,
  type DateBucket,
  type ReportAgg,
  type ReportColumn,
  type ReportConfig,
  type ReportEnum,
  type ReportFieldType,
  type ReportFilter,
  type ReportObject,
  type ReportResult,
} from './crm-report-builder';
import { FORECAST_DEFAULTS } from './crm-forecast';

export interface CustomReportRow {
  id: string;
  user_id: string;
  name: string;
  config: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CustomReport {
  id: string;
  name: string;
  config: ReportConfig;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export class ReportError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export function parseReportConfig(raw: string): ReportConfig {
  try {
    const parsed = reportConfigSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    /* config rota: cae al default */
  }
  return reportConfigSchema.parse({ source: 'deals' });
}

function toReport(row: CustomReportRow): CustomReport {
  return {
    id: row.id,
    name: row.name,
    config: parseReportConfig(row.config),
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ---------- CRUD ----------

export async function listCustomReports(workspaceId: string, db: Db = getDb()): Promise<CustomReport[]> {
  const rows = (await db
    .prepare('SELECT * FROM crm_custom_reports WHERE user_id = ? ORDER BY updated_at DESC, rowid DESC')
    .all(workspaceId)) as CustomReportRow[];
  return rows.map(toReport);
}

export async function getCustomReport(workspaceId: string, id: string, db: Db = getDb()): Promise<CustomReport | null> {
  const row = (await db.prepare('SELECT * FROM crm_custom_reports WHERE id = ? AND user_id = ?').get(id, workspaceId)) as
    | CustomReportRow
    | undefined;
  return row ? toReport(row) : null;
}

export async function createCustomReport(
  workspaceId: string,
  input: { name: string; config: ReportConfig; createdBy: string },
  db: Db = getDb(),
): Promise<CustomReport> {
  if (!configObjectsValid(input.config)) throw new ReportError('invalid_input');
  const id = crypto.randomUUID();
  await db
    .prepare('INSERT INTO crm_custom_reports (id, user_id, name, config, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(id, workspaceId, input.name.trim(), JSON.stringify(input.config), input.createdBy);
  return (await getCustomReport(workspaceId, id, db))!;
}

export async function updateCustomReport(
  workspaceId: string,
  id: string,
  patch: { name?: string; config?: ReportConfig },
  db: Db = getDb(),
): Promise<CustomReport | null> {
  if (patch.config && !configObjectsValid(patch.config)) throw new ReportError('invalid_input');
  const sets: string[] = [];
  const args: string[] = [];
  if (patch.name !== undefined) {
    sets.push('name = ?');
    args.push(patch.name.trim());
  }
  if (patch.config !== undefined) {
    sets.push('config = ?');
    args.push(JSON.stringify(patch.config));
  }
  if (!sets.length) return getCustomReport(workspaceId, id, db);
  const res = await db
    .prepare(`UPDATE crm_custom_reports SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ? AND user_id = ?`)
    .run(...args, id, workspaceId);
  if (!res.changes) return null;
  return getCustomReport(workspaceId, id, db);
}

/** Borra el reporte y los widgets de dashboard que lo mostraban. */
export async function deleteCustomReport(workspaceId: string, id: string, db: Db = getDb()): Promise<boolean> {
  const res = await db.prepare('DELETE FROM crm_custom_reports WHERE id = ? AND user_id = ?').run(id, workspaceId);
  if (!res.changes) return false;
  await db
    .prepare(
      `DELETE FROM crm_dashboard_widgets WHERE type = 'custom_report' AND json_extract(config, '$.reportId') = ?
         AND dashboard_id IN (SELECT id FROM crm_dashboards WHERE user_id = ?)`,
    )
    .run(id, workspaceId);
  return true;
}

/** ⌘K: reportes por nombre. */
export async function searchCustomReports(workspaceId: string, q: string, limit = 5, db: Db = getDb()): Promise<Array<{ id: string; name: string }>> {
  const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  return (await db
    .prepare(`SELECT id, name FROM crm_custom_reports WHERE user_id = ? AND name LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT ?`)
    .all(workspaceId, like, limit)) as Array<{ id: string; name: string }>;
}

// ---------- Campos ----------

const ALIAS: Record<ReportObject, string> = { contact: 'c', company: 'co', deal: 'd', activity: 'a' };

const BUILTIN_EXPR: Record<ReportObject, Record<string, string>> = {
  contact: {
    name: "TRIM(c.first_name || ' ' || c.last_name)",
    email: 'c.email',
    phone: 'c.phone',
    jobTitle: 'c.job_title',
    city: 'c.city',
    country: 'c.country',
    lifecycle: 'c.lifecycle_stage',
    leadStatus: 'c.lead_status',
    source: 'c.source',
    owner: 'COALESCE(c.owner_id, c.user_id)',
    score: 'c.score',
    created: 'c.created_at',
  },
  company: {
    name: 'co.name',
    domain: 'co.domain',
    industry: 'co.industry',
    employees: 'co.employees',
    city: 'co.city',
    country: 'co.country',
    lifecycle: 'co.lifecycle_stage',
    owner: 'COALESCE(co.owner_id, co.user_id)',
    created: 'co.created_at',
  },
  deal: {
    name: 'd.name',
    amount: baseAmountSql('d'),
    pipeline: 'd.pipeline_id',
    stage: 'd.stage_id',
    priority: 'd.priority',
    source: 'd.source',
    owner: 'COALESCE(d.owner_id, d.user_id)',
    // Misma regla que lib/crm-forecast.ts categoryFor.
    forecastCategory: `(SELECT CASE WHEN xs.is_won = 1 THEN 'closed_won' WHEN xs.is_lost = 1 THEN 'lost'
      WHEN d.forecast_category != '' THEN d.forecast_category
      WHEN xs.probability >= ${FORECAST_DEFAULTS.commit} THEN 'commit'
      WHEN xs.probability >= ${FORECAST_DEFAULTS.best_case} THEN 'best_case' ELSE 'pipeline' END
      FROM crm_stages xs WHERE xs.id = d.stage_id)`,
    closeDate: 'd.close_date',
    closedAt: 'd.closed_at',
    created: 'd.created_at',
  },
  activity: {
    type: 'a.type',
    subject: 'a.subject',
    done: 'a.done',
    owner: 'COALESCE(a.owner_id, a.user_id)',
    outcome: 'a.outcome',
    durationMin: 'a.duration_min',
    dueAt: 'a.due_at',
    doneAt: 'a.done_at',
    created: 'a.created_at',
  },
};

interface ResolvedField extends ReportColumn {
  expr: string;
  obj: ReportObject;
}

const CUSTOM_NAME = /^[A-Za-z0-9_\-]{1,100}$/;

type CustomDefs = Partial<Record<ReportObject, Map<string, { label: string; type: string }>>>;

async function loadCustomDefs(workspaceId: string, objects: ReportObject[], db: Db): Promise<CustomDefs> {
  const out: CustomDefs = {};
  for (const o of objects) {
    const entity = CUSTOM_FIELD_ENTITY[o];
    if (!entity) continue;
    const rows = (await db
      .prepare('SELECT name, label, type FROM crm_custom_fields WHERE user_id = ? AND entity = ?')
      .all(workspaceId, entity)) as Array<{ name: string; label: string; type: string }>;
    out[o] = new Map(rows.map((r) => [r.name, { label: r.label, type: r.type }]));
  }
  return out;
}

function customType(type: string): { type: ReportFieldType; enum?: ReportEnum } {
  if (type === 'number' || type === 'currency') return { type: 'number' };
  if (type === 'date') return { type: 'date' };
  if (type === 'boolean') return { type: 'boolean' };
  if (type === 'user') return { type: 'select', enum: 'owner' };
  if (type === 'select') return { type: 'select', enum: 'options' };
  return { type: 'text' };
}

function resolveField(key: string, config: ReportConfig, defs: CustomDefs): ResolvedField {
  const obj = fieldObject(key);
  if (!obj) throw new ReportError('invalid_field');
  const name = fieldName(key);
  const alias = ALIAS[obj];
  if (name.startsWith('custom:')) {
    const cname = name.slice(7);
    const def = defs[obj]?.get(cname);
    if (!CUSTOM_NAME.test(cname) || !def) throw new ReportError('invalid_field');
    const t = customType(def.type);
    const base = `json_extract(${alias}.custom, '$.${cname}')`;
    return { key, obj, expr: t.type === 'number' ? `CAST(${base} AS REAL)` : base, label: def.label, ...t };
  }
  const builtin = BUILTIN_FIELDS[obj].find((f) => f.name === name && (!f.only || f.only.includes(config.source)));
  const expr = BUILTIN_EXPR[obj][name];
  if (!builtin || !expr) throw new ReportError('invalid_field');
  return { key, obj, expr, type: builtin.type, enum: builtin.enum, money: builtin.money };
}

// ---------- SQL ----------

function inList(n: number): string {
  return `(${new Array(n).fill('?').join(',')})`;
}

function joinScope(alias: string, scope: OwnerScope | undefined): { sql: string; args: string[] } {
  const c = ownerScopeSql(alias, scope);
  return c.sql ? { sql: ` AND ${c.sql}`, args: c.args } : { sql: '', args: [] };
}

/** FROM + JOINs de los objetos usados + WHERE base (workspace, tipo, visibilidad). */
function fromClause(
  workspaceId: string,
  config: ReportConfig,
  objects: ReportObject[],
  scope: OwnerScope | undefined,
): { sql: string; args: string[]; where: string[]; whereArgs: string[] } {
  const base = SOURCE_OBJECT[config.source];
  const args: string[] = [];
  const parts: string[] = [];
  const where: string[] = [];
  const whereArgs: string[] = [];
  const has = (o: ReportObject) => objects.includes(o) && o !== base;
  const js = (alias: string) => {
    const s = joinScope(alias, scope);
    args.push(...s.args);
    return s.sql;
  };

  if (base === 'contact') {
    parts.push('crm_contacts c');
    if (has('company')) parts.push(`LEFT JOIN crm_companies co ON co.id = c.company_id AND co.user_id = c.user_id${js('co')}`);
    if (has('deal')) {
      parts.push('LEFT JOIN crm_deal_contacts xdc ON xdc.contact_id = c.id');
      parts.push(`LEFT JOIN crm_deals d ON d.id = xdc.deal_id AND d.user_id = c.user_id${js('d')}`);
    }
    where.push('c.user_id = ?');
    whereArgs.push(workspaceId);
  } else if (base === 'company') {
    parts.push('crm_companies co');
    if (has('contact')) {
      parts.push('LEFT JOIN crm_contact_companies xcc ON xcc.company_id = co.id');
      parts.push(`LEFT JOIN crm_contacts c ON c.id = xcc.contact_id AND c.user_id = co.user_id${js('c')}`);
    }
    if (has('deal')) {
      parts.push('LEFT JOIN crm_deal_companies xdco ON xdco.company_id = co.id');
      parts.push(`LEFT JOIN crm_deals d ON d.id = xdco.deal_id AND d.user_id = co.user_id${js('d')}`);
    }
    where.push('co.user_id = ?');
    whereArgs.push(workspaceId);
  } else if (base === 'deal') {
    parts.push('crm_deals d');
    if (has('company')) {
      parts.push('LEFT JOIN crm_deal_companies xdco ON xdco.deal_id = d.id AND xdco.is_primary = 1');
      parts.push(`LEFT JOIN crm_companies co ON co.id = xdco.company_id AND co.user_id = d.user_id${js('co')}`);
    }
    if (has('contact')) {
      parts.push('LEFT JOIN crm_deal_contacts xdc ON xdc.deal_id = d.id');
      parts.push(`LEFT JOIN crm_contacts c ON c.id = xdc.contact_id AND c.user_id = d.user_id${js('c')}`);
    }
    where.push('d.user_id = ?');
    whereArgs.push(workspaceId);
  } else {
    parts.push('crm_activities a');
    if (has('contact')) parts.push(`LEFT JOIN crm_contacts c ON c.id = a.contact_id AND c.user_id = a.user_id${js('c')}`);
    if (has('company')) parts.push(`LEFT JOIN crm_companies co ON co.id = a.company_id AND co.user_id = a.user_id${js('co')}`);
    if (has('deal')) parts.push(`LEFT JOIN crm_deals d ON d.id = a.deal_id AND d.user_id = a.user_id${js('d')}`);
    where.push('a.user_id = ?');
    whereArgs.push(workspaceId);
    where.push(config.source === 'tasks' ? "a.type = 'task'" : "a.type != 'task'");
  }

  const baseScope = base === 'activity' ? activityScopeSql('a', scope) : ownerScopeSql(ALIAS[base], scope);
  if (baseScope.sql) {
    where.push(baseScope.sql);
    whereArgs.push(...baseScope.args);
  }
  return { sql: parts.join('\n  '), args, where, whereArgs };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** Condición WHERE de un filtro; null si está incompleto (se ignora). */
export function filterCondition(
  field: Pick<ResolvedField, 'expr' | 'type'>,
  rule: Pick<ReportFilter, 'o' | 'v' | 'v2'>,
): { sql: string; args: Array<string | number> } | null {
  const { expr, type } = field;
  if (!FILTER_OPS[type].includes(rule.o)) return null;
  const v = (rule.v ?? '').trim();
  if (rule.o === 'known') return { sql: `(${expr} IS NOT NULL AND ${expr} != '')`, args: [] };
  if (rule.o === 'unknown') return { sql: `(${expr} IS NULL OR ${expr} = '')`, args: [] };
  if (type === 'text') {
    if (!v) return null;
    if (rule.o === 'contains') return { sql: `${expr} LIKE ? ESCAPE '\\'`, args: [`%${escapeLike(v)}%`] };
    if (rule.o === 'equals') return { sql: `${expr} = ? COLLATE NOCASE`, args: [v] };
    return { sql: `${expr} LIKE ? ESCAPE '\\'`, args: [`${escapeLike(v)}%`] };
  }
  if (type === 'number') {
    const n = Number(v);
    if (!v || !Number.isFinite(n)) return null;
    const op = rule.o === 'eq' ? '=' : rule.o === 'neq' ? '!=' : rule.o === 'gt' ? '>' : '<';
    return { sql: `${expr} ${op} ?`, args: [n] };
  }
  if (type === 'boolean') {
    if (v !== '1' && v !== '0') return null;
    return { sql: `COALESCE(${expr}, 0) = ?`, args: [Number(v)] };
  }
  if (type === 'select') {
    if (!v) return null;
    if (rule.o === 'is') return { sql: `${expr} = ?`, args: [v] };
    return { sql: `(${expr} IS NULL OR ${expr} != ?)`, args: [v] };
  }
  // date
  if (rule.o === 'last') {
    const n = Math.trunc(Number(v));
    if (!Number.isFinite(n) || n < 1 || n > 3650) return null;
    return { sql: `date(${expr}) >= date('now', ?)`, args: [`-${n - 1} days`] };
  }
  if (!ISO_DATE.test(v)) return null;
  if (rule.o === 'before') return { sql: `date(${expr}) < date(?)`, args: [v] };
  if (rule.o === 'after') return { sql: `date(${expr}) > date(?)`, args: [v] };
  const v2 = (rule.v2 ?? '').trim();
  if (!ISO_DATE.test(v2)) return null;
  return { sql: `date(${expr}) BETWEEN date(?) AND date(?)`, args: [v, v2] };
}

export function bucketExpr(expr: string, bucket: DateBucket): string {
  if (bucket === 'day') return `strftime('%Y-%m-%d', ${expr})`;
  if (bucket === 'week') return `strftime('%Y-W%W', ${expr})`;
  if (bucket === 'month') return `strftime('%Y-%m', ${expr})`;
  if (bucket === 'year') return `strftime('%Y', ${expr})`;
  return `(strftime('%Y', ${expr}) || '-Q' || ((CAST(strftime('%m', ${expr}) AS INTEGER) + 2) / 3))`;
}

function aggSql(agg: ReportAgg): string {
  if (agg === 'count') return 'COUNT(__mid)';
  if (agg === 'sum') return 'COALESCE(SUM(__val), 0)';
  if (agg === 'avg') return 'AVG(__val)';
  if (agg === 'min') return 'MIN(__val)';
  return 'MAX(__val)';
}

const RECORD_LIMIT = 500;
const GROUP_LIMIT = 200;

const HREF: Record<ReportObject, string> = {
  contact: '/app/crm/contacts/',
  company: '/app/crm/companies/',
  deal: '/app/crm/deals/',
  activity: '/app/crm/tasks/',
};

/** Ejecuta una config y devuelve filas listas para graficar o listar. */
export async function runReport(
  workspaceId: string,
  rawConfig: ReportConfig,
  opts: { scope?: OwnerScope; people?: Array<{ id: string; name: string }> } = {},
  db: Db = getDb(),
): Promise<ReportResult> {
  const config = reportConfigSchema.parse(rawConfig);
  if (!configObjectsValid(config)) throw new ReportError('invalid_input');
  const objects = usedObjects(config);
  const defs = await loadCustomDefs(workspaceId, objects, db);
  const from = fromClause(workspaceId, config, objects, opts.scope);
  const base = SOURCE_OBJECT[config.source];
  const baseAlias = ALIAS[base];

  const where = [...from.where];
  const whereArgs: Array<string | number> = [...from.whereArgs];
  for (const rule of config.filters) {
    const field = resolveField(rule.f, config, defs);
    const cond = filterCondition(field, rule);
    if (!cond) continue;
    where.push(cond.sql);
    whereArgs.push(...cond.args);
  }
  const whereSql = where.join(' AND ');
  const fromArgs = [...from.args, ...whereArgs];

  const labelFields: ResolvedField[] = [];

  let result: ReportResult;
  const aggregate = config.dimensions.length > 0 || config.viz !== 'table';

  if (!aggregate) {
    const cols = (config.columns.length ? config.columns : [`${base}.${BUILTIN_FIELDS[base].find((f) => !f.only || f.only.includes(config.source))!.name}`])
      .map((k) => resolveField(k, config, defs));
    labelFields.push(...cols);
    const select = cols.map((c, i) => `${c.expr} AS __c${i}`).join(', ');
    const inner = `SELECT DISTINCT ${baseAlias}.id AS __id, ${baseAlias}.created_at AS __sort, ${select}
      FROM ${from.sql} WHERE ${whereSql}`;
    const total = Number(((await db.prepare(`SELECT COUNT(*) AS n FROM (${inner})`).get(...fromArgs)) as { n: number }).n);
    const rows = (await db
      .prepare(`${inner} ORDER BY __sort DESC LIMIT ${RECORD_LIMIT}`)
      .all(...fromArgs)) as Array<Record<string, string | number | null>>;
    result = {
      kind: 'records',
      columns: cols.map(({ expr: _e, obj: _o, ...c }) => c),
      rows: rows.map((r) => ({
        id: String(r.__id),
        href: base === 'activity' && config.source !== 'tasks' ? null : `${HREF[base]}${r.__id}`,
        cells: cols.map((_c, i) => (r[`__c${i}`] ?? null) as string | number | null),
      })),
      labels: {},
      total,
      truncated: total > rows.length,
    };
  } else {
    const dims = config.dimensions.map((d) => {
      const f = resolveField(d.field, config, defs);
      const expr = f.type === 'date' ? bucketExpr(f.expr, d.bucket ?? 'month') : f.type === 'boolean' ? `COALESCE(${f.expr}, 0)` : `NULLIF(${f.expr}, '')`;
      return { field: f, expr };
    });
    labelFields.push(...dims.map((d) => d.field));
    const agg = config.metric.agg;
    const valueField = agg === 'count' ? null : config.metric.field ? resolveField(config.metric.field, config, defs) : null;
    if (agg !== 'count' && (!valueField || valueField.type !== 'number')) throw new ReportError('invalid_metric');
    const mobj: ReportObject = valueField ? valueField.obj : config.metric.object ?? base;
    const mid = `${ALIAS[mobj]}.id`;
    const val = valueField ? valueField.expr : 'NULL';
    const dimSel = dims.map((d, i) => `, ${d.expr} AS __g${i}`).join('');
    const inner = `SELECT DISTINCT ${mid} AS __mid${dimSel}, ${val} AS __val FROM ${from.sql} WHERE ${whereSql}`;
    const groupCols = dims.map((_d, i) => `__g${i}`);
    const order =
      config.sort === 'label' || dims[0]?.field.type === 'date'
        ? groupCols.join(', ') || '1'
        : `__v ${config.sort === 'value_asc' ? 'ASC' : 'DESC'}`;
    const rows = dims.length
      ? ((await db
          .prepare(
            `SELECT ${groupCols.join(', ')}, ${aggSql(agg)} AS __v FROM (${inner}) GROUP BY ${groupCols.join(', ')}
             ORDER BY ${order} LIMIT ${GROUP_LIMIT + 1}`,
          )
          .all(...fromArgs)) as Array<Record<string, string | number | null>>)
      : [];
    const totalInner = `SELECT DISTINCT ${mid} AS __mid, ${val} AS __val FROM ${from.sql} WHERE ${whereSql}`;
    const totalRow = (await db.prepare(`SELECT ${aggSql(agg)} AS __v FROM (${totalInner})`).get(...fromArgs)) as { __v: number | null };
    const round = (n: number | null) => (n === null || n === undefined ? 0 : Math.round(Number(n) * 100) / 100);
    result = {
      kind: 'aggregate',
      dimensions: dims.map(({ field: { expr: _e, obj: _o, ...c } }) => c),
      metric: {
        agg,
        field: valueField ? (({ expr: _e, obj: _o, ...c }) => c)(valueField) : null,
        object: mobj,
      },
      rows: rows.slice(0, GROUP_LIMIT).map((r) => ({
        keys: groupCols.map((g) => (r[g] === null || r[g] === undefined ? null : String(r[g]))),
        value: round(r.__v as number),
      })),
      labels: {},
      total: round(totalRow?.__v ?? 0),
      truncated: rows.length > GROUP_LIMIT,
    };
  }

  result.labels = await resolveLabels(workspaceId, result, labelFields, opts.people ?? [], db);
  return result;
}

/** Nombres para valores con id (owner, etapa, pipeline). */
async function resolveLabels(
  workspaceId: string,
  result: ReportResult,
  fields: ReportColumn[],
  people: Array<{ id: string; name: string }>,
  db: Db,
): Promise<Record<string, string>> {
  const values = new Map<ReportEnum, Set<string>>();
  const add = (e: ReportEnum | undefined, v: string | number | null) => {
    if (!e || v === null || v === undefined) return;
    if (e !== 'owner' && e !== 'stage' && e !== 'pipeline') return;
    const set = values.get(e) ?? new Set<string>();
    set.add(String(v));
    values.set(e, set);
  };
  if (result.kind === 'records') {
    for (const r of result.rows) r.cells.forEach((v, i) => add(fields[i]?.enum, v));
  } else {
    for (const r of result.rows) r.keys.forEach((v, i) => add(fields[i]?.enum, v));
  }
  const out: Record<string, string> = {};
  const owners = values.get('owner');
  if (owners) {
    const names = new Map(people.map((p) => [p.id, p.name]));
    for (const id of owners) if (names.has(id)) out[`owner:${id}`] = names.get(id)!;
  }
  const stages = [...(values.get('stage') ?? [])];
  if (stages.length) {
    const rows = (await db
      .prepare(
        `SELECT s.id, s.name, p.name AS pipeline FROM crm_stages s JOIN crm_pipelines p ON p.id = s.pipeline_id
         WHERE p.user_id = ? AND s.id IN ${inList(stages.length)}`,
      )
      .all(workspaceId, ...stages)) as Array<{ id: string; name: string; pipeline: string }>;
    // Etapas con el mismo nombre en distintos pipelines llevan el pipeline adelante.
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.name, (counts.get(r.name) ?? 0) + 1);
    for (const r of rows) out[`stage:${r.id}`] = (counts.get(r.name) ?? 0) > 1 ? `${r.pipeline} · ${r.name}` : r.name;
  }
  const pipes = [...(values.get('pipeline') ?? [])];
  if (pipes.length) {
    const rows = (await db
      .prepare(`SELECT id, name FROM crm_pipelines WHERE user_id = ? AND id IN ${inList(pipes.length)}`)
      .all(workspaceId, ...pipes)) as Array<{ id: string; name: string }>;
    for (const r of rows) out[`pipeline:${r.id}`] = r.name;
  }
  return out;
}

/** Campos disponibles para el constructor: los nativos (se traducen en el cliente) y los propios. */
export interface BuilderCustomField {
  key: string;
  obj: ReportObject;
  label: string;
  type: ReportFieldType;
  enum?: ReportEnum;
  options?: string[];
}

export async function builderCustomFields(workspaceId: string, db: Db = getDb()): Promise<BuilderCustomField[]> {
  const rows = (await db
    .prepare("SELECT entity, name, label, type, options FROM crm_custom_fields WHERE user_id = ? AND entity IN ('contacts', 'companies', 'deals') ORDER BY position, label")
    .all(workspaceId)) as Array<{ entity: string; name: string; label: string; type: string; options: string }>;
  const objOf: Record<string, ReportObject> = { contacts: 'contact', companies: 'company', deals: 'deal' };
  return rows
    .filter((r) => CUSTOM_NAME.test(r.name))
    .map((r) => {
      let options: string[] = [];
      try {
        const parsed: unknown = JSON.parse(r.options);
        if (Array.isArray(parsed)) options = parsed.filter((o): o is string => typeof o === 'string');
      } catch {
        options = [];
      }
      const t = customType(r.type);
      return { key: `${objOf[r.entity]}.custom:${r.name}`, obj: objOf[r.entity], label: r.label, ...t, options: t.enum === 'options' ? options : undefined };
    });
}
