import { NextRequest } from 'next/server';
import { deleteLocation, updateLocation } from '@/lib/shop';
import { readJson, shopActor, shopFail, shopJson } from '@/lib/shop-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  const body = (await readJson(req)) as { name?: unknown; isDefault?: unknown } | null;
  try {
    await updateLocation(a.actor, (await params).id, {
      name: typeof body?.name === 'string' ? body.name : undefined,
      isDefault: body?.isDefault === true,
    });
    return shopJson({ ok: true });
  } catch (err) {
    return shopFail(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  try {
    await deleteLocation(a.actor, (await params).id);
    return shopJson({ ok: true });
  } catch (err) {
    return shopFail(err);
  }
}
