/**
 * Track — filtros de issues como en Linear: reglas "propiedad + operador +
 * valores" unidas con AND (todas) u OR (alguna).
 *
 * Puro y sin dependencias de servidor: lo usan el constructor de filtros, la
 * URL, las vistas guardadas y el SQL de listIssues / listAllIssues.
 */

export const FILTER_FIELDS = [
  'status',
  'priority',
  'assignee',
  'creator',
  'label',
  'cycle',
  'milestone',
  'estimate',
  'due',
  'start',
  'created',
  'updated',
  'relation',
  'hierarchy',
] as const;
export type FilterField = (typeof FILTER_FIELDS)[number];

export const FILTER_OPERATORS = ['is', 'is_not', 'empty', 'not_empty', 'before', 'after', 'gte', 'lte'] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export interface FilterRule {
  field: FilterField;
  op: FilterOperator;
  values: string[];
}

export type FilterMatch = 'and' | 'or';

export interface IssueFilter {
  match: FilterMatch;
  rules: FilterRule[];
}

/** Estado completo del filtro de una vista: reglas + búsqueda libre. */
export interface FilterState extends IssueFilter {
  q: string;
}

export const EMPTY_FILTERS: FilterState = { match: 'and', rules: [], q: '' };

export type FieldKind = 'set' | 'date' | 'number' | 'relation' | 'hierarchy';

export function fieldKind(field: FilterField): FieldKind {
  switch (field) {
    case 'due':
    case 'start':
    case 'created':
    case 'updated':
      return 'date';
    case 'estimate':
      return 'number';
    case 'relation':
      return 'relation';
    case 'hierarchy':
      return 'hierarchy';
    default:
      return 'set';
  }
}

/** Operadores que ofrece el chip de cada tipo de propiedad. */
export function operatorsFor(field: FilterField): FilterOperator[] {
  switch (fieldKind(field)) {
    case 'date':
      return ['before', 'after', 'empty', 'not_empty'];
    case 'number':
      return ['is', 'is_not', 'gte', 'lte', 'empty', 'not_empty'];
    case 'relation':
    case 'hierarchy':
      return ['is', 'is_not'];
    default:
      // status y priority nunca están vacíos (priority siempre tiene valor).
      return field === 'priority' ? ['is', 'is_not'] : ['is', 'is_not', 'empty', 'not_empty'];
  }
}

export const RELATION_VALUES = ['blocked', 'blocking', 'related', 'duplicate'] as const;
export const HIERARCHY_VALUES = ['top', 'sub', 'parent'] as const;

/** Fechas relativas que se guardan tal cual (la vista sigue valiendo mañana). */
export const RELATIVE_DATES = ['today', '-1d', '-7d', '-14d', '-30d', '+1d', '+7d', '+14d', '+30d'] as const;

export function needsValues(op: FilterOperator): boolean {
  return op !== 'empty' && op !== 'not_empty';
}

const MAX_RULES = 20;
const MAX_VALUES = 50;

function isField(v: unknown): v is FilterField {
  return FILTER_FIELDS.includes(v as FilterField);
}

function cleanRule(raw: unknown): FilterRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isField(r.field)) return null;
  const allowed = operatorsFor(r.field);
  const op = allowed.includes(r.op as FilterOperator) ? (r.op as FilterOperator) : allowed[0];
  const values = Array.isArray(r.values)
    ? r.values.filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length <= 80).slice(0, MAX_VALUES)
    : [];
  if (needsValues(op) && values.length === 0) return null;
  return { field: r.field, op, values: needsValues(op) ? values : [] };
}

function arr(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string' && Boolean(x));
  if (typeof v === 'string' && v) return v.split(',').filter(Boolean);
  return [];
}

/**
 * Normaliza un filtro de cualquier origen (URL, vista guardada vieja o nueva,
 * API). Las vistas viejas guardaban { statusId: [...], priority: [...], … }:
 * cada lista se convierte en una regla "is".
 */
export function normalizeFilter(raw: unknown): FilterState {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_FILTERS };
  const r = raw as Record<string, unknown>;
  const rules: FilterRule[] = [];
  if (Array.isArray(r.rules)) {
    for (const x of r.rules) {
      const rule = cleanRule(x);
      if (rule) rules.push(rule);
    }
  }
  const legacy: Array<[string, FilterField]> = [
    ['statusId', 'status'],
    ['priority', 'priority'],
    ['assigneeId', 'assignee'],
    ['cycleId', 'cycle'],
    ['labelIds', 'label'],
  ];
  for (const [key, field] of legacy) {
    const values = arr(r[key]);
    if (values.length) rules.push({ field, op: 'is', values });
  }
  if (typeof r.dueAfter === 'string' && r.dueAfter) rules.push({ field: 'due', op: 'after', values: [r.dueAfter] });
  if (typeof r.dueBefore === 'string' && r.dueBefore) rules.push({ field: 'due', op: 'before', values: [r.dueBefore] });
  return {
    match: r.match === 'or' ? 'or' : 'and',
    rules: rules.slice(0, MAX_RULES),
    q: typeof r.q === 'string' ? r.q.slice(0, 200) : '',
  };
}

export function activeRuleCount(f: Pick<IssueFilter, 'rules'>): number {
  return f.rules.length;
}

/** Filtro → parámetro `filter` de la URL / API (vacío si no hay reglas). */
export function encodeFilter(f: IssueFilter): string {
  if (f.rules.length === 0) return '';
  return JSON.stringify({ match: f.match, rules: f.rules });
}

export function decodeFilter(raw: string | null | undefined): IssueFilter {
  if (!raw) return { match: 'and', rules: [] };
  try {
    const n = normalizeFilter(JSON.parse(raw));
    return { match: n.match, rules: n.rules };
  } catch {
    return { match: 'and', rules: [] };
  }
}

// ---------- Fechas ----------

function pad(n: number) {
  return String(n).padStart(2, '0');
}

/** `today`, `-7d`, `+14d` o `YYYY-MM-DD` → día ISO; null si no se entiende. */
export function resolveFilterDate(value: string, today: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const m = /^(today|([+-])(\d{1,3})d)$/.exec(value);
  if (!m) return null;
  if (m[1] === 'today') return today;
  const days = Number(m[3]) * (m[2] === '-' ? -1 : 1);
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// ---------- SQL ----------

export interface SqlClause {
  sql: string;
  args: Array<string | number>;
}

function placeholders(n: number) {
  return `(${Array.from({ length: n }, () => '?').join(', ')})`;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const DATE_COLUMNS: Record<string, string> = {
  due: 'i.due_date',
  start: 'i.start_date',
  created: 'substr(i.created_at, 1, 10)',
  updated: 'substr(i.updated_at, 1, 10)',
};

const SET_COLUMNS: Record<string, string> = {
  status: 'i.status_id',
  priority: 'i.priority',
  assignee: 'i.assignee_id',
  creator: 'i.creator_id',
  cycle: 'i.cycle_id',
  milestone: 'i.milestone_id',
};

/** Valor especial "sin valor" dentro de un `is` (Linear: "No assignee"). */
export const NONE_VALUE = '__none__';

function ruleSql(rule: FilterRule, today: string): SqlClause | null {
  const kind = fieldKind(rule.field);
  if (kind === 'date') {
    const col = DATE_COLUMNS[rule.field];
    if (rule.op === 'empty') return { sql: `${col} IS NULL`, args: [] };
    if (rule.op === 'not_empty') return { sql: `${col} IS NOT NULL`, args: [] };
    const day = resolveFilterDate(rule.values[0] ?? '', today);
    if (!day) return null;
    return { sql: rule.op === 'before' ? `${col} < ?` : `${col} > ?`, args: [day] };
  }
  if (kind === 'number') {
    if (rule.op === 'empty') return { sql: 'i.estimate IS NULL', args: [] };
    if (rule.op === 'not_empty') return { sql: 'i.estimate IS NOT NULL', args: [] };
    const nums = rule.values.map(Number).filter((n) => Number.isFinite(n));
    if (nums.length === 0) return null;
    if (rule.op === 'gte') return { sql: 'i.estimate >= ?', args: [nums[0]] };
    if (rule.op === 'lte') return { sql: 'i.estimate <= ?', args: [nums[0]] };
    const sql = `i.estimate IN ${placeholders(nums.length)}`;
    return rule.op === 'is_not'
      ? { sql: `(i.estimate IS NULL OR NOT ${sql})`, args: nums }
      : { sql, args: nums };
  }
  if (kind === 'relation') {
    const parts: string[] = [];
    for (const v of rule.values) {
      if (v === 'blocked')
        parts.push("EXISTS (SELECT 1 FROM track_issue_relations r WHERE r.related_issue_id = i.id AND r.type = 'blocks')");
      else if (v === 'blocking')
        parts.push("EXISTS (SELECT 1 FROM track_issue_relations r WHERE r.issue_id = i.id AND r.type = 'blocks')");
      else if (v === 'related')
        parts.push(
          "EXISTS (SELECT 1 FROM track_issue_relations r WHERE (r.issue_id = i.id OR r.related_issue_id = i.id) AND r.type = 'related')",
        );
      else if (v === 'duplicate')
        parts.push(
          "EXISTS (SELECT 1 FROM track_issue_relations r WHERE (r.issue_id = i.id OR r.related_issue_id = i.id) AND r.type = 'duplicates')",
        );
    }
    if (parts.length === 0) return null;
    const any = `(${parts.join(' OR ')})`;
    return { sql: rule.op === 'is_not' ? `NOT ${any}` : any, args: [] };
  }
  if (kind === 'hierarchy') {
    const parts: string[] = [];
    for (const v of rule.values) {
      if (v === 'top') parts.push('i.parent_id IS NULL');
      else if (v === 'sub') parts.push('i.parent_id IS NOT NULL');
      else if (v === 'parent') parts.push('EXISTS (SELECT 1 FROM track_issues ch WHERE ch.parent_id = i.id)');
    }
    if (parts.length === 0) return null;
    const any = `(${parts.join(' OR ')})`;
    return { sql: rule.op === 'is_not' ? `NOT ${any}` : any, args: [] };
  }
  // Conjuntos.
  if (rule.field === 'label') {
    const empty = "(i.labels IS NULL OR i.labels = '[]' OR i.labels = '')";
    if (rule.op === 'empty') return { sql: empty, args: [] };
    if (rule.op === 'not_empty') return { sql: `NOT ${empty}`, args: [] };
    const likes = rule.values.map(() => "i.labels LIKE ? ESCAPE '\\'");
    const args = rule.values.map((id) => `%${escapeLike(`"id":"${id}"`)}%`);
    const any = `(${likes.join(' OR ')})`;
    return { sql: rule.op === 'is_not' ? `NOT ${any}` : any, args };
  }
  const col = SET_COLUMNS[rule.field];
  if (!col) return null;
  if (rule.op === 'empty') return { sql: `${col} IS NULL`, args: [] };
  if (rule.op === 'not_empty') return { sql: `${col} IS NOT NULL`, args: [] };
  const wantsNone = rule.values.includes(NONE_VALUE);
  const values = rule.values.filter((v) => v !== NONE_VALUE);
  const parts: string[] = [];
  const args: string[] = [];
  if (values.length) {
    parts.push(`${col} IN ${placeholders(values.length)}`);
    args.push(...values);
  }
  if (wantsNone) parts.push(`${col} IS NULL`);
  if (parts.length === 0) return null;
  const any = `(${parts.join(' OR ')})`;
  // "is not X": los que no tienen valor también cuentan (Linear hace lo mismo).
  if (rule.op === 'is_not') return { sql: wantsNone ? `NOT ${any}` : `(${col} IS NULL OR NOT ${any})`, args };
  return { sql: any, args };
}

/** WHERE de un filtro (null si no tiene reglas válidas). */
export function filterToSql(filter: IssueFilter | undefined, today: string): SqlClause | null {
  if (!filter || filter.rules.length === 0) return null;
  const parts: SqlClause[] = [];
  for (const rule of filter.rules) {
    const c = ruleSql(rule, today);
    if (c) parts.push(c);
  }
  if (parts.length === 0) return null;
  const joiner = filter.match === 'or' ? ' OR ' : ' AND ';
  return { sql: `(${parts.map((p) => p.sql).join(joiner)})`, args: parts.flatMap((p) => p.args) };
}
