import { NextRequest } from 'next/server';
import { createHandbook } from '@/lib/people-docs';
import { pjson, readJson, withPeople } from '@/lib/people-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST { locale }: crea el manual en Docs y lo deja como política con acuse. */
export async function POST(req: NextRequest) {
  return withPeople(async (ctx) => {
    const b = await readJson(req);
    return pjson(await createHandbook(ctx, typeof b.locale === 'string' ? b.locale : 'en'), 201);
  });
}
