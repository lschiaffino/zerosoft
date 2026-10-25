/**
 * Importar y exportar bases en CSV, como Notion: el import lee el archivo
 * (coma, punto y coma o tab; comillas RFC 4180), propone un tipo por columna
 * (número, fecha, checkbox, select, multi-select, URL, email, teléfono o
 * texto) y crea las opciones de los select. Se puede sumar a una base que ya
 * existe (cada columna a una propiedad, por nombre) o crear una nueva. El
 * export saca la vista tal como se ve (filtros y orden) o todas las filas.
 */
import type { DbOption, DbProperty, DbPropertyType, DbRow, DbValue, DbViewConfig, DocsDatabase } from './docs-types';
import {
  DB_MAX_OPTIONS,
  DB_MAX_PROPERTIES,
  DB_MAX_ROWS,
  formatValue,
  formatUniqueId,
  guessStatusGroup,
  isComputedType,
  newDbId,
  nextUniqueId,
  parseCheckbox,
  parseDateText,
  parseNumber,
  sortRows,
  titleProperty,
  viewRows,
  visibleProperties,
  type DbFormatContext,
} from './docs-database';

export const CSV_MAX_BYTES = 5 * 1024 * 1024;

/** Separador más probable de la primera línea. */
function detectDelimiter(text: string): string {
  const line = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'));
  const counts = [',', ';', '\t'].map((d) => ({ d, n: line.split(d).length }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 1 ? counts[0].d : ',';
}

/** Filas de un CSV (la primera es el encabezado). Sin filas vacías al final. */
export function parseCsv(input: string, delimiter?: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const d = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === '') {
      quoted = true;
      continue;
    }
    if (c === d) {
      row.push(field);
      field = '';
      continue;
    }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  while (rows.length && rows[rows.length - 1].every((c) => c.trim() === '')) rows.pop();
  return rows;
}

function csvCell(v: string): string {
  // Fórmulas de planilla (=, +, -, @) se escapan: abrir el CSV en Excel no las ejecuta.
  const safe = /^[=+@\t\r]/.test(v) || /^-(?![\d.])/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

const URL_RE = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[\d\s().-]{7,}$/;
const BOOL_WORDS = new Set(['yes', 'no', 'true', 'false', 'si', 'sí', 'sim', 'não', 'nao', 'x', '', '✓', 'checked', 'unchecked']);

/** Tipo que sugiere una columna (mirando hasta 200 valores no vacíos). */
export function guessColumnType(values: string[], header = ''): DbPropertyType {
  const vals = values.map((v) => v.trim()).filter(Boolean).slice(0, 200);
  if (!vals.length) return 'text';
  const all = (fn: (v: string) => boolean) => vals.every(fn);
  if (all((v) => BOOL_WORDS.has(v.toLowerCase())) && new Set(vals.map((v) => v.toLowerCase())).size <= 2) return 'checkbox';
  // Números "puros" (no fechas ni teléfonos largos); los que traen $ o % también.
  if (all((v) => /^[-+]?[$€£]?\s?\d[\d.,]*\s?%?$/.test(v) && parseNumber(v) !== null) && !all((v) => PHONE_RE.test(v) && v.replace(/\D/g, '').length >= 9)) return 'number';
  if (all((v) => /^\d{4}-\d{1,2}-\d{1,2}/.test(v) || (/[a-z]{3}|\d{1,2}\/\d{1,2}\/\d{2,4}/i.test(v) && !Number.isNaN(Date.parse(v))))) return 'date';
  if (all((v) => EMAIL_RE.test(v))) return 'email';
  if (all((v) => URL_RE.test(v) && /\./.test(v))) return 'url';
  if (all((v) => PHONE_RE.test(v) && v.replace(/\D/g, '').length >= 7) || /phone|tel[eé]fono|telefone|celular/i.test(header)) return 'phone';
  const distinct = new Set(vals.map((v) => v.toLowerCase()));
  if (vals.some((v) => v.includes(',')) && all((v) => v.length < 200)) {
    const parts = new Set(vals.flatMap((v) => v.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)));
    if (parts.size <= Math.max(12, vals.length / 3) && parts.size <= DB_MAX_OPTIONS) return 'multi_select';
  }
  if (distinct.size < vals.length && distinct.size <= Math.max(10, Math.ceil(vals.length / 4)) && distinct.size <= DB_MAX_OPTIONS && vals.length >= 3 && all((v) => v.length <= 60)) return 'select';
  return 'text';
}

/** Tipos a los que se puede mapear una columna al importar. */
export const CSV_IMPORT_TYPES: DbPropertyType[] = ['text', 'number', 'select', 'multi_select', 'status', 'date', 'checkbox', 'url', 'email', 'phone', 'place'];

export type CsvTarget = { kind: 'skip' } | { kind: 'title' } | { kind: 'existing'; propId: string } | { kind: 'new'; type: DbPropertyType; name: string };

export interface CsvColumnPlan {
  index: number;
  header: string;
  target: CsvTarget;
}

/** Mapeo inicial: la primera columna (o la que se llama como el título) al título; las otras por nombre o nuevas. */
export function planCsvImport(table: string[][], db: DocsDatabase | null): CsvColumnPlan[] {
  const header = table[0] ?? [];
  const body = table.slice(1);
  const title = db ? titleProperty(db) : null;
  const usable = (db?.properties ?? []).filter((p) => p.type !== 'title' && !isComputedType(p.type) && p.type !== 'relation' && p.type !== 'files');
  let titleIdx = title ? header.findIndex((h) => h.trim().toLowerCase() === title.name.trim().toLowerCase()) : -1;
  if (titleIdx === -1) titleIdx = header.findIndex((h) => /^(name|title|nombre|t[ií]tulo|nome)$/i.test(h.trim()));
  if (titleIdx === -1) titleIdx = 0;
  return header.map((h, i) => {
    const name = h.trim() || `Column ${i + 1}`;
    if (i === titleIdx) return { index: i, header: name, target: { kind: 'title' } as CsvTarget };
    const existing = usable.find((p) => p.name.trim().toLowerCase() === name.toLowerCase());
    if (existing) return { index: i, header: name, target: { kind: 'existing', propId: existing.id } as CsvTarget };
    return { index: i, header: name, target: { kind: 'new', type: guessColumnType(body.map((r) => r[i] ?? ''), name), name } as CsvTarget };
  });
}

function optionMaker(prop: DbProperty) {
  const opts: DbOption[] = [...(prop.options ?? [])];
  const byName = new Map(opts.map((o) => [o.name.trim().toLowerCase(), o.id]));
  const get = (raw: string): string | null => {
    const name = raw.trim();
    if (!name) return null;
    const key = name.toLowerCase();
    const hit = byName.get(key);
    if (hit) return hit;
    if (opts.length >= DB_MAX_OPTIONS) return null;
    const o: DbOption = { id: newDbId(), name: name.slice(0, 200) };
    if (prop.type === 'status') o.group = guessStatusGroup(name);
    opts.push(o);
    byName.set(key, o.id);
    return o.id;
  };
  return { get, options: () => opts };
}

/** Valor de una celda del CSV para un tipo (null si queda vacía). */
function csvValue(type: DbPropertyType, raw: string, opt: ReturnType<typeof optionMaker> | null, people?: Map<string, string>): DbValue {
  const v = raw.trim();
  if (type === 'checkbox') return parseCheckbox(v);
  if (!v) return null;
  switch (type) {
    case 'number':
      return parseNumber(v);
    case 'date':
      return parseDateText(v);
    case 'select':
    case 'status':
      return opt?.get(v) ?? null;
    case 'multi_select':
      return [...new Set(v.split(',').map((s) => opt?.get(s)).filter((x): x is string => Boolean(x)))];
    case 'person':
      return [...new Set(v.split(',').map((s) => people?.get(s.trim().toLowerCase())).filter((x): x is string => Boolean(x)))];
    default:
      return v.slice(0, 20000);
  }
}

export interface CsvImportResult {
  db: DocsDatabase;
  added: number;
  /** Filas que no entraron por el tope de la base. */
  skipped: number;
}

/**
 * Suma las filas del CSV a una base con el mapeo elegido (crea las
 * propiedades nuevas y las opciones de los select que falten). Como el
 * "Merge with CSV" de Notion: agrega filas, no actualiza las que ya están.
 */
export function importCsvRows(
  db: DocsDatabase,
  table: string[][],
  plan: CsvColumnPlan[],
  opts: { now?: string; members?: Array<{ id: string; name: string | null; email: string }> } = {},
): CsvImportResult {
  const now = opts.now ?? new Date().toISOString();
  const people = new Map<string, string>();
  for (const m of opts.members ?? []) {
    people.set(m.email.toLowerCase(), m.id);
    if (m.name) people.set(m.name.trim().toLowerCase(), m.id);
  }
  let properties = [...db.properties];
  const title = titleProperty(db);
  const targets: Array<{ index: number; prop: DbProperty }> = [];
  for (const c of plan) {
    if (c.target.kind === 'skip') continue;
    if (c.target.kind === 'title') {
      targets.push({ index: c.index, prop: title });
      continue;
    }
    if (c.target.kind === 'existing') {
      const propId = c.target.propId;
      const p = properties.find((x) => x.id === propId);
      if (p) targets.push({ index: c.index, prop: p });
      continue;
    }
    if (properties.length >= DB_MAX_PROPERTIES) continue;
    const p: DbProperty = { id: newDbId(), name: c.target.name.slice(0, 200), type: c.target.type };
    if (p.type === 'select' || p.type === 'multi_select' || p.type === 'status') p.options = [];
    properties.push(p);
    targets.push({ index: c.index, prop: p });
  }
  const makers = new Map<string, ReturnType<typeof optionMaker>>();
  for (const t of targets) if (t.prop.type === 'select' || t.prop.type === 'multi_select' || t.prop.type === 'status') makers.set(t.prop.id, optionMaker(t.prop));
  const uniques = properties.filter((p) => p.type === 'unique_id');
  const counters = new Map(uniques.map((p) => [p.id, nextUniqueId(db, p)]));

  const body = table.slice(1);
  const room = Math.max(0, DB_MAX_ROWS - db.rows.length);
  const rows: DbRow[] = [];
  for (const line of body.slice(0, room)) {
    const values: Record<string, DbValue> = {};
    for (const t of targets) {
      const v = csvValue(t.prop.type === 'title' ? 'text' : t.prop.type, line[t.index] ?? '', makers.get(t.prop.id) ?? null, people);
      if (v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
      if (t.prop.type === 'checkbox' && v === false) continue;
      values[t.prop.id] = v;
    }
    for (const u of uniques) {
      const n = counters.get(u.id)!;
      values[u.id] = n;
      counters.set(u.id, n + 1);
    }
    rows.push({ id: newDbId(), values, created_at: now, updated_at: now });
  }
  properties = properties.map((p) => {
    const m = makers.get(p.id);
    if (m) return { ...p, options: m.options() };
    if (counters.has(p.id)) return { ...p, next_id: counters.get(p.id)! };
    return p;
  });
  return { db: { ...db, properties, rows: [...db.rows, ...rows] }, added: rows.length, skipped: Math.max(0, body.length - room) };
}

/** Base nueva desde un CSV (título del archivo, una vista tabla). */
export function databaseFromCsv(table: string[][], title: string, plan?: CsvColumnPlan[]): CsvImportResult {
  const titleProp: DbProperty = { id: newDbId(), name: 'Name', type: 'title' };
  const p = plan ?? planCsvImport(table, null);
  const titleCol = p.find((c) => c.target.kind === 'title');
  if (titleCol) titleProp.name = titleCol.header.slice(0, 200) || 'Name';
  const view: DbViewConfig = { id: newDbId(), name: '', type: 'table' };
  const empty: DocsDatabase = { properties: [titleProp], rows: [], views: [view], active_view: view.id, title: title.slice(0, 200) };
  return importCsvRows(empty, table, p);
}

/**
 * CSV de una base: la vista (sus filtros, orden y propiedades visibles) o
 * todas las filas con todas las propiedades. `db` ya viene calculada
 * (fórmulas y rollups resueltos).
 */
export function exportCsv(db: DocsDatabase, view: DbViewConfig | null, ctx: DbFormatContext = {}): string {
  const props = (view ? visibleProperties(db, view) : db.properties).filter((p) => p.type !== 'button');
  const rows = view ? viewRows(db, view, ctx) : sortRows(db, db.rows, [], ctx);
  const cell = (p: DbProperty, r: DbRow): string => {
    if (p.type === 'unique_id') return formatUniqueId(p, r.values[p.id]);
    const v = r.values[p.id];
    if (p.type === 'date') return typeof v === 'string' ? v : '';
    // Números sin separador de miles (lo que lee una planilla).
    if (typeof v === 'number' && (p.type === 'number' || p.type === 'formula' || p.type === 'rollup') && !p.rollup?.fn?.startsWith('percent')) return String(v);
    return formatValue(p, r, ctx);
  };
  return toCsv([props.map((p) => p.name), ...rows.map((r) => props.map((p) => cell(p, r)))]);
}
