import { NextRequest, NextResponse } from 'next/server';
import { withTalk } from '@/lib/talk-http';
import { listEventsSince } from '@/lib/talk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Feed por polling (fallback del stream): eventos desde ?cursor=. */
export async function GET(req: NextRequest) {
  return withTalk(async ({ actor }) => {
    const cursor = Math.max(0, Math.floor(Number(req.nextUrl.searchParams.get('cursor')) || 0));
    return NextResponse.json(await listEventsSince(actor, cursor));
  });
}
