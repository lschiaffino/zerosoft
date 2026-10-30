import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import { listResponses } from '@/lib/forms/responses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/forms/responses?form=<id> (forms:read): respuestas completas
 * (o parciales con status=partial) de un form que la persona de la key ve.
 */
export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req, 'forms:read');
  if ('res' in auth) return auth.res;
  const sp = req.nextUrl.searchParams;
  const formId = sp.get('form') ?? '';
  const actor = { ws: auth.user.id, person: auth.personId, admin: auth.role === 'owner' || auth.role === 'admin' };
  const res = await listResponses(actor, formId, {
    status: sp.get('status') === 'partial' ? 'partial' : 'completed',
    from: sp.get('from') ?? undefined,
    to: sp.get('to') ?? undefined,
    page: Number(sp.get('page')) || 1,
    pageSize: Math.min(Number(sp.get('limit')) || 50, 200),
  });
  if (!res) return NextResponse.json({ error: { code: 'not_found', message: 'Form not found.' } }, { status: 404 });
  return NextResponse.json({ data: res.rows, total: res.total });
}
