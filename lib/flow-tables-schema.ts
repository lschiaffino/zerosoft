/**
 * Flow — tablas de datos del workspace: tipos, límites y validación. Sin
 * dependencias de servidor (las comparten la API, el motor y la pantalla).
 */
import { z } from 'zod';

export const TABLE_COLUMN_TYPES = ['text', 'number', 'boolean'] as const;
export type TableColumnType = (typeof TABLE_COLUMN_TYPES)[number];

export interface FlowTableColumn {
  name: string;
  type: TableColumnType;
}

/** Tablas por workspace. */
export const MAX_TABLES = 50;
/** Columnas por tabla. */
export const MAX_COLUMNS = 30;
/** Filas por tabla. */
export const MAX_TABLE_ROWS = 10_000;
/** Tamaño de una fila serializada (JSON). */
export const MAX_ROW_BYTES = 16_000;
/** Largo de un valor de texto. */
export const MAX_TEXT_VALUE = 10_000;

/** Nombre de columna: como una variable ({{nodes.x.output.row.email}}). */
export const COLUMN_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
/** Claves que agrega cada fila al leerla (no pueden ser columnas). */
export const RESERVED_COLUMNS = ['id', 'createdAt', 'updatedAt'] as const;

const columnSchema = z.object({
  name: z
    .string()
    .trim()
    .regex(COLUMN_NAME_RE)
    .refine((n) => !(RESERVED_COLUMNS as readonly string[]).includes(n), { message: 'reserved_column' }),
  type: z.enum(TABLE_COLUMN_TYPES),
});

const columnsSchema = z
  .array(columnSchema)
  .max(MAX_COLUMNS)
  .refine((cols) => new Set(cols.map((c) => c.name.toLowerCase())).size === cols.length, { message: 'duplicate_column' });

export const tableNameSchema = z.string().trim().min(1).max(60);

export const tableCreateSchema = z.object({
  name: tableNameSchema,
  columns: columnsSchema.default([]),
});

export const tableUpdateSchema = z.object({
  name: tableNameSchema.optional(),
  columns: columnsSchema.optional(),
});

export const tableRowSchema = z.object({
  data: z.record(z.unknown()),
});

export class TableValueError extends Error {
  constructor(public column: string) {
    super('invalid_value');
  }
}

/**
 * Valor de una celda según el tipo de su columna. Vacío o null = null.
 * Texto: se pasa a string (objetos como JSON). Número y booleano inválidos
 * tiran TableValueError (mejor fallar que guardar un 0 que nadie pidió).
 */
export function coerceCell(column: FlowTableColumn, raw: unknown): string | number | boolean | null {
  if (raw === undefined || raw === null) return null;
  if (column.type === 'number') {
    if (typeof raw === 'number') {
      if (!Number.isFinite(raw)) throw new TableValueError(column.name);
      return raw;
    }
    const s = String(raw).trim();
    if (!s) return null;
    const n = Number(s);
    if (!Number.isFinite(n)) throw new TableValueError(column.name);
    return n;
  }
  if (column.type === 'boolean') {
    if (typeof raw === 'boolean') return raw;
    const s = String(raw).trim().toLowerCase();
    if (!s) return null;
    if (['true', '1', 'yes', 'y', 'si', 'sí', 'sim', 'on'].includes(s)) return true;
    if (['false', '0', 'no', 'n', 'nao', 'não', 'off'].includes(s)) return false;
    throw new TableValueError(column.name);
  }
  const s = typeof raw === 'string' ? raw : typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
  return s.slice(0, MAX_TEXT_VALUE);
}

/**
 * Datos de una fila para guardar: solo columnas de la tabla, con su tipo.
 * `base` (actualización) conserva las columnas que no vienen en `data`.
 */
export function coerceRow(
  columns: readonly FlowTableColumn[],
  data: Record<string, unknown>,
  base: Record<string, unknown> = {},
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const c of columns) {
    if (Object.prototype.hasOwnProperty.call(data, c.name)) out[c.name] = coerceCell(c, data[c.name]);
    else if (Object.prototype.hasOwnProperty.call(base, c.name)) out[c.name] = coerceCell(c, base[c.name]);
    else out[c.name] = null;
  }
  return out;
}
