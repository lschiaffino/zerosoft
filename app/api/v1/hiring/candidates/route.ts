import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import { listApplications } from '@/lib/hiring/candidates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/hiring/candidates (hiring:read): postulaciones que la persona
 * dueña de la key puede ver (equipo del puesto o admin), con jobId, status,
 * source, tag y q. Una key de alguien fuera del equipo no ve candidatos.
 */
export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req, 'hiring:read');
  if ('res' in auth) return auth.res;
  const sp = req.nextUrl.searchParams;
  const actor = { ws: auth.user.id, person: auth.personId, admin: auth.role === 'owner' || auth.role === 'admin' };
  const data = await listApplications(actor, {
    q: sp.get('q') ?? undefined,
    jobId: sp.get('jobId') ?? undefined,
    status: sp.get('status') ?? 'active',
    source: sp.get('source') ?? undefined,
    tag: sp.get('tag') ?? undefined,
    limit: Math.min(500, Number(sp.get('limit') ?? 100) || 100),
  });
  return NextResponse.json({ data });
}
