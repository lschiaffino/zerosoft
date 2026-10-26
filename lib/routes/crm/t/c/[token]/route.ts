import { NextRequest, NextResponse } from 'next/server';
import { recordTrackingHit, resolveClickTarget } from '@/lib/crm-email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Click en un link de un email del CRM: /api/crm/t/c/<token>?u=<url>&s=<firma>.
 * La URL de destino va firmada (HMAC con el token): sin firma válida no hay
 * redirect, así este endpoint no sirve como open redirect.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const sp = req.nextUrl.searchParams;
  const target = resolveClickTarget(token, sp.get('u'), sp.get('s'));
  if (!target) {
    return new NextResponse('Invalid link', { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  await recordTrackingHit(token, 'click', { userAgent: req.headers.get('user-agent') ?? '', url: target }).catch(() => null);
  return NextResponse.redirect(target, { status: 302, headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}
