import { NextRequest } from 'next/server';
import { acknowledge } from '@/lib/people-docs';
import { pjson, withPeople } from '@/lib/people-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** POST: "leí la política". */
export async function POST(_req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => {
    await acknowledge(ctx, (await params).id);
    return pjson({ ok: true });
  });
}
