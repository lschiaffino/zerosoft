/**
 * CRM — helpers compartidos por las rutas API (session app/api/crm y v1 app/api/v1/crm).
 * Errores session: { error: '<code>' } plano; los códigos se traducen con crm.errors.*.
 */
import { NextResponse } from 'next/server';
import type { ZodError } from 'zod';
import { getDb } from './db';
import { CrmRefError } from './crm-refs';
import { rateLimit } from './rate-limit';
import { canSeeEntity, type OwnerScope } from './crm-visibility';

export { CrmRefError };

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

export function notFound(): NextResponse {
  return NextResponse.json({ error: 'not_found' }, { status: 404 });
}

export function crmError(status: number, code: string): NextResponse {
  return NextResponse.json({ error: code }, { status });
}

/** Mapea issues de zod a códigos crm.errors.* (invalid_email, missing_name, invalid_input). */
export function zodErrorCode(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'invalid_input';
  if (issue.message === 'invalid_email') return 'invalid_email';
  const field = String(issue.path[0] ?? '');
  if (
    field === 'name' &&
    ((issue.code === 'invalid_type' && issue.received === 'undefined') ||
      issue.code === 'too_small')
  ) {
    return 'missing_name';
  }
  return 'invalid_input';
}

export function invalidBody(error: ZodError): NextResponse {
  return crmError(400, zodErrorCode(error));
}

/** page/pageSize de query string con el mismo clamp que lib/crm (1..100). */
export function pageParams(sp: URLSearchParams): { page: number; pageSize: number } {
  const pageSize = Math.min(Math.max(Number(sp.get('pageSize') ?? '25') || 25, 1), 100);
  const page = Math.max(Number(sp.get('page') ?? '1') || 1, 1);
  return { page, pageSize };
}

/** sort solo si está dentro de los valores permitidos; si no, undefined (default de la lib). */
export function sortParam<T extends string>(
  sp: URLSearchParams,
  allowed: readonly T[],
): T | undefined {
  const v = sp.get('sort');
  return allowed.includes(v as T) ? (v as T) : undefined;
}

/** Primer pipeline del usuario (position ASC) — default para listados de deals. */
export async function defaultPipelineId(userId: string): Promise<string | null> {
  const row = (await getDb()
    .prepare(
      'SELECT id FROM crm_pipelines WHERE user_id = ? ORDER BY position ASC, created_at ASC LIMIT 1',
    )
    .get(userId)) as { id: string } | undefined;
  return row?.id ?? null;
}

/** Quita user_id de una fila (API pública v1). */
export function cleanRow<T extends { user_id: string }>(row: T): Omit<T, 'user_id'> {
  const { user_id: _userId, ...rest } = row;
  return rest;
}

/**
 * Resuelve la promesa; si falló por una referencia inválida (CrmRefError) la
 * devuelve como valor para que la ruta responda 400 en vez de 500.
 */
export async function catchRef<T>(p: Promise<T>): Promise<T | CrmRefError> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof CrmRefError) return e;
    throw e;
  }
}

/**
 * Visibilidad por owner (lib/crm-visibility.ts): 404 si el registro no existe
 * o el viewer no lo ve (no se confirma que exista). null = puede seguir.
 */
export async function guardRecord(
  workspaceId: string,
  entity: 'contact' | 'company' | 'deal',
  id: string,
  scope: OwnerScope | undefined,
): Promise<NextResponse | null> {
  if (!scope) return null;
  return (await canSeeEntity(workspaceId, entity, id, scope)) ? null : notFound();
}

/** Igual que guardRecord para la API v1 (formato de error { error: { code, message } }). */
export async function apiGuardRecord(
  workspaceId: string,
  entity: 'contact' | 'company' | 'deal',
  id: string,
  scope: OwnerScope | undefined,
): Promise<NextResponse | null> {
  if (!scope) return null;
  if (await canSeeEntity(workspaceId, entity, id, scope)) return null;
  return NextResponse.json({ error: { code: 'not_found', message: 'Not found.' } }, { status: 404 });
}

export function forbidden(): NextResponse {
  return NextResponse.json({ error: 'forbidden' }, { status: 403 });
}

/**
 * Rate limit por persona para acciones caras o abusables (envío de emails,
 * import, ejecución manual de workflows). null = puede seguir.
 */
export async function limitAction(
  personId: string,
  action: string,
  limit: number,
  windowSec: number,
): Promise<NextResponse | null> {
  if (process.env.RATE_LIMIT_DISABLED === 'true') return null;
  const res = await rateLimit(`crm:${action}:${personId}`, limit, windowSec);
  if (res.ok) return null;
  return NextResponse.json(
    { error: 'rate_limited' },
    { status: 429, headers: { 'retry-after': String(Math.ceil((res.resetAt - Date.now()) / 1000)) } },
  );
}
