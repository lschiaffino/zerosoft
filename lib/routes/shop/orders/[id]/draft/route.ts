import { NextRequest } from 'next/server';
import { confirmDraftOrder, deleteDraftOrder, updateDraftOrder } from '@/lib/shop-ops';
import { readJson, shopActor, shopFail, shopJson } from '@/lib/shop-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };


/** PATCH: edita el borrador. POST { mode: pending | invoice | paid }: lo confirma. DELETE: lo borra. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  try {
    return shopJson({ order: await updateDraftOrder(a.actor, (await params).id, await readJson(req)) });
  } catch (err) {
    return shopFail(err);
  }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  const body = ((await readJson(req)) ?? {}) as { mode?: string };
  const mode = body.mode === 'invoice' || body.mode === 'paid' ? body.mode : 'pending';
  try {
    return shopJson(await confirmDraftOrder(a.actor, (await params).id, mode));
  } catch (err) {
    return shopFail(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  try {
    await deleteDraftOrder(a.actor, (await params).id);
    return shopJson({ ok: true });
  } catch (err) {
    return shopFail(err);
  }
}
