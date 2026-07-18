import { NextRequest, NextResponse } from 'next/server';
import { gateCookieName, getLinkBySlug, isExpired, isValidGateToken } from '@/lib/links';
import { contextFromHeaders, recordClick } from '@/lib/track';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LOCALES = new Set(['en', 'es', 'pt']);

function localeFrom(req: NextRequest): string {
  const cookie = req.cookies.get('NEXT_LOCALE')?.value;
  return cookie && LOCALES.has(cookie) ? cookie : 'en';
}

export function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const { slug } = params;
  const locale = localeFrom(req);
  const gone = (reason: string) =>
    NextResponse.redirect(new URL(`/${locale}/gone?reason=${reason}`, req.url));

  const link = getLinkBySlug(slug);
  if (!link || link.archived === 1) return gone('notfound');
  if (isExpired(link)) return gone('expired');
  if (link.max_clicks !== null && link.clicks >= link.max_clicks) return gone('limit');

  if (link.password_hash) {
    const token = req.cookies.get(gateCookieName(slug))?.value;
    if (!isValidGateToken(slug, link.password_hash, token)) {
      return NextResponse.redirect(new URL(`/${locale}/gate/${slug}`, req.url));
    }
  }

  recordClick(link.id, contextFromHeaders(req.headers));
  return NextResponse.redirect(link.url, 302);
}
