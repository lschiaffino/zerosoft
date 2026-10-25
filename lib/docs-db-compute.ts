/**
 * Propiedades calculadas de una base: fórmulas, relaciones espejo (la vuelta
 * de una relación de dos vías) y rollups. Puro: recibe las bases
 * relacionadas ya cargadas (`foreign`) y devuelve una copia de la base con
 * los valores calculados metidos en `row.values` (y `kind` en cada
 * propiedad calculada), así filtros, orden, agrupado y vistas leen todo con
 * cellValue como si fueran valores guardados.
 *
 * La copia es solo para mostrar: las ediciones se hacen siempre sobre la
 * base original (el servidor igual descarta los valores calculados al
 * guardar).
 */
import type { DbProperty, DbRollupFn, DbRow, DbValue, DocsDatabase } from './docs-types';
import { cellValue, dayKey, effectiveType, formatValue, isEmptyValue, optionById, rowTitle, titleProperty, type DbFormatContext } from './docs-database';
import { FDate, FormulaError, dateKeyOf, evaluateFormula, kindOf, parseFDate, toText, type FKind, type FValue } from './docs-formula';

/** Clave de una base: página + bloque. */
export const dbKey = (pageId: string, blockId: string) => `${pageId}:${blockId}`;

export interface DbComputeEnv {
  /** Página y bloque de esta base (para reconocer relaciones a sí misma). */
  pageId?: string | null;
  blockId?: string | null;
  /** Bases relacionadas cargadas, por dbKey. */
  foreign?: Record<string, DocsDatabase | null | undefined>;
  people?: Record<string, string>;
  locale?: string;
  now?: number;
}

/** Bases que hace falta cargar para mostrar esta (relaciones y rollups). */
export function relatedSources(db: DocsDatabase, self?: { pageId?: string | null; blockId?: string | null }): Array<{ page_id: string; block_id: string }> {
  const out = new Map<string, { page_id: string; block_id: string }>();
  for (const p of db.properties) {
    if (p.type !== 'relation' || !p.relation) continue;
    const { page_id, block_id } = p.relation;
    if (self?.pageId === page_id && self?.blockId === block_id) continue;
    out.set(dbKey(page_id, block_id), { page_id, block_id });
  }
  return [...out.values()];
}

/** La base a la que apunta una relación (ella misma si es una autorrelación). */
export function relationTarget(db: DocsDatabase, prop: DbProperty, env: DbComputeEnv): DocsDatabase | null {
  const r = prop.relation;
  if (!r) return null;
  if (env.pageId && env.blockId && r.page_id === env.pageId && r.block_id === env.blockId) return db;
  return env.foreign?.[dbKey(r.page_id, r.block_id)] ?? null;
}

/** Ids de fila de la otra base que tiene una relación espejo: las filas de allá que apuntan a esta. */
function mirrorIds(target: DocsDatabase, mirrorOf: string, rowId: string): string[] {
  const out: string[] = [];
  for (const r of target.rows) {
    const v = r.values[mirrorOf];
    if (Array.isArray(v) && v.includes(rowId)) out.push(r.id);
  }
  return out;
}

/** Valor de una celda tal como lo ve una fórmula. */
function formulaValue(prop: DbProperty, row: DbRow, ctx: DbFormatContext): FValue {
  const v = cellValue(prop, row);
  switch (prop.type) {
    case 'number':
    case 'unique_id':
      return typeof v === 'number' ? v : null;
    case 'checkbox':
      return v === true;
    case 'date':
    case 'created_time':
    case 'last_edited_time':
      return parseFDate(v);
    case 'select':
    case 'status':
      return optionById(prop, v)?.name ?? '';
    case 'multi_select':
      return (Array.isArray(v) ? v : []).map((id) => optionById(prop, id)?.name ?? '').filter(Boolean);
    case 'person':
    case 'created_by':
    case 'last_edited_by':
      return (Array.isArray(v) ? v : []).map((id) => ctx.people?.[id] ?? '').filter(Boolean);
    case 'relation':
      return (Array.isArray(v) ? v : []).map((id) => ctx.rowTitles?.[id] ?? '').filter(Boolean);
    case 'files':
      return Array.isArray(v) ? v : [];
    case 'button':
      return null;
    case 'formula':
    case 'rollup': {
      if (v === null || v === undefined) return null;
      if (prop.kind === 'date') return parseFDate(v);
      if (typeof v === 'number' || typeof v === 'boolean') return v;
      return String(v);
    }
    default:
      return typeof v === 'string' ? v : v === null ? '' : String(v);
  }
}

/** Valor guardable (en la copia) de un resultado de fórmula. */
function storeFormula(v: FValue): DbValue {
  if (v === null) return null;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
  if (v instanceof FDate) return v.dateOnly ? dateKeyOf(v) : new Date(v.t).toISOString();
  return toText(v);
}

// ---------- Rollups ----------

export const ROLLUP_ANY: DbRollupFn[] = ['show_original', 'show_unique', 'count_all', 'count_values', 'count_unique', 'count_empty', 'count_not_empty', 'percent_empty', 'percent_not_empty'];
export const ROLLUP_NUMBER: DbRollupFn[] = ['sum', 'average', 'median', 'min', 'max', 'range'];
export const ROLLUP_DATE: DbRollupFn[] = ['earliest', 'latest', 'date_range'];
export const ROLLUP_CHECKBOX: DbRollupFn[] = ['checked', 'unchecked', 'percent_checked'];

/** Cálculos que tienen sentido para una propiedad de la otra base. */
export function rollupFns(prop: DbProperty | undefined): DbRollupFn[] {
  if (!prop) return ROLLUP_ANY;
  const t = effectiveType(prop);
  if (t === 'number') return [...ROLLUP_ANY, ...ROLLUP_NUMBER];
  if (t === 'date' || t === 'created_time' || t === 'last_edited_time') return [...ROLLUP_ANY, ...ROLLUP_DATE];
  if (t === 'checkbox') return [...ROLLUP_ANY, ...ROLLUP_CHECKBOX];
  return ROLLUP_ANY;
}

/** Resultado de un rollup y su tipo. */
export function computeRollup(
  fn: DbRollupFn,
  prop: DbProperty,
  rows: DbRow[],
  ctx: DbFormatContext,
): { value: DbValue; kind: FKind } {
  const raw = rows.map((r) => cellValue(prop, r));
  const texts = rows.map((r) => (prop.type === 'title' ? rowTitle({ properties: [prop], rows: [], views: [] }, r) : formatValue(prop, r, ctx)));
  const empties = raw.filter((v) => (effectiveType(prop) === 'checkbox' ? false : isEmptyValue(v))).length;
  const nums = raw.filter((v): v is number => typeof v === 'number');
  const days = raw.map((v) => dayKey(v)).filter((d): d is string => Boolean(d)).sort();
  const n = rows.length;
  switch (fn) {
    case 'show_original':
      return { value: texts.filter(Boolean).join(', ') || null, kind: 'text' };
    case 'show_unique':
      return { value: [...new Set(texts.flatMap((t) => t.split(', ')).filter(Boolean))].join(', ') || null, kind: 'text' };
    case 'count_all':
      return { value: n, kind: 'number' };
    case 'count_values':
      return { value: raw.reduce<number>((s, v) => s + (Array.isArray(v) ? v.length : isEmptyValue(v) ? 0 : 1), 0), kind: 'number' };
    case 'count_unique':
      return { value: new Set(texts.flatMap((t) => t.split(', ')).filter(Boolean)).size, kind: 'number' };
    case 'count_empty':
      return { value: empties, kind: 'number' };
    case 'count_not_empty':
      return { value: n - empties, kind: 'number' };
    case 'percent_empty':
      return { value: n ? empties / n : 0, kind: 'number' };
    case 'percent_not_empty':
      return { value: n ? (n - empties) / n : 0, kind: 'number' };
    case 'sum':
      return { value: nums.reduce((s, x) => s + x, 0), kind: 'number' };
    case 'average':
      return { value: nums.length ? nums.reduce((s, x) => s + x, 0) / nums.length : null, kind: 'number' };
    case 'median': {
      if (!nums.length) return { value: null, kind: 'number' };
      const sorted = [...nums].sort((a, b) => a - b);
      const m = Math.floor(sorted.length / 2);
      return { value: sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2, kind: 'number' };
    }
    case 'min':
      return { value: nums.length ? Math.min(...nums) : null, kind: 'number' };
    case 'max':
      return { value: nums.length ? Math.max(...nums) : null, kind: 'number' };
    case 'range':
      return { value: nums.length ? Math.max(...nums) - Math.min(...nums) : null, kind: 'number' };
    case 'checked':
      return { value: raw.filter((v) => v === true).length, kind: 'number' };
    case 'unchecked':
      return { value: raw.filter((v) => v !== true).length, kind: 'number' };
    case 'percent_checked':
      return { value: n ? raw.filter((v) => v === true).length / n : 0, kind: 'number' };
    case 'earliest':
      return { value: days[0] ?? null, kind: 'date' };
    case 'latest':
      return { value: days[days.length - 1] ?? null, kind: 'date' };
    case 'date_range': {
      if (days.length < 2) return { value: days.length ? 0 : null, kind: 'number' };
      const a = parseFDate(days[0])!;
      const b = parseFDate(days[days.length - 1])!;
      return { value: Math.round((b.t - a.t) / 86_400_000), kind: 'number' };
    }
    default:
      return { value: null, kind: 'text' };
  }
}

// ---------- Base calculada ----------

const cache = new WeakMap<DocsDatabase, { key: string; out: DocsDatabase }>();

function needsCompute(db: DocsDatabase): boolean {
  return db.properties.some((p) => p.type === 'formula' || p.type === 'rollup' || (p.type === 'relation' && p.relation?.mirror_of));
}

/** Títulos de fila (de esta base y de las relacionadas) para mostrar relaciones. */
export function rowTitlesFor(db: DocsDatabase, env: DbComputeEnv): Record<string, string> {
  const out: Record<string, string> = {};
  const add = (d: DocsDatabase | null | undefined) => {
    if (!d) return;
    const tp = titleProperty(d);
    for (const r of d.rows) {
      const v = r.values[tp?.id ?? ''];
      out[r.id] = typeof v === 'string' ? v : '';
    }
  };
  add(db);
  for (const d of Object.values(env.foreign ?? {})) add(d);
  return out;
}

/**
 * Base con fórmulas, espejos y rollups resueltos. Las bases relacionadas se
 * calculan un nivel (sus fórmulas sí, sus rollups hacia una tercera base no).
 */
export function computeDatabase(db: DocsDatabase, env: DbComputeEnv = {}, depth = 0): DocsDatabase {
  if (!needsCompute(db)) return db;
  const foreignKey = Object.entries(env.foreign ?? {})
    .map(([k, v]) => `${k}=${v ? v.rows.length : 'x'}`)
    .join('|');
  const key = `${env.pageId}:${env.blockId}:${foreignKey}:${depth}:${env.now ? Math.floor(env.now / 60_000) : ''}`;
  const hit = cache.get(db);
  if (hit && hit.key === key && !env.foreign) return hit.out;

  const now = env.now ?? Date.now();
  const rowTitles = rowTitlesFor(db, env);
  const ctx: DbFormatContext = { people: env.people, locale: env.locale, rowTitles };
  const properties = db.properties.map((p) => ({ ...p }));
  const byName = new Map<string, DbProperty>();
  for (const p of properties) if (!byName.has(p.name)) byName.set(p.name, p);
  const names = [...byName.keys()];

  // Bases relacionadas calculadas (sus fórmulas, para rollups sobre fórmulas).
  const targets = new Map<string, DocsDatabase | null>();
  const targetOf = (p: DbProperty): DocsDatabase | null => {
    if (!targets.has(p.id)) {
      const t = relationTarget(db, p, env);
      targets.set(p.id, t && t !== db && depth === 0 ? computeDatabase(t, { people: env.people, locale: env.locale, now }, depth + 1) : t);
    }
    return targets.get(p.id) ?? null;
  };

  const rows: DbRow[] = db.rows.map((r) => ({ ...r, values: { ...r.values } }));

  // 1) Espejos de relaciones de dos vías.
  for (const p of properties) {
    if (p.type !== 'relation' || !p.relation?.mirror_of) continue;
    const target = targetOf(p);
    for (const r of rows) {
      const ids = target ? mirrorIds(target, p.relation.mirror_of, r.id) : [];
      if (ids.length) r.values[p.id] = ids;
      else delete r.values[p.id];
    }
  }

  // 2) Rollups (antes que las fórmulas: una fórmula puede usar un rollup).
  for (const p of properties) {
    if (p.type !== 'rollup') continue;
    const cfg = p.rollup;
    const rel = cfg ? properties.find((x) => x.id === cfg.relation && x.type === 'relation') : undefined;
    const target = rel ? targetOf(rel) : null;
    const tprop = target?.properties.find((x) => x.id === cfg?.property);
    if (!cfg || !rel || !target || !tprop) {
      p.kind = 'text';
      for (const r of rows) delete r.values[p.id];
      continue;
    }
    const tctx: DbFormatContext = { people: env.people, locale: env.locale, rowTitles };
    const byId = new Map(target.rows.map((x) => [x.id, x]));
    let kind: FKind = 'text';
    for (const r of rows) {
      const ids = r.values[rel.id];
      const related = (Array.isArray(ids) ? ids : []).map((id) => byId.get(id)).filter((x): x is DbRow => Boolean(x));
      const res = computeRollup(cfg.fn, tprop, related, tctx);
      kind = res.kind;
      if (res.value === null || res.value === '') delete r.values[p.id];
      else r.values[p.id] = res.value;
    }
    p.kind = kind;
  }

  // 3) Fórmulas (en orden de dependencias; un ciclo da error).
  const formulas = properties.filter((p) => p.type === 'formula');
  if (formulas.length) {
    const kinds = new Map<string, FKind | null>();
    for (const r of rows) {
      const memo = new Map<string, FValue>();
      const stack = new Set<string>();
      const evalProp = (fp: DbProperty): FValue => {
        if (memo.has(fp.id)) return memo.get(fp.id)!;
        if (stack.has(fp.id)) throw new FormulaError('cycle');
        stack.add(fp.id);
        const res = evaluateFormula(
          fp.formula ?? '',
          names,
          (name) => {
            const target = byName.get(name);
            if (!target) throw new FormulaError(`unknown_property:${name}`);
            if (target.type === 'formula') {
              const v = evalProp(target);
              // Una fórmula que usa otra con error también da error.
              if (target.error) throw new FormulaError(target.error);
              return v;
            }
            return formulaValue(target, r, ctx);
          },
          now,
        );
        stack.delete(fp.id);
        if (res.error) {
          memo.set(fp.id, null);
          if (!fp.error) fp.error = res.error;
          return null;
        }
        memo.set(fp.id, res.value);
        return res.value;
      };
      for (const fp of formulas) {
        let value: FValue = null;
        try {
          value = evalProp(fp);
        } catch (e) {
          const msg = (e as Error).message;
          if (!fp.error) fp.error = msg.startsWith('unknown_property') || msg === 'cycle' ? msg : 'error';
        }
        const k = kindOf(value);
        if (k && !kinds.get(fp.id)) kinds.set(fp.id, k);
        const stored = storeFormula(value);
        if (stored === null || stored === '') delete r.values[fp.id];
        else r.values[fp.id] = stored;
      }
    }
    for (const fp of formulas) fp.kind = kinds.get(fp.id) ?? 'text';
  }

  const out: DocsDatabase = { ...db, properties, rows };
  if (!env.foreign) cache.set(db, { key, out });
  return out;
}

/** Valor de una fórmula sobre una fila de muestra (vista previa del editor). */
export function previewFormula(db: DocsDatabase, formula: string, env: DbComputeEnv = {}): { value: string; error?: string } {
  const probe: DbProperty = { id: '__preview__', name: '\u0000preview', type: 'formula', formula };
  const withProbe: DocsDatabase = { ...db, properties: [...db.properties, probe] };
  const out = computeDatabase(withProbe, env);
  const p = out.properties.find((x) => x.id === probe.id)!;
  const row = out.rows[0];
  if (p.error) return { value: '', error: p.error };
  if (!row) return { value: '' };
  return { value: formatValue(p, row, { people: env.people, locale: env.locale }) };
}
