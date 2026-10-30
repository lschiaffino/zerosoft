import { NextRequest } from 'next/server';
import { deleteGoal, updateGoal } from '@/lib/people-perf';
import { pjson, readJson, withPeople } from '@/lib/people-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => {
    await updateGoal(ctx, (await params).id, await readJson(req));
    return pjson({ ok: true });
  });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => ((await deleteGoal(ctx, (await params).id)) ? pjson({ ok: true }) : pjson({ error: 'not_found' }, 404)));
}
