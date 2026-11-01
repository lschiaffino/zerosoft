import { NextRequest } from 'next/server';
import { handle, need, readJson } from '@/lib/books-http';
import { createAsset, listAssets, type AssetInput } from '@/lib/books-accounting';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return handle(async ({ actor }) => {
    need(actor, 'accounting.read');
    return { assets: await listAssets(actor.ws, { q: req.nextUrl.searchParams.get('q') ?? undefined }) };
  });
}

export async function POST(req: NextRequest) {
  return handle(async ({ actor }) => ({ asset: await createAsset(actor, (await readJson(req)) as AssetInput) }), 201);
}
