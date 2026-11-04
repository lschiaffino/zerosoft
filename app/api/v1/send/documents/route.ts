import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import { getUserById } from '@/lib/db';
import { listDocuments } from '@/lib/send/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/send/documents (send:read): documentos que la persona de la key ve, con links y visitas. */
export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req, 'send:read');
  if ('res' in auth) return auth.res;
  const person = await getUserById(auth.personId);
  const actor = { ws: auth.user.id, person: auth.personId, admin: auth.role === 'owner' || auth.role === 'admin', email: (person?.email ?? '').toLowerCase(), name: person?.name ?? '' };
  return NextResponse.json({ data: await listDocuments(actor, { q: req.nextUrl.searchParams.get('q') ?? undefined }) });
}
