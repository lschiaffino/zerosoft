/**
 * Helpers de las rutas de Analytics (app/api/analytics/**): quién llama
 * (sesión o API key con scope analytics:*), el rol que hace falta y el
 * proyecto, siempre del workspace activo. Errores { error: '<code>' }.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { extractBearer, requireApiUser } from '../api-auth';
import { getCurrentUser, type SessionUser } from '../session';
import { roleAtLeast, type TeamRole } from '../teams';
import { userCanUseApp } from '../workspace';
import { getDb } from '../db';
import { getProject, type ProjectRow } from './projects';

export function aError(status: number, error: string, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ error, ...extra }, { status });
}

export interface AnalyticsActor {
  /** Dueño del workspace (donde viven los proyectos). */
  workspaceId: string;
  /** Persona real (sesión o quien creó la API key). */
  personId: string;
  role: TeamRole;
  /** Sesión (null si es una API key). */
  user: SessionUser | null;
}

/** Proyectos, keys, ajustes y borrar personas: admins y owner (como la org de PostHog). */
export function canManageAnalytics(actor: Pick<AnalyticsActor, 'role'>): boolean {
  return roleAtLeast(actor.role, 'admin');
}

/**
 * Sesión (con la app Analytics en el workspace activo) o API key con el
 * scope analytics:read / analytics:write. Un guest nunca entra.
 */
export async function analyticsActor(req: NextRequest | Request, need: 'read' | 'write'): Promise<AnalyticsActor | NextResponse> {
  if (extractBearer(req)) {
    const auth = await requireApiUser(req, need === 'write' ? 'analytics:write' : 'analytics:read');
    if ('res' in auth) return auth.res;
    return { workspaceId: auth.user.id, personId: auth.personId, role: auth.role, user: null };
  }
  const user = await getCurrentUser();
  if (!user) return aError(401, 'unauthorized');
  if (!userCanUseApp(user, 'analytics') || user.role === 'guest') return aError(403, 'forbidden');
  return { workspaceId: user.id, personId: user.actingUser?.id ?? user.id, role: user.role, user };
}

export function isResponse(x: unknown): x is NextResponse {
  return x instanceof NextResponse || x instanceof Response;
}

/** Proyecto pedido (?project= o body.projectId) del workspace del actor, o 404. */
export async function actorProject(actor: AnalyticsActor, id: string | null | undefined): Promise<ProjectRow | NextResponse> {
  if (!id || typeof id !== 'string') return aError(400, 'project_required');
  const p = await getProject(actor.workspaceId, id);
  return p ?? aError(404, 'project_not_found');
}

const RECORD_TABLES = ['analytics_insights', 'analytics_dashboards', 'analytics_cohorts', 'analytics_flags', 'analytics_persons'] as const;
export type RecordTable = (typeof RECORD_TABLES)[number];

/** Proyecto de un registro (insight, tablero, cohorte, flag, persona) si es del workspace del actor; si no, 404. */
export async function recordProject(actor: AnalyticsActor, table: RecordTable, id: string): Promise<ProjectRow | NextResponse> {
  if (!RECORD_TABLES.includes(table)) return aError(404, 'not_found');
  const row = (await getDb().prepare(`SELECT project_id FROM ${table} WHERE id = ?`).get(id)) as { project_id: string } | undefined;
  if (!row) return aError(404, 'not_found');
  const p = await getProject(actor.workspaceId, row.project_id);
  return p ?? aError(404, 'not_found');
}

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  const body = await req.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}
