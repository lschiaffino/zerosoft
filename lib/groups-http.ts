/**
 * Groups: helpers de las rutas API (app/api/groups/**). Errores como
 * { error: '<code>' }; la UI los traduce con groups.errors.*.
 */
import { NextResponse } from 'next/server';
import { AiError } from './ai';
import { getCurrentUser, type SessionUser } from './session';
import { roleAtLeast } from './teams';
import { limitWrites } from './write-limit';
import { GroupsError } from './groups';
import { ProviderError } from './groups-provider';

export function groupsError(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status });
}

export interface GroupsSession {
  user: SessionUser;
  /** Dueño del workspace (donde viven los datos). */
  ws: string;
  /** Persona real logueada. */
  me: string;
  isAdmin: boolean;
}

/** Sesión o respuesta 401. `write` aplica el rate limit de escrituras. */
export async function groupsSession(opts: { write?: boolean; admin?: boolean } = {}): Promise<GroupsSession | NextResponse> {
  const user = await getCurrentUser();
  if (!user) return groupsError(401, 'unauthorized');
  const me = user.actingUser?.id ?? user.id;
  const isAdmin = roleAtLeast(user.role, 'admin');
  if (opts.admin && !isAdmin) return groupsError(403, 'forbidden');
  if (opts.write) {
    const limited = await limitWrites('groups', me);
    if (limited) return limited;
  }
  return { user, ws: user.id, me, isAdmin };
}

/** Error conocido → respuesta. Lo desconocido se loguea sin detalles y es 500. */
export function handleGroupsError(err: unknown): NextResponse {
  if (err instanceof GroupsError) return groupsError(err.status, err.code);
  if (err instanceof ProviderError) return groupsError(502, err.code);
  if (err instanceof AiError) return groupsError(err.code === 'ai_disabled' ? 503 : 429, err.code);
  // eslint-disable-next-line no-console
  console.error('[groups] request failed', (err as Error)?.name ?? 'error');
  return groupsError(500, 'server_error');
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const body = await req.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

export const str = (v: unknown, max = 4096): string | undefined => (typeof v === 'string' ? v.slice(0, max) : undefined);
export const strArr = (v: unknown, max = 2000): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, max) : [];
