import { NextRequest } from 'next/server';
import { createLocation, listLocations } from '@/lib/shop';
import { readJson, shopActor, shopFail, shopJson } from '@/lib/shop-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const a = await shopActor();
  if ('res' in a) return a.res;
  return shopJson({ locations: await listLocations(a.actor.ws) });
}

export async function POST(req: NextRequest) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  const body = (await readJson(req)) as { name?: unknown } | null;
  try {
    return shopJson({ location: await createLocation(a.actor, String(body?.name ?? '')) }, 201);
  } catch (err) {
    return shopFail(err);
  }
}
