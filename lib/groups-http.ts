/**
 * Groups: helpers de las rutas API (app/api/groups/**). Errores como
 * { error: '<code>' }; la UI los traduce con groups.errors.*.
 */
import { NextResponse } from 'next/server';
import { AiError } from './ai';
import { getCurrentUser, type SessionUser } from './session';
import { roleAtLeast } from './teams';
import { limitWrites } from './write-limit';
import { GroupsError, getNumberRow, type NumberRow } from './groups';
import { canManageNumber, numberManager, type NumberManager } from './groups-number-perms';
import { ProviderError } from './groups-provider';
import { canSeeChat, canSeeNumber, groupsViewer, type GroupsViewer } from './groups-access';
import { HubspotError } from './groups-hubspot';

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
  /** Qué líneas puede agregar y administrar (lib/groups-number-perms.ts). */
  manager: NumberManager;
}

/** Quién mira en este request (acceso por etiqueta y teléfonos ocultos). */
export async function sessionViewer(s: GroupsSession): Promise<GroupsViewer> {
  return groupsViewer(s.ws, s.me, s.user.role);
}

/** 404 si el chat no existe o la persona no lo puede ver (acceso por etiqueta). */
export async function chatGuard(s: GroupsSession, chatId: string): Promise<{ viewer: GroupsViewer } | NextResponse> {
  const viewer = await sessionViewer(s);
  if (!(await canSeeChat(viewer, chatId))) return groupsError(404, 'not_found');
  return { viewer };
}

/** 404 si la línea no existe o la persona no la puede ver (líneas restringidas). */
export async function numberGuard(s: GroupsSession, numberId: string): Promise<{ viewer: GroupsViewer } | NextResponse> {
  const viewer = await sessionViewer(s);
  if (!(await canSeeNumber(viewer, numberId))) return groupsError(404, 'not_found');
  return { viewer };
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
  return { user, ws: user.id, me, isAdmin, manager: numberManager(user) };
}

/**
 * Para administrar una línea (conectar, editar, desconectar, borrar): la fila
 * si quien pide puede, o la respuesta. Sin permiso para administrar líneas,
 * 403; una línea que no existe o que no ve, 404; una que ve pero no es suya, 403.
 */
export async function numberGuard(s: GroupsSession, id: string): Promise<NumberRow | NextResponse> {
  if (!s.manager.canAdd) return groupsError(403, 'forbidden');
  const row = await getNumberRow(s.ws, id);
  if (!row) return groupsError(404, 'not_found');
  if (s.manager.isAdmin) return row;
  if (!(await canSeeNumber(await sessionViewer(s), id))) return groupsError(404, 'not_found');
  return canManageNumber(s.manager, row) ? row : groupsError(403, 'forbidden');
}

/** Error conocido → respuesta. Lo desconocido se loguea sin detalles y es 500. */
export function handleGroupsError(err: unknown): NextResponse {
  if (err instanceof GroupsError) return groupsError(err.status, err.code);
  if (err instanceof ProviderError) return groupsError(502, err.code);
  if (err instanceof HubspotError) return groupsError(err.status, err.code);
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
