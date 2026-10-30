import { NextRequest, NextResponse } from 'next/server';
import { withSocial } from '@/lib/social-http';
import { socialBestTimes } from '@/lib/social-analytics';
import { nextAt } from '@/lib/social-schedule';
import { isValidTimeZone } from '@/lib/user-tz';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Mejores horarios (?account=, ?tz=). source = 'data' cuando salen de las
 * métricas propias; 'default' cuando todavía no hay datos (la UI lo dice).
 */
export async function GET(req: NextRequest) {
  return withSocial(async ({ actor }) => {
    const sp = req.nextUrl.searchParams;
    const tzParam = sp.get('tz') ?? 'UTC';
    const tz = tzParam.length <= 64 && isValidTimeZone(tzParam) ? tzParam : 'UTC';
    const res = await socialBestTimes(actor, sp.get('account') || null, tz);
    return NextResponse.json({ ...res, tz, times: res.times.map((t) => ({ ...t, next: nextAt(t.weekday, t.hour, tz).toISOString() })) });
  });
}
