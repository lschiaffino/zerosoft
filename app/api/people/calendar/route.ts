import { NextRequest } from 'next/server';
import { teamCalendar } from '@/lib/people-timeoff';
import { pjson, withPeople } from '@/lib/people-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET ?from=&to=&country=: quién está fuera y los feriados. */
export async function GET(req: NextRequest) {
  return withPeople(async (ctx) => {
    const sp = req.nextUrl.searchParams;
    return pjson(await teamCalendar(ctx, sp.get('from') ?? '', sp.get('to') ?? '', (sp.get('country') ?? '').toUpperCase().slice(0, 2)));
  });
}
