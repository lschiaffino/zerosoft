import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import { listForms } from '@/lib/forms/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/forms/forms (forms:read): formularios que la persona de la key ve. */
export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req, 'forms:read');
  if ('res' in auth) return auth.res;
  const actor = { ws: auth.user.id, person: auth.personId, admin: auth.role === 'owner' || auth.role === 'admin' };
  const forms = await listForms(actor, { q: req.nextUrl.searchParams.get('q') ?? undefined, status: req.nextUrl.searchParams.get('status') ?? undefined });
  return NextResponse.json({ data: forms });
}
