import { NextRequest } from 'next/server';
import { cancelRequest, decideRequest } from '@/lib/people-timeoff';
import { pjson, readJson, withPeople } from '@/lib/people-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** PATCH { action: approve | deny | cancel, note }. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => {
    const id = (await params).id;
    const b = await readJson(req);
    if (b.action === 'cancel') return pjson({ request: await cancelRequest(ctx, id) });
    if (b.action !== 'approve' && b.action !== 'deny') return pjson({ error: 'invalid_action' }, 400);
    return pjson({ request: await decideRequest(ctx, id, b.action, typeof b.note === 'string' ? b.note : '') });
  });
}
