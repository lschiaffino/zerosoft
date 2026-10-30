import { NextRequest } from 'next/server';
import { MAX_IMAGE_BYTES, saveShopImage } from '@/lib/shop';
import { shopActor, shopFail, shopJson } from '@/lib/shop-http';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/shop/images (multipart, campo "file"): sube una foto de producto
 * o el logo. El tipo sale de los bytes (PNG, JPEG, GIF, WebP, AVIF; nunca SVG).
 */
export async function POST(req: NextRequest) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  const limited = await rateLimit(`shop:img:${a.actor.person}`, 120, 3600);
  if (!limited.ok) return shopJson({ error: 'rate_limited' }, 429);
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > MAX_IMAGE_BYTES + 64 * 1024) return shopJson({ error: 'file_too_large' }, 413);
  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get('file');
    file = f instanceof File ? f : null;
  } catch {
    return shopJson({ error: 'invalid_input' }, 400);
  }
  if (!file) return shopJson({ error: 'invalid_input' }, 400);
  try {
    const url = await saveShopImage(Buffer.from(await file.arrayBuffer()));
    return shopJson({ url }, 201);
  } catch (err) {
    return shopFail(err);
  }
}
