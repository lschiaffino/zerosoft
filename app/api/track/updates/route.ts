import { NextRequest, NextResponse } from 'next/server';
import { planningContext } from '@/lib/track-planning-http';
import { listPulse } from '@/lib/track-pulse';
import { unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Updates (Pulse de Linear): updates de projects e initiatives, ?tab=for_me|all y ?before=<cursor>. */
export async function GET(req: NextRequest) {
  const ctx = await planningContext();
  if (!ctx) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const tab = sp.get('tab') === 'all' ? 'all' : 'for_me';
  return NextResponse.json(await listPulse(ctx.scope, ctx.actorId, { tab, before: sp.get('before') }));
}
