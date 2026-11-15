import { NextRequest } from 'next/server';
import { fJson, withFleet } from '@/lib/fleet/api';
import { feedSince } from '@/lib/fleet/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Feed por polling (fallback del stream): eventos desde ?cursor=. */
export async function GET(req: NextRequest) {
  return withFleet(async ({ actor }) => {
    const cursor = Math.max(0, Math.floor(Number(req.nextUrl.searchParams.get('cursor')) || 0));
    return fJson(await feedSince(actor, cursor));
  });
}
