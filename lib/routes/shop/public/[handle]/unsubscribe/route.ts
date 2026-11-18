import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { unsubscribeByToken } from '@/lib/shop-abandoned';
import { publishedStore } from '@/lib/shop-storefront';
import { storefrontStrings } from '@/lib/shop-i18n';
import { escapeHtml } from '@/lib/email';
import { shopJson, shopLimit } from '@/lib/shop-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ handle: string }> };


async function run(req: NextRequest, handle: string): Promise<NextResponse> {
  const limited = await shopLimit(req, 'unsub', 30, 600, handle);
  if (limited) return limited;
  const store = await publishedStore(handle);
  if (!store) return shopJson({ error: 'not_found' }, 404);
  await unsubscribeByToken(store.row.workspace_id, req.nextUrl.searchParams.get('token') ?? '');
  const t = storefrontStrings(store.dto.locale);
  // Misma respuesta exista o no el token: no sirve para probar links.
  return new NextResponse(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(store.dto.name)}</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px"><p>${escapeHtml(t.unsubscribed)}</p></body>`, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** GET desde el link del email; POST es el "one-click" de los clientes de correo (RFC 8058). */
export async function GET(req: NextRequest, { params }: Ctx) {
  return run(req, (await params).handle);
}

export async function POST(req: NextRequest, { params }: Ctx) {
  return run(req, (await params).handle);
}
