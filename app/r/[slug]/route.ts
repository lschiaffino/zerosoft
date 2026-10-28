import { after, NextRequest, NextResponse } from 'next/server';
import { emitEvent } from '@/lib/events';
import {
  gateCookieName,
  gateRefCookieName,
  getLinkForHost,
  isExpired,
  isValidGateToken,
  linkShortUrl,
  parseTags,
} from '@/lib/links';
import { isAppHost } from '@/lib/hosts';
import { getVerifiedDomainByHost } from '@/lib/link-domains';
import { contextFromHeaders, isBotRequest, recordClick } from '@/lib/track';
import { hasCustomPreview, linkPreviewHtml } from '@/lib/link-preview';
import {
  cloakHtml,
  deepLinkHtml,
  newVisitorId,
  parseTargeting,
  resolveDestination,
  VISITOR_COOKIE,
} from '@/lib/link-targeting';
import { requestLocale } from '@/lib/request-locale';
import { forwardQueryParams, gateQueryString } from '@/lib/link-url';
import { newClickId, withClickId } from '@/lib/link-click-id';
import { clientIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function localeFrom(req: NextRequest): string {
  return requestLocale(req.cookies.get('NEXT_LOCALE')?.value, req.headers.get('accept-language'));
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
  const host = req.headers.get('host');

  // Link vencido, sin clicks o inexistente: el fallback del link, después el
  // del dominio propio, y si no hay ninguno la página /gone de zerosoft.
  const gone = async (reason: 'notfound' | 'expired' | 'limit', linkFallback?: string | null) => {
    let target = linkFallback || null;
    if (!target && !isAppHost(host)) {
      const domain = await getVerifiedDomainByHost(host ?? '');
      target = (reason === 'notfound' ? domain?.not_found_url : domain?.expired_url) || null;
    }
    const res = NextResponse.redirect(target ?? new URL(`/${locale}/gone?reason=${reason}`, origin), 302);
    res.headers.set('cache-control', 'no-store');
    return res;
  };

  // Raíz de un dominio propio: su redirect configurado, o la home de zerosoft.
  if (slug === '__root' && !isAppHost(host)) {
    const domain = await getVerifiedDomainByHost(host ?? '');
    return NextResponse.redirect(domain?.root_url || 'https://zerosoft.ai', 302);
  }

  const link = await getLinkForHost(host, slug);
  if (!link || link.archived === 1) return gone('notfound');
  if (isExpired(link)) return gone('expired', link.expired_url);
  if (link.max_clicks !== null && link.clicks >= link.max_clicks) return gone('limit', link.expired_url);
  // Destino reportado como phishing o malware: aviso, nunca el redirect (tampoco a los bots).
  if (link.safety === 'blocked') {
    const res = NextResponse.redirect(new URL(`/${locale}/gone?reason=blocked`, origin), 302);
    res.headers.set('cache-control', 'no-store');
    return res;
  }

  // Los params del link corto (?utm_source=mail) viajan al destino, salvo que el link lo apague.
  const incoming = req.nextUrl.searchParams;
  const withParams = (url: string) => (link.forward_params === 0 ? url : forwardQueryParams(url, incoming));

  const source = req.nextUrl.searchParams.get('qr') === '1' ? 'qr' : 'link';

  if (link.password_hash) {
    const token = req.cookies.get(gateCookieName(slug))?.value;
    if (!isValidGateToken(slug, link.password_hash, token)) {
      // Todos los params viajan por la puerta y vuelven a /<slug>: ?qr=1 cuenta
      // el escaneo al desbloquear y los demás (utm_*) se reenvían al destino.
      const toGate = NextResponse.redirect(new URL(`/${locale}/gate/${slug}${gateQueryString(incoming)}`, origin));
      // Al volver de la puerta el Referer es la puerta: se guarda el origen real de la visita.
      toGate.cookies.set(gateRefCookieName(slug), contextFromHeaders(req.headers).referrer, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 60 * 30,
        path: '/',
      });
      return toGate;
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
    return NextResponse.redirect(withParams(link.url), 302);
  }

  const ctx = contextFromHeaders(req.headers);
  // Link con contraseña que vuelve de la puerta (Referer propio): el referrer real es el de antes de la puerta.
  const savedRef = link.password_hash ? req.cookies.get(gateRefCookieName(slug))?.value : undefined;
  if (savedRef !== undefined && /^[a-z0-9.-]{1,253}$/i.test(savedRef)) {
    const bareHost = (host ?? '').toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '');
    if (ctx.referrer === bareHost || isAppHost(ctx.referrer)) {
      ctx.referrer = savedRef;
      // De la visita original solo se guardó el host: la URL sería la de la puerta.
      ctx.referrerUrl = null;
    }
  }

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
  // Conversiones: un click id aleatorio por visita (sin cookies nuestras) que viaja al destino.
  const clickId = link.track_conversion === 1 ? newClickId() : null;
  const finalUrl = (url: string) => (clickId ? withClickId(withParams(url), clickId) : withParams(url));

  // Incremento atómico: si otra request se llevó el último click, no hay redirect.
  const clicks = await recordClick(link.id, ctx, { source, variant: dest.variant, clickId });
  if (clicks === null) return gone('limit', link.expired_url);
  // El webhook sale después de responder: el redirect no espera a nadie.
  after(() =>
    emitEvent(
      link.user_id,
      'link.clicked',
      {
        link: {
          id: link.id,
          slug: link.slug,
          domain: link.domain_hostname ?? null,
          url: link.url,
          short_url: linkShortUrl(link),
          tags: parseTags(link.tags),
        },
        click: { ...ctx, at: new Date().toISOString() },
      },
      // Solo para Flow (el webhook no cambia): total de clicks con este, el
      // que devolvió el UPDATE atómico (no el leído antes, que se pisa entre visitas).
      { extra: { clicks } },
    ),
  );
  // Deep linking diferido: si la visita fue a la app (iOS/Android), la app recién
  // instalada la puede reclamar en /api/v1/links/track/open (hash de IP, 1 hora).
  if (dest.variant === 'app:ios' || dest.variant === 'app:android') {
    const ip = clientIp(req);
    const platform = dest.variant === 'app:ios' ? 'ios' : 'android';
    after(async () => {
      const { recordDeferredClick } = await import('@/lib/link-deferred');
      await recordDeferredClick({ ip, platform, linkId: link.id, clickId });
    });
  }

  const html = (body: string, extra: Record<string, string> = {}) =>
    new NextResponse(body, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...extra } });
  const res =
    dest.kind === 'deeplink'
      ? html(deepLinkHtml(clickId ? withClickId(dest.appUrl, clickId) : dest.appUrl, finalUrl(dest.fallbackUrl)))
      : link.cloak === 1 && !isAppHost(host)
        ? // Cloaking: la URL corta queda en la barra; nuestra página no se deja enmarcar.
          html(cloakHtml(finalUrl(dest.url), link.og_title || link.title || dest.url.replace(/^https?:\/\//, '').replace(/[?#].*$/, '')), {
            'x-frame-options': 'DENY',
            'content-security-policy': "frame-ancestors 'none'",
            'referrer-policy': 'strict-origin-when-cross-origin',
          })
        : NextResponse.redirect(finalUrl(dest.url), targeting ? 302 : link.redirect_type === 301 ? 301 : 302);
  // Sin esto el navegador cachea el 301 para siempre: archivar, vencer,
  // max_clicks, cambiar el destino y contar el click dejarían de aplicar.
  res.headers.set('cache-control', 'no-store');
  if (savedRef !== undefined) res.cookies.delete({ name: gateRefCookieName(slug), path: '/' });
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
