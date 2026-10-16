import { after, NextRequest, NextResponse } from 'next/server';
import { emitEvent } from '@/lib/events';
import { gateCookieName, getLinkForHost, isExpired, isValidGateToken, linkShortUrl } from '@/lib/links';
import { isAppHost } from '@/lib/hosts';
import { getVerifiedDomainByHost } from '@/lib/link-domains';
import { contextFromHeaders, isBotRequest, recordClick } from '@/lib/track';
import { hasCustomPreview, linkPreviewHtml } from '@/lib/link-preview';
import {
  deepLinkHtml,
  newVisitorId,
  parseTargeting,
  resolveDestination,
  VISITOR_COOKIE,
} from '@/lib/link-targeting';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LOCALES = new Set(['en', 'es', 'pt']);

function localeFrom(req: NextRequest): string {
  const cookie = req.cookies.get('NEXT_LOCALE')?.value;
  return cookie && LOCALES.has(cookie) ? cookie : 'en';
}

/** Origen tal como lo pidió el cliente (incluye el dominio propio). Solo Host: x-forwarded-host lo podría falsear el cliente. */
function requestOrigin(req: NextRequest): string {
  const host = req.headers.get('host');
  if (!host) return new URL(req.url).origin;
  const proto = req.headers.get('x-forwarded-proto') ?? new URL(req.url).protocol.replace(':', '');
  return `${proto}://${host}`;
}

export async function GET(req: NextRequest, props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const { slug } = params;
  const locale = localeFrom(req);
  const origin = requestOrigin(req);
  const gone = (reason: string) =>
    NextResponse.redirect(new URL(`/${locale}/gone?reason=${reason}`, origin));

  const host = req.headers.get('host');

  // Raíz de un dominio propio: su redirect configurado, o la home de zerosoft.
  if (slug === '__root' && !isAppHost(host)) {
    const domain = await getVerifiedDomainByHost(host ?? '');
    return NextResponse.redirect(domain?.root_url || 'https://zerosoft.ai', 302);
  }

  const link = await getLinkForHost(host, slug);
  if (!link || link.archived === 1) return gone('notfound');
  if (isExpired(link)) return gone('expired');
  if (link.max_clicks !== null && link.clicks >= link.max_clicks) return gone('limit');

  const source = req.nextUrl.searchParams.get('qr') === '1' ? 'qr' : 'link';

  if (link.password_hash) {
    const token = req.cookies.get(gateCookieName(slug))?.value;
    if (!isValidGateToken(slug, link.password_hash, token)) {
      // ?qr=1 viaja por la puerta: el escaneo se cuenta como QR al desbloquear.
      return NextResponse.redirect(new URL(`/${locale}/gate/${slug}${source === 'qr' ? '?qr=1' : ''}`, origin));
    }
  }

  // Bots, unfurlers de previews (Slack, WhatsApp, iMessage) y HEAD: no son
  // visitas. No cuentan clicks ni gastan max_clicks ni disparan el webhook.
  if (isBotRequest(req.headers, req.method)) {
    if (req.method !== 'HEAD' && hasCustomPreview(link)) {
      return new NextResponse(linkPreviewHtml(link, slug, locale), {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
    return NextResponse.redirect(link.url, 302);
  }

  const ctx = contextFromHeaders(req.headers);

  // Sin segmentación: camino rápido, sin parsear nada ni cookies.
  const targeting = link.targeting ? parseTargeting(link.targeting) : null;
  let visitorId: string | null = null;
  let newVisitor = false;
  if (targeting && targeting.ab.length > 1) {
    visitorId = req.cookies.get(VISITOR_COOKIE)?.value ?? null;
    if (!visitorId || !/^[a-f0-9]{8,64}$/.test(visitorId)) {
      visitorId = newVisitorId();
      newVisitor = true;
    }
  }
  const dest = resolveDestination(link.url, targeting, ctx, `${visitorId ?? ''}:${link.id}`);

  // Incremento atómico: si otra request se llevó el último click, no hay redirect.
  const clicks = await recordClick(link.id, ctx, { source, variant: dest.variant });
  if (clicks === null) return gone('limit');
  // El webhook sale después de responder: el redirect no espera a nadie.
  after(() =>
    emitEvent(
      link.user_id,
      'link.clicked',
      {
        link: { id: link.id, slug: link.slug, domain: link.domain_hostname ?? null, url: link.url, short_url: linkShortUrl(link) },
        click: { ...ctx, at: new Date().toISOString() },
      },
      // Solo para Flow (el webhook no cambia): total de clicks con este, el
      // que devolvió el UPDATE atómico (no el leído antes, que se pisa entre visitas).
      { extra: { clicks } },
    ),
  );

  const res =
    dest.kind === 'deeplink'
      ? new NextResponse(deepLinkHtml(dest.appUrl, dest.fallbackUrl), {
          headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
        })
      : NextResponse.redirect(dest.url, targeting ? 302 : link.redirect_type === 301 ? 301 : 302);
  // Sin esto el navegador cachea el 301 para siempre: archivar, vencer,
  // max_clicks, cambiar el destino y contar el click dejarían de aplicar.
  res.headers.set('cache-control', 'no-store');
  if (newVisitor && visitorId) {
    res.cookies.set(VISITOR_COOKIE, visitorId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 365,
      path: '/',
    });
  }
  return res;
}
