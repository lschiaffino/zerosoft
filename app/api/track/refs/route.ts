import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { resolveIssueRefs } from '@/lib/track-ux';
import { unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** `?refs=ZER-1,ZER-2` (identificadores o ids) → issue con su estado, solo del workspace. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const refs = (req.nextUrl.searchParams.get('refs') ?? '').split(',');
  const rows = await resolveIssueRefs(refs, user.team?.id ?? null, user.id);
  return NextResponse.json({ rows });
}
