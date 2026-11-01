import { NextRequest } from 'next/server';
import { handle, must, need, readJson } from '@/lib/books-http';
import { deleteAsset, disposeAsset, getAsset, updateAsset, type AssetInput } from '@/lib/books-accounting';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => {
    need(actor, 'accounting.read');
    return { asset: must(await getAsset(actor.ws, (await params).id)) };
  });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => ({ asset: await updateAsset(actor, (await params).id, (await readJson(req)) as AssetInput & { status?: 'registered' | 'draft' }) }));
}

export async function POST(req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => ({ asset: await disposeAsset(actor, (await params).id, (await readJson(req)) as Parameters<typeof disposeAsset>[2]) }));
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => {
    await deleteAsset(actor, (await params).id);
    return { ok: true };
  });
}
