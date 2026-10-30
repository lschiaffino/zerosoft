import { NextRequest } from 'next/server';
import { deleteCycle, getCycle, listReviews, updateCycle } from '@/lib/people-perf';
import { pjson, readJson, withPeople } from '@/lib/people-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => {
    const id = (await params).id;
    const cycle = await getCycle(ctx, id);
    return cycle ? pjson({ cycle, reviews: await listReviews(ctx, { cycleId: id }) }) : pjson({ error: 'not_found' }, 404);
  });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => pjson({ cycle: await updateCycle(ctx, (await params).id, await readJson(req)) }));
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => ((await deleteCycle(ctx, (await params).id)) ? pjson({ ok: true }) : pjson({ error: 'not_found' }, 404)));
}
