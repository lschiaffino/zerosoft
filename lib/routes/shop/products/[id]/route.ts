import { NextRequest } from 'next/server';
import { deleteProduct, getProduct, updateProduct } from '@/lib/shop';
import { productPatchSchema } from '@/lib/shop-schema';
import { readJson, shopActor, shopFail, shopJson } from '@/lib/shop-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  const product = await getProduct(a.actor.ws, (await params).id);
  return product ? shopJson({ product }) : shopJson({ error: 'not_found' }, 404);
}

/** PATCH: cualquier campo; `variants` reemplaza la lista (las que traen id conservan su stock). */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  const parsed = productPatchSchema.safeParse(await readJson(req));
  if (!parsed.success) return shopJson({ error: 'invalid_input' }, 400);
  try {
    return shopJson({ product: await updateProduct(a.actor, (await params).id, parsed.data) });
  } catch (err) {
    return shopFail(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  return (await deleteProduct(a.actor, (await params).id)) ? shopJson({ ok: true }) : shopJson({ error: 'not_found' }, 404);
}
