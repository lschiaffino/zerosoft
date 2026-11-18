import { NextRequest } from 'next/server';
import { createPage, listPages } from '@/lib/shop-pages';
import { readJson, shopActor, shopFail, shopJson } from '@/lib/shop-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  return shopJson({ pages: await listPages(a.actor.ws, { q: req.nextUrl.searchParams.get('q') ?? undefined }) });
}

export async function POST(req: NextRequest) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  try {
    return shopJson({ page: await createPage(a.actor, await readJson(req)) }, 201);
  } catch (err) {
    return shopFail(err);
  }
}
