/**
 * Panel de filtros (components/ui/FilterPanel.tsx): el modelo, sin React ni
 * nada de una app. Una app describe sus campos (FilterField) agrupados en
 * categorías y guarda los valores en un objeto { idDelCampo: valor }.
 *
 * Tipos de campo:
 * - multi: varias opciones a la vez (personas, etiquetas, líneas). Valor: ids.
 * - date: un período relativo (hoy, últimos 7 días…) o un rango de fechas.
 * - bool: sí o no (sin valor = cualquiera).
 * - text: un valor exacto, "tiene valor" o "sin valor".
 * - custom: lo dibuja la app; el panel solo necesita saber cuánto hay puesto.
 *
 * Dentro de un campo las opciones se suman (O); entre campos se cruzan (Y).
 */

export type Tri = 'yes' | 'no';

export const DATE_PRESETS = ['today', 'yesterday', 'last7', 'last30', 'thisWeek', 'thisMonth', 'lastMonth'] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];

/** Un período relativo (se resuelve al consultar) o un rango de días 'YYYY-MM-DD', con los dos extremos incluidos. */
export type DateValue = { preset: DatePreset } | { from?: string; to?: string };

export type TextValue = { mode: 'is'; value: string } | { mode: 'set' } | { mode: 'unset' };

export type FilterValue = string[] | Tri | DateValue | TextValue | unknown;
export type FilterValues = Record<string, FilterValue | undefined>;

export interface FilterOption {
  id: string;
  label: string;
  /** Texto secundario (el email de una persona, el teléfono de una línea). */
  hint?: string;
  /** Color de la opción (una etiqueta): el nombre de un color del sistema. */
  color?: string;
  /** Muestra un avatar con las iniciales (personas): las del nombre de la opción, o las de este texto. */
  avatar?: boolean | string;
  /** Opción especial ("Sin asignar", "Sin etiqueta"): va primero y en cursiva. */
  special?: boolean;
}

export interface FilterCategory {
  id: string;
  label: string;
}

interface FieldBase {
  id: string;
  label: string;
  category: string;
  /** Palabras extra por las que la búsqueda de filtros encuentra el campo. */
  keywords?: string;
  /** Texto de ayuda arriba del editor. */
  help?: string;
}

export type FilterField =
  | (FieldBase & { type: 'multi'; options: FilterOption[] })
  | (FieldBase & { type: 'date' })
  | (FieldBase & { type: 'bool'; yes?: string; no?: string })
  | (FieldBase & { type: 'text' })
  | (FieldBase & { type: 'custom'; count: (value: unknown) => number; summary: (value: unknown) => string });

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM-DD' que existe en el calendario. */
export function validDay(v: unknown): v is string {
  if (typeof v !== 'string' || !DAY.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Un valor de fecha bien formado, o undefined. Un rango al revés se da vuelta. */
export function cleanDateValue(raw: unknown): DateValue | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if ((DATE_PRESETS as readonly string[]).includes(String(r.preset))) return { preset: r.preset as DatePreset };
  let from = validDay(r.from) ? r.from : undefined;
  let to = validDay(r.to) ? r.to : undefined;
  if (from && to && from > to) [from, to] = [to, from];
  if (!from && !to) return undefined;
  return { ...(from ? { from } : {}), ...(to ? { to } : {}) };
}

export function cleanTextValue(raw: unknown): TextValue | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (r.mode === 'set' || r.mode === 'unset') return { mode: r.mode };
  if (r.mode === 'is' && typeof r.value === 'string' && r.value.trim()) return { mode: 'is', value: r.value.trim().slice(0, 200) };
  return undefined;
}

/** Cuánto hay puesto en un campo: opciones elegidas, o 1 si tiene valor. */
export function fieldCount(field: FilterField, value: FilterValue | undefined): number {
  if (value === undefined || value === null) return 0;
  switch (field.type) {
    case 'multi':
      return Array.isArray(value) ? value.length : 0;
    case 'bool':
      return value === 'yes' || value === 'no' ? 1 : 0;
    case 'date':
      return cleanDateValue(value) ? 1 : 0;
    case 'text':
      return cleanTextValue(value) ? 1 : 0;
    case 'custom':
      return field.count(value);
  }
}

/** Campos con algo puesto. */
export function countActive(fields: FilterField[], values: FilterValues): number {
  return fields.reduce((n, f) => n + (fieldCount(f, values[f.id]) > 0 ? 1 : 0), 0);
}

/** Los valores sin lo vacío ni lo que no es de ningún campo. */
export function cleanValues(fields: FilterField[], values: FilterValues): FilterValues {
  const out: FilterValues = {};
  for (const f of fields) if (fieldCount(f, values[f.id]) > 0) out[f.id] = values[f.id];
  return out;
}

/** Para buscar sin importar mayúsculas ni acentos. */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Campos cuyo nombre (o sus palabras clave, o su categoría) contiene lo buscado. */
export function matchFields(fields: FilterField[], categories: FilterCategory[], query: string): FilterField[] {
  const q = fold(query);
  if (!q) return fields;
  const cat = new Map(categories.map((c) => [c.id, fold(c.label)]));
  return fields.filter((f) => fold(f.label).includes(q) || fold(f.keywords ?? '').includes(q) || (cat.get(f.category) ?? '').includes(q));
}

/** De los campos que coinciden, el que mejor responde a lo buscado: el que empieza así, el que lo tiene en el nombre, o el primero. */
export function bestField(matches: FilterField[], query: string): FilterField | undefined {
  const q = fold(query);
  if (!q) return matches[0];
  return matches.find((f) => fold(f.label).startsWith(q)) ?? matches.find((f) => fold(f.label).includes(q)) ?? matches[0];
}

export function matchOptions(options: FilterOption[], query: string): FilterOption[] {
  const q = fold(query);
  if (!q) return options;
  return options.filter((o) => fold(o.label).includes(q) || fold(o.hint ?? '').includes(q));
}

const DAY_MS = 86_400_000;

/**
 * El rango [from, to) en ISO (UTC) de un valor de fecha. `tzOffsetMin` son los
 * minutos al este de UTC de quien mira (el día empieza a su medianoche); la
 * semana empieza el lunes. Un extremo que falta queda abierto.
 */
export function resolveDateRange(value: DateValue | undefined, now: Date, tzOffsetMin = 0): { from?: string; to?: string } {
  const v = cleanDateValue(value);
  if (!v) return {};
  const off = Math.max(-840, Math.min(840, Math.round(tzOffsetMin) || 0)) * 60_000;
  // "Reloj local" como si fuera UTC: se opera en días enteros y se vuelve a UTC al final.
  const iso = (localMs: number) => new Date(localMs - off).toISOString();
  if (!('preset' in v)) {
    const from = v.from ? Date.parse(`${v.from}T00:00:00Z`) : undefined;
    const to = v.to ? Date.parse(`${v.to}T00:00:00Z`) + DAY_MS : undefined;
    return { ...(from !== undefined ? { from: iso(from) } : {}), ...(to !== undefined ? { to: iso(to) } : {}) };
  }
  const local = new Date(now.getTime() + off);
  const today = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const monthStart = (delta: number) => Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + delta, 1);
  switch (v.preset) {
    case 'today':
      return { from: iso(today), to: iso(today + DAY_MS) };
    case 'yesterday':
      return { from: iso(today - DAY_MS), to: iso(today) };
    case 'last7':
      return { from: iso(today - 6 * DAY_MS), to: iso(today + DAY_MS) };
    case 'last30':
      return { from: iso(today - 29 * DAY_MS), to: iso(today + DAY_MS) };
    case 'thisWeek': {
      const sinceMonday = (local.getUTCDay() + 6) % 7;
      return { from: iso(today - sinceMonday * DAY_MS), to: iso(today + DAY_MS) };
    }
    case 'thisMonth':
      return { from: iso(monthStart(0)), to: iso(today + DAY_MS) };
    case 'lastMonth':
      return { from: iso(monthStart(-1)), to: iso(monthStart(0)) };
  }
}

export interface FilterChip {
  /** El id del campo: sacar el chip borra ese campo. */
  id: string;
  label: string;
  text: string;
}

export interface ChipStrings {
  yes: string;
  no: string;
  presets: Record<DatePreset, string>;
  from: (day: string) => string;
  until: (day: string) => string;
  range: (from: string, to: string) => string;
  /** "+2" después de los primeros nombres. */
  more: (n: number) => string;
  /** Opciones elegidas que ya no existen o que esta persona no ve. */
  unavailable: (n: number) => string;
  hasValue: string;
  noValue: string;
  /** Un día 'YYYY-MM-DD' como se lee en este idioma. */
  day: (day: string) => string;
}

/** Cuántos nombres entran en un chip antes de "+N". */
const CHIP_NAMES = 2;

/** Lo que dice el chip de un campo con valor ('' si no hay nada puesto). */
export function chipText(field: FilterField, value: FilterValue | undefined, s: ChipStrings): string {
  if (fieldCount(field, value) === 0) return '';
  switch (field.type) {
    case 'multi': {
      const ids = value as string[];
      const byId = new Map(field.options.map((o) => [o.id, o.label]));
      const names = ids.filter((id) => byId.has(id)).map((id) => byId.get(id) as string);
      const missing = ids.length - names.length;
      const parts = names.slice(0, CHIP_NAMES);
      if (names.length > CHIP_NAMES) parts.push(s.more(names.length - CHIP_NAMES));
      if (missing > 0) parts.push(s.unavailable(missing));
      return parts.join(', ');
    }
    case 'bool':
      return value === 'yes' ? (field.yes ?? s.yes) : (field.no ?? s.no);
    case 'date': {
      const v = cleanDateValue(value) as DateValue;
      if ('preset' in v) return s.presets[v.preset];
      if (v.from && v.to) return v.from === v.to ? s.day(v.from) : s.range(s.day(v.from), s.day(v.to));
      return v.from ? s.from(s.day(v.from)) : s.until(s.day(v.to as string));
    }
    case 'text': {
      const v = cleanTextValue(value) as TextValue;
      return v.mode === 'is' ? v.value : v.mode === 'set' ? s.hasValue : s.noValue;
    }
    case 'custom':
      return field.summary(value);
  }
}

/** Un chip por campo con valor, en el orden de los campos. */
export function filterChips(fields: FilterField[], values: FilterValues, s: ChipStrings): FilterChip[] {
  const out: FilterChip[] = [];
  for (const f of fields) {
    const text = chipText(f, values[f.id], s);
    if (text) out.push({ id: f.id, label: f.label, text });
  }
  return out;
}
