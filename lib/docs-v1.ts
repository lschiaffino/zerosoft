/**
 * API pública de Docs (/api/v1/docs): autenticación con API key (scopes
 * docs:read y docs:write), actor de Docs de la persona que creó la key y
 * errores en el formato de la API v1. Server-only.
 */
import { NextResponse } from 'next/server';
import { apiError, requireApiUser, type ApiKeyAuth } from './api-auth';
import type { ApiScope } from './api-scopes';
import type { DocsActor } from './docs';
import { docsActorFor } from './docs-platform-access';
import { DocsPlatformError } from './docs-platform';

export async function docsApi(req: Request, scope: Extract<ApiScope, 'docs:read' | 'docs:write'>): Promise<{ res: NextResponse } | { auth: ApiKeyAuth; actor: DocsActor }> {
  const auth = await requireApiUser(req, scope);
  if ('res' in auth) return auth;
  const actor = await docsActorFor(auth.user.id, auth.personId);
  if (!actor) return { res: apiError(401, 'invalid_key', 'Invalid or revoked API key.') };
  return { auth, actor };
}

const MESSAGES: Record<string, string> = {
  not_found: 'Page not found, or the key owner cannot open it.',
  parent_not_found: 'Parent page not found, or the key owner cannot edit it.',
  template_not_found: 'Template not found.',
  database_not_found: 'Database not found on that page.',
  row_not_found: 'Row not found.',
  block_not_found: 'Block not found on that page.',
  read_only: 'This database is synced from another app and is read-only.',
  forbidden: 'The key owner cannot do this on that page.',
  conflict: 'The page changed while saving. Retry the request.',
  unknown_property: 'Unknown property.',
  read_only_property: 'That property is computed and cannot be written.',
  invalid_value: 'A value does not match its property type.',
  invalid_option: 'That status option does not exist.',
  invalid_person: 'That person is not in the workspace.',
  missing_fields: 'Nothing to update.',
  empty_comment: 'The comment is empty.',
  invalid_parent: 'The parent comment is not on that page.',
  database_full: 'The database has the maximum number of rows.',
  invalid_input: 'Invalid request body.',
};

export function docsV1Error(err: unknown): NextResponse {
  if (err instanceof DocsPlatformError) {
    const [code, detail] = err.code.split(':');
    const base = MESSAGES[code] ?? 'Request failed.';
    return apiError(err.status, code, detail ? `${base} (${detail})` : base);
  }
  throw err;
}

export async function v1Body(req: Request): Promise<Record<string, unknown>> {
  const b = await req.json().catch(() => null);
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
}

export const s = (v: unknown, max = 400_000): string | undefined => (typeof v === 'string' ? v.slice(0, max) : undefined);

export function pageParams(url: string): { limit: number; offset: number } {
  const p = new URL(url).searchParams;
  return { limit: Math.min(100, Math.max(1, Number(p.get('limit')) || 50)), offset: Math.max(0, Number(p.get('offset')) || 0) };
}
