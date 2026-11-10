/**
 * Modelo de Analytics (tipo Metabase). Puro: lo usan servidor, cliente y tests.
 */
import { z } from 'zod';

export type ColumnType = 'text' | 'number' | 'date' | 'bool';
export type Dialect = 'sqlite' | 'postgres' | 'mysql';
export type Engine = 'postgres' | 'mysql';
export const ENGINES: readonly Engine[] = ['postgres', 'mysql'];

export interface SchemaColumn {
  name: string;
  type: ColumnType;
}
export interface SchemaTable {
  name: string;
  /** App de zerosoft de la que sale (tablas propias). */
  app?: string;
  columns: SchemaColumn[];
}

export const FILTER_OPS = ['=', '!=', '>', '>=', '<', '<=', 'contains', 'not_contains', 'starts', 'empty', 'not_empty', 'last_days'] as const;
export type FilterOp = (typeof FILTER_OPS)[number];
export const AGG_FNS = ['count', 'distinct', 'sum', 'avg', 'min', 'max'] as const;
export type AggFn = (typeof AGG_FNS)[number];
export const BUCKETS = ['day', 'week', 'month', 'year'] as const;
export type Bucket = (typeof BUCKETS)[number];
export const VIZ_TYPES = ['auto', 'table', 'number', 'line', 'bar', 'area', 'pie', 'funnel'] as const;
export type VizType = (typeof VIZ_TYPES)[number];

const ident = z.string().trim().min(1).max(200);
/** Columna: "col" de la tabla base o "tabla.col" de una unida. */
const colRef = z.string().trim().min(1).max(260);

export const builderSchema = z.object({
  kind: z.literal('builder'),
  table: ident,
  joins: z
    .array(z.object({ table: ident, left: colRef, right: colRef, type: z.enum(['left', 'inner']).default('left') }))
    .max(2)
    .default([]),
  filters: z
    .array(
      z.object({
        column: colRef,
        op: z.enum(FILTER_OPS),
        value: z.union([z.string().max(500), z.number()]).optional(),
      }),
    )
    .max(20)
    .default([]),
  aggregations: z.array(z.object({ fn: z.enum(AGG_FNS), column: colRef.optional() })).max(6).default([]),
  breakouts: z.array(z.object({ column: colRef, bucket: z.enum(BUCKETS).optional() })).max(3).default([]),
  sort: z.array(z.object({ column: z.string().max(260), dir: z.enum(['asc', 'desc']) })).max(4).default([]),
  limit: z.number().int().min(1).max(10_000).optional(),
});
export type BuilderQuery = z.infer<typeof builderSchema>;

export const paramSchema = z.object({
  name: z.string().regex(/^[a-z_][a-z0-9_]{0,39}$/i),
  label: z.string().max(80).optional(),
  type: z.enum(['text', 'number', 'date']).default('text'),
  default: z.string().max(200).optional(),
});
export type QueryParam = z.infer<typeof paramSchema>;

export const sqlQuerySchema = z.object({
  kind: z.literal('sql'),
  sql: z.string().min(1).max(20_000),
  params: z.array(paramSchema).max(12).default([]),
});
export type SqlQuery = z.infer<typeof sqlQuerySchema>;

export const querySchema = z.discriminatedUnion('kind', [builderSchema, sqlQuerySchema]);
export type BiQuery = z.infer<typeof querySchema>;

export const vizSchema = z.object({
  type: z.enum(VIZ_TYPES).default('auto'),
  x: z.string().max(260).optional(),
  y: z.array(z.string().max(260)).max(6).optional(),
});
export type Viz = z.infer<typeof vizSchema>;

export interface BiResult {
  columns: SchemaColumn[];
  rows: unknown[][];
  /** Hay más filas que las devueltas (tope de filas). */
  truncated: boolean;
  /** SQL que corrió (siempre se muestra). */
  sql: string;
  cached: boolean;
  ms: number;
}

/** Fuente de una pregunta: 'zerosoft' (datos propios) o el id de una base externa. */
export const ZS_SOURCE = 'zerosoft';

export const DASH_FILTER_TYPES = ['text', 'number', 'date'] as const;
export const dashFilterSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]{1,30}$/),
  name: z.string().trim().min(1).max(60),
  type: z.enum(DASH_FILTER_TYPES).default('text'),
  default: z.string().max(200).optional(),
});
export type DashFilter = z.infer<typeof dashFilterSchema>;

/** Cómo una tarjeta usa cada filtro del tablero: parámetro de su SQL o columna del constructor. */
export const cardMappingSchema = z.record(z.string(), z.object({ param: z.string().max(40).optional(), column: z.string().max(260).optional() }));
export type CardMapping = z.infer<typeof cardMappingSchema>;
