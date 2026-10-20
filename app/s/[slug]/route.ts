import { NextRequest, NextResponse } from 'next/server';
import {
  gateCookieName,
  getLinkForHost,
  isExpired,
  isValidGateToken,
} from '@/lib/links';
import { linkPreviewHtml } from '@/lib/link-preview';
import { isBotRequest } from '@/lib/track';
import { requestLocale } from '@/lib/request-locale';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function localeFrom(req: NextRequest): string {
  return requestLocale(req.cookies.get('NEXT_LOCALE')?.value, req.headers.get('accept-language'));
}

/**
 * Vista social (tarjeta OG) de un link. Es solo para crawlers y unfurlers: una
 * persona se manda a /r/<slug>, que cuenta el click, respeta max_clicks y
 * aplica la segmentación. Así /s no sirve para saltearse nada de eso.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const { slug } = params;
  const locale = localeFrom(req);

  if (!isBotRequest(req.headers, req.method)) {
    return NextResponse.redirect(new URL(`/r/${encodeURIComponent(slug)}${req.nextUrl.search}`, req.url));
  }

  const gone = (reason: string) =>
    NextResponse.redirect(new URL(`/${locale}/gone?reason=${reason}`, req.url));

  const link = await getLinkForHost(req.headers.get('host'), slug);
  if (!link || link.archived === 1) return gone('notfound');
  if (isExpired(link)) return gone('expired');
  if (link.max_clicks !== null && link.clicks >= link.max_clicks) return gone('limit');

  if (link.password_hash) {
    const token = req.cookies.get(gateCookieName(slug))?.value;
    if (!isValidGateToken(slug, link.password_hash, token)) {
      return NextResponse.redirect(new URL(`/${locale}/gate/${slug}${req.nextUrl.search}`, req.url));
    }
  }

  return new NextResponse(linkPreviewHtml(link, slug, locale), {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
