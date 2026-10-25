import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { trackWorkspaceId } from '@/lib/track-labels';
import { AUDIT_ACTIONS, auditToCsv, listAudit } from '@/lib/track-audit';
import { trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Audit log de Track (solo admins). ?format=csv descarga hasta 5000 filas con los mismos filtros. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return trackError(403, 'forbidden');
  const sp = new URL(req.url).searchParams;
  const action = sp.get('action');
  const query = {
    action: action && (AUDIT_ACTIONS as readonly string[]).includes(action) ? action : null,
    actorId: sp.get('actor'),
    entityType: sp.get('entity'),
    q: sp.get('q'),
  };
  const ws = trackWorkspaceId(user.team?.id ?? null, user.id);
  if (sp.get('format') === 'csv') {
    const { rows } = await listAudit(ws, { ...query, limit: 5000 });
    return new NextResponse(auditToCsv(rows), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="track-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }
  const offset = Math.max(Number(sp.get('offset') ?? '0') || 0, 0);
  const res = await listAudit(ws, { ...query, limit: 50, offset });
  return NextResponse.json({ ...res, offset, actions: AUDIT_ACTIONS });
}
