/**
 * Flow — respuestas de error de las rutas de tablas de datos
 * (app/api/flow/tables/**). Códigos en flow.tables.errors.*.
 */
import type { NextResponse } from 'next/server';
import type { ZodError } from 'zod';
import { flowError } from './flow-http';
import { TableError } from './flow-tables';

const STATUS: Record<string, number> = {
  not_found: 404,
  duplicate_name: 409,
  too_many_tables: 409,
  table_full: 409,
  row_too_large: 413,
  invalid_value: 400,
  unknown_column: 400,
};

export function tableErrorResponse(err: unknown): NextResponse | null {
  if (!(err instanceof TableError)) return null;
  return flowError(STATUS[err.code] ?? 400, err.code, err.column ? { column: err.column } : {});
}

/** Error de validación del body: nombre, columnas repetidas o reservadas. */
export function tableInputError(error: ZodError): NextResponse {
  const issue = error.issues[0];
  if (issue?.message === 'duplicate_column' || issue?.message === 'reserved_column') return flowError(400, issue.message);
  const field = String(issue?.path[0] ?? '');
  if (field === 'name') return flowError(400, 'invalid_name');
  if (field === 'columns') return flowError(400, 'invalid_column');
  return flowError(400, 'invalid_input');
}
