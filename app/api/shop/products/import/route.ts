import { NextRequest } from 'next/server';
import { importProductsCsv } from '@/lib/shop-csv';
import { shopActor, shopFail, shopJson } from '@/lib/shop-http';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_CSV = 5 * 1024 * 1024;

/**
 * POST /api/shop/products/import (multipart: file, update=1, images=0): CSV
 * de productos de Shopify o la exportación de Tiendanube.
 */
export async function POST(req: NextRequest) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  const limited = await rateLimit(`shop:import:${a.actor.ws}`, 20, 3600);
  if (!limited.ok) return shopJson({ error: 'rate_limited' }, 429);
  let text = '';
  let update = false;
  let images = true;
  try {
    const form = await req.formData();
    const f = form.get('file');
    if (!(f instanceof File)) return shopJson({ error: 'invalid_input' }, 400);
    if (f.size > MAX_CSV) return shopJson({ error: 'file_too_large' }, 413);
    const buf = Buffer.from(await f.arrayBuffer());
    // Tiendanube exporta en Latin-1: si no es UTF-8 válido, se lee como windows-1252.
    text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
    if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf);
    update = form.get('update') === '1';
    images = form.get('images') !== '0';
  } catch {
    return shopJson({ error: 'invalid_input' }, 400);
  }
  try {
    const summary = await importProductsCsv(a.actor, text, { update, fetchImages: images });
    return shopJson({ summary });
  } catch (err) {
    return shopFail(err);
  }
}
