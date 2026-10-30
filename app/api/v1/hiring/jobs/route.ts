import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import { listJobs } from '@/lib/hiring/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/hiring/jobs (hiring:read): puestos del workspace (status, q). */
export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req, 'hiring:read');
  if ('res' in auth) return auth.res;
  const sp = req.nextUrl.searchParams;
  const actor = { ws: auth.user.id, person: auth.personId, admin: auth.role === 'owner' || auth.role === 'admin' };
  const jobs = await listJobs(actor, { status: sp.get('status') ?? undefined, q: sp.get('q') ?? undefined });
  return NextResponse.json({ data: jobs.map(({ questions: _q, ...j }) => j) });
}
