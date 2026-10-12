import { NextRequest, NextResponse } from 'next/server';
import { gateCookieName, getLinkForHost, isExpired, isValidGateToken } from '@/lib/links';
import { isAppHost } from '@/lib/hosts';
import { getVerifiedDomainByHost } from '@/lib/link-domains';
import { contextFromHeaders, recordClick } from '@/lib/track';

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

  await recordClick(link.id, contextFromHeaders(req.headers));
  return NextResponse.redirect(link.url, link.redirect_type === 301 ? 301 : 302);
}
