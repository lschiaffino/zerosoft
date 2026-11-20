import { NextRequest } from 'next/server';
import { cancelRequest, decideRequest, editRequest } from '@/lib/people-timeoff';
import { pjson, readJson, withPeople } from '@/lib/people-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/**
 * PATCH { action: approve | deny | cancel, note }, o
 * { action: 'edit', policyId?, startDate?, endDate?, half?, note? }: editar vuelve el pedido a pendiente.
 */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => {
    const id = (await params).id;
    const b = await readJson(req);
    if (b.action === 'cancel') return pjson({ request: await cancelRequest(ctx, id) });
    if (b.action === 'edit') {
      return pjson({
        request: await editRequest(ctx, id, { policyId: str(b.policyId), startDate: str(b.startDate), endDate: str(b.endDate), half: str(b.half), note: str(b.note) }),
      });
    }
    if (b.action !== 'approve' && b.action !== 'deny') return pjson({ error: 'invalid_action' }, 400);
    return pjson({ request: await decideRequest(ctx, id, b.action, typeof b.note === 'string' ? b.note : '') });
  });
}
