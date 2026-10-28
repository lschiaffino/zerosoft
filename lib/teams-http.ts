/**
 * Helpers de las rutas de /api/teams: sesión, workspace activo y permisos.
 * Todas operan sobre el workspace activo de la sesión (user.workspace): para
 * gestionar otro, primero se cambia con /api/teams/switch.
 */
import { NextResponse, type NextRequest } from 'next/server';
import type { TeamRow, UserRow } from './db';
import { getCurrentUser, realUserId, type SessionUser } from './session';
import { roleAtLeast, type TeamRole } from './teams';
import { ensureWorkspace } from './workspace';

export function teamsError(code: string, status = 400): NextResponse {
  return NextResponse.json({ error: code }, { status });
}

export interface TeamsCtx {
  user: SessionUser;
  /** Persona real (no el owner del workspace). */
  real: UserRow;
  realId: string;
  team: TeamRow;
  role: TeamRole;
}

/** Sesión + workspace activo. `min`: rol mínimo (admin para gestionar). */
export async function teamsCtx(min: TeamRole = 'member'): Promise<TeamsCtx | NextResponse> {
  const user = await getCurrentUser();
  if (!user) return teamsError('unauthorized', 401);
  const team = user.workspace ?? (await ensureWorkspace(user.id));
  if (!roleAtLeast(user.role, min)) return teamsError('forbidden', 403);
  return { user, real: user.actingUser ?? user, realId: realUserId(user), team, role: user.role };
}

export function isResponse(x: unknown): x is NextResponse {
  return x instanceof NextResponse;
}

/** Base pública para los links (NEXTAUTH_URL o el origen del pedido). */
export function publicBase(req: NextRequest): string {
  return (process.env.NEXTAUTH_URL ?? req.nextUrl.origin).replace(/\/$/, '');
}

/** Locale del que invita: el del body, el del Referer o en. */
export function requestLocale(req: NextRequest, explicit?: unknown): string {
  if (explicit === 'es' || explicit === 'pt' || explicit === 'en') return explicit;
  const m = /^https?:\/\/[^/]+\/(en|es|pt)(?:\/|$)/.exec(req.headers.get('referer') ?? '');
  return m ? m[1] : 'en';
}

/**
 * ¿`actor` puede cambiar a `target`? El owner, a cualquiera menos a sí
 * mismo; un admin, a members y guests (a otro admin no).
 */
export function canManage(actor: TeamRole, target: TeamRole): boolean {
  if (target === 'owner') return false;
  if (actor === 'owner') return true;
  return actor === 'admin' && (target === 'member' || target === 'guest');
}
