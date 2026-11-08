/**
 * Quién usa Analytics: sesión o API key (scopes bi:read / bi:write), siempre
 * dentro del workspace activo. Los guests no entran. El rol y las apps de la
 * persona deciden qué tablas de zerosoft ve (lib/bi/zs-tables.ts).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { extractBearer, personAppAccess, requireApiUser } from '../api-auth';
import { getCurrentUser } from '../session';
import { roleAtLeast, type TeamRole } from '../teams';
import { canUseApp, type AppAccess } from '../workspace';
import type { ProductKey } from '../products';

export interface BiViewer {
  /** Dueño del workspace (donde vive todo). */
  workspaceId: string;
  /** Persona real. */
  personId: string;
  role: TeamRole;
  apps: AppAccess | readonly string[];
}

export function biError(status: number, error: string, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ error, ...extra }, { status });
}

export function isResponse(x: unknown): x is Response {
  return x instanceof NextResponse || x instanceof Response;
}

export function viewerCan(viewer: Pick<BiViewer, 'role' | 'apps'>, app: ProductKey): boolean {
  return canUseApp({ role: viewer.role, apps: viewer.apps as AppAccess }, app);
}

/** Bases externas, links públicos y suscripciones de otros: admins y owner. */
export function isBiAdmin(viewer: Pick<BiViewer, 'role'>): boolean {
  return roleAtLeast(viewer.role, 'admin');
}

/** ¿Puede editar o borrar algo que creó `createdBy`? El autor o un admin. */
export function canEditItem(viewer: BiViewer, createdBy: string): boolean {
  return isBiAdmin(viewer) || viewer.personId === createdBy;
}

export async function biActor(req: NextRequest | Request, need: 'read' | 'write'): Promise<BiViewer | NextResponse> {
  if (extractBearer(req)) {
    const auth = await requireApiUser(req, need === 'write' ? 'bi:write' : 'bi:read');
    if ('res' in auth) return auth.res;
    const access = await personAppAccess(auth.user.id, auth.personId);
    if (!access) return biError(403, 'forbidden');
    const viewer: BiViewer = { workspaceId: auth.user.id, personId: auth.personId, role: access.role, apps: access.apps };
    if (!viewerCan(viewer, 'analytics')) return biError(403, 'forbidden');
    return viewer;
  }
  const user = await getCurrentUser();
  if (!user) return biError(401, 'unauthorized');
  const viewer: BiViewer = { workspaceId: user.id, personId: user.actingUser?.id ?? user.id, role: user.role, apps: user.apps ?? '*' };
  if (user.role === 'guest' || !viewerCan(viewer, 'analytics')) return biError(403, 'forbidden');
  return viewer;
}

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await req.json()) as unknown;
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
