import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import { listSequences } from '@/lib/crm-sequences';
import { cleanRow } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req);
  if ('res' in auth) return auth.res;
  const sequences = await listSequences(auth.user.id);
  return NextResponse.json({ sequences: sequences.map(cleanRow) });
}
