import { NextRequest } from 'next/server';
import { createCollection, listCollections } from '@/lib/shop';
import { readJson, shopActor, shopFail, shopJson } from '@/lib/shop-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  return shopJson({ collections: await listCollections(a.actor.ws, { q: req.nextUrl.searchParams.get('q') ?? undefined }) });
}

/** POST /api/shop/collections: manual (productIds) o automática (rules). */
export async function POST(req: NextRequest) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  try {
    return shopJson({ collection: await createCollection(a.actor, await readJson(req)) }, 201);
  } catch (err) {
    return shopFail(err);
  }
}
