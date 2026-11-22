/**
 * CRM Dashboards — quién mira, armado desde la sesión (páginas y rutas).
 * Server-only.
 */
import { NextResponse } from 'next/server';
import type { SessionUser } from './session';
import { sessionScope, type Viewer } from './crm-visibility';
import { sessionFieldViewer } from './crm-field-perms';
import { crmError, forbidden, notFound } from './crm-http';
import { DashboardError, listReportOwners, type TileViewer } from './crm-dashboards';

export function sessionViewer(user: SessionUser): Viewer {
  return { workspaceId: user.id, personId: user.actingUser?.id ?? user.id, role: user.role };
}

export async function sessionTileViewer(user: SessionUser, locale: string): Promise<TileViewer> {
  const scope = await sessionScope(user);
  return {
    viewer: sessionViewer(user),
    scope,
    fieldViewer: sessionFieldViewer(user),
    owners: await listReportOwners(user, scope),
    locale,
  };
}

/** DashboardError → 404 / 403 / 400; cualquier otro error sigue de largo. */
export function dashboardErrorResponse(e: unknown): NextResponse {
  if (e instanceof DashboardError) {
    if (e.code === 'not_found') return notFound();
    if (e.code === 'forbidden') return forbidden();
    return crmError(400, 'invalid_input');
  }
  throw e;
}
