import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import { getUserById } from '@/lib/db';
import { listEnvelopes, SIGN_BOXES, type SignBox } from '@/lib/sign/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/sign/envelopes (sign:read): sobres que la persona dueña de la
 * key ve (los suyos y los que la esperan; un admin, todos), con box y q. Sin
 * archivos: los PDFs se bajan desde la app.
 */
export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req, 'sign:read');
  if ('res' in auth) return auth.res;
  const person = await getUserById(auth.personId);
  const actor = { ws: auth.user.id, person: auth.personId, admin: auth.role === 'owner' || auth.role === 'admin', email: (person?.email ?? '').toLowerCase(), name: person?.name ?? '' };
  const sp = req.nextUrl.searchParams;
  const box = (SIGN_BOXES as string[]).includes(sp.get('box') ?? '') ? (sp.get('box') as SignBox) : 'all';
  return NextResponse.json({ data: await listEnvelopes(actor, { box, q: sp.get('q') ?? undefined }) });
}
