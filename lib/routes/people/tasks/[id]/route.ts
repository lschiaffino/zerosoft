import { NextRequest } from 'next/server';
import { setTaskDone } from '@/lib/people-onboarding';
import { pjson, readJson, withPeople } from '@/lib/people-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** PATCH { done }: marcar una tarea de onboarding u offboarding. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => {
    const b = await readJson(req);
    await setTaskDone(ctx, (await params).id, b.done === true);
    return pjson({ ok: true });
  });
}
