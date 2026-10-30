import { NextRequest } from 'next/server';
import { deleteCollection, getCollection, updateCollection } from '@/lib/shop';
import { readJson, shopActor, shopFail, shopJson } from '@/lib/shop-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  const collection = await getCollection(a.actor.ws, (await params).id);
  return collection ? shopJson({ collection }) : shopJson({ error: 'not_found' }, 404);
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  try {
    return shopJson({ collection: await updateCollection(a.actor, (await params).id, await readJson(req)) });
  } catch (err) {
    return shopFail(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  return (await deleteCollection(a.actor, (await params).id)) ? shopJson({ ok: true }) : shopJson({ error: 'not_found' }, 404);
}
