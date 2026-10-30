import { NextRequest } from 'next/server';
import { addHoliday, holidaysFor } from '@/lib/people-timeoff';
import { pjson, readJson, withPeople } from '@/lib/people-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET ?country=AR&year=2026: feriados del seed más los propios. */
export async function GET(req: NextRequest) {
  return withPeople(async (ctx) => {
    const sp = req.nextUrl.searchParams;
    const year = Number(sp.get('year')) || new Date().getUTCFullYear();
    return pjson({ holidays: await holidaysFor(ctx.ws, (sp.get('country') ?? '').toUpperCase().slice(0, 2), [year]) });
  });
}

export async function POST(req: NextRequest) {
  return withPeople(async (ctx) => pjson({ holiday: await addHoliday(ctx, await readJson(req)) }, 201));
}
