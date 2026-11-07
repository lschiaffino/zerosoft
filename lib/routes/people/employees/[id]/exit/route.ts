import type { NextRequest } from 'next/server';
import { pjson, readJson, withPeople } from '@/lib/people-http';
import { finishExit, reactivateEmployee } from '@/lib/people-extras';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** POST { action: finish | reactivate }: HR confirma una salida vencida, la cancela o deshace una baja. */
export async function POST(req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => {
    const b = await readJson(req);
    const id = (await params).id;
    if (b.action === 'finish') await finishExit(ctx, id);
    else if (b.action === 'reactivate') await reactivateEmployee(ctx, id);
    else return pjson({ error: 'invalid_input' }, 400);
    return pjson({ ok: true });
  });
}
