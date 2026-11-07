import type { NextRequest } from 'next/server';
import { pjson, readJson, withPeople } from '@/lib/people-http';
import { decideChange } from '@/lib/people-extras';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** PATCH { decision: approve | deny, note }: HR decide el pedido. Nadie aprueba lo propio. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => {
    const b = await readJson(req);
    await decideChange(ctx, (await params).id, b.decision === 'approve' ? 'approve' : 'deny', String(b.note ?? ''), b.confirmStale === true);
    return pjson({ ok: true });
  });
}
