import { after, NextRequest, NextResponse } from 'next/server';
import { emitEvent } from '@/lib/events';
import { gateCookieName, getLinkForHost, isExpired, isValidGateToken } from '@/lib/links';
import { isAppHost } from '@/lib/hosts';
import { getVerifiedDomainByHost } from '@/lib/link-domains';
import { contextFromHeaders, recordClick } from '@/lib/track';
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

  if (link.password_hash) {
    const token = req.cookies.get(gateCookieName(slug))?.value;
    if (!isValidGateToken(slug, link.password_hash, token)) {
      return NextResponse.redirect(new URL(`/${locale}/gate/${slug}`, origin));
    }
  }

  const ctx = contextFromHeaders(req.headers);
  const source = req.nextUrl.searchParams.get('qr') === '1' ? 'qr' : 'link';

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

  await recordClick(link.id, ctx, { source, variant: dest.variant });
  // El webhook sale después de responder: el redirect no espera a nadie.
  after(() =>
    emitEvent(
      link.user_id,
      'link.clicked',
      {
        link: { id: link.id, slug: link.slug, domain: link.domain_hostname ?? null, url: link.url },
        click: { ...ctx, at: new Date().toISOString() },
      },
      // Solo para Flow (el webhook no cambia): total de clicks con este.
      { extra: { clicks: link.clicks + 1 } },
    ),
  );

  const res =
    dest.kind === 'deeplink'
      ? new NextResponse(deepLinkHtml(dest.appUrl, dest.fallbackUrl), {
          headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
        })
      : NextResponse.redirect(dest.url, targeting ? 302 : link.redirect_type === 301 ? 301 : 302);
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
