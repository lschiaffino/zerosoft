/**
 * Track — envoltorio de las rutas /api/v1/track/*: API key con el scope
 * pedido (track:read para leer, track:write para escribir), rate limit y
 * errores con la forma { error: { code, message } } de toda la API v1.
 */
import { NextResponse } from 'next/server';
import { requireApiUser } from './api-auth';
import type { ApiScope } from './api-scopes';
import { apiErrorResponse, TrackApiError, type TrackApiCtx } from './track-api-ops';

export async function trackApiRoute(
  req: Request,
  scope: Extract<ApiScope, 'track:read' | 'track:write'>,
  fn: (ctx: TrackApiCtx) => Promise<unknown>,
  status = 200,
): Promise<Response> {
  const auth = await requireApiUser(req, scope);
  if ('res' in auth) return auth.res;
  try {
    const data = await fn({ auth, via: 'api' });
    return NextResponse.json(data, { status });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

/** Cuerpo JSON o error 400 con el formato de la API. */
export async function jsonBody(req: Request): Promise<unknown> {
  const body = await req.json().catch(() => undefined);
  if (body === undefined) throw new TrackApiError(400, 'invalid_json', 'The body must be JSON.');
  return withTeamAlias(body);
}

/**
 * Un proyecto de Track es un team de Linear: la API acepta `teamId` como
 * sinónimo de `projectId` (el nombre viejo sigue funcionando).
 */
export function withTeamAlias<T>(value: T): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const o = value as Record<string, unknown>;
  if (o.teamId !== undefined && o.projectId === undefined) return { ...o, projectId: o.teamId } as T;
  return value;
}

export function queryObject(req: Request): Record<string, string> {
  return withTeamAlias(Object.fromEntries(new URL(req.url).searchParams.entries()));
}
