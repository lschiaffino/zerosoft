import { NextRequest, NextResponse } from 'next/server';
import { recordUnsubscribe } from '@/lib/crm-email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function page(title: string, body: string, status = 200): NextResponse {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;max-width:420px;margin:15vh auto;padding:0 16px;color:#111;background:#fff}h1{font-size:18px;font-weight:600}p{color:#555;font-size:14px;line-height:1.5}button{font:inherit;padding:8px 14px;border-radius:6px;border:1px solid #111;background:#111;color:#fff;cursor:pointer}@media (prefers-color-scheme:dark){body{background:#0b0b0b;color:#eee}p{color:#aaa}button{background:#eee;color:#111;border-color:#eee}}</style></head><body>${body}</body></html>`;
  return new NextResponse(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

/**
 * Baja de los emails de secuencias. GET muestra una confirmación (los
 * scanners de links hacen GET: no se da de baja a nadie sin un POST).
 */
export async function GET(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const sig = req.nextUrl.searchParams.get('s') ?? '';
  const safeToken = token.replace(/[^a-f0-9]/g, '');
  const safeSig = sig.replace(/[^A-Za-z0-9_-]/g, '');
  return page(
    'Unsubscribe',
    `<h1>Unsubscribe</h1><p>Stop receiving these follow-up emails?</p><form method="post" action="/api/crm/t/u/${safeToken}?s=${safeSig}"><button type="submit">Unsubscribe</button></form>`,
  );
}

export async function POST(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const ok = await recordUnsubscribe(token, req.nextUrl.searchParams.get('s'));
  if (!ok) return page('Invalid link', '<h1>Invalid link</h1><p>This unsubscribe link is not valid.</p>', 400);
  return page('Unsubscribed', '<h1>You are unsubscribed</h1><p>You will not receive more of these emails.</p>');
}
