import { NextRequest, NextResponse } from 'next/server';
import { routing } from '@/i18n/routing';
import { asPlacement, isDesktopOs } from '@/lib/desktop-os';
import { downloadClickProps, recordDownloadClick } from '@/lib/desktop-track';
import { WHO_COOKIE } from '@/lib/session-hint';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Todos los botones de "Descargar la app" pasan por acá (lib/desktop-os.ts,
 * downloadHref): ?from=<lugar>&os=<mac-arm|mac-intel|win>&locale=<en|es|pt>.
 * Cuenta el clic en Pulse (lib/desktop-track.ts) y redirige: con sistema, a
 * /download/start (baja el instalador y muestra los pasos); sin sistema
 * (emails, Linux), a /download. Nunca a otro origen.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const rawLocale = q.get('locale');
  const locale = (routing.locales as readonly string[]).includes(rawLocale ?? '') ? rawLocale! : routing.defaultLocale;
  const os = isDesktopOs(q.get('os')) ? (q.get('os') as 'mac-arm' | 'mac-intel' | 'win') : null;
  const placement = asPlacement(q.get('from'));

  await recordDownloadClick(
    req,
    downloadClickProps({ placement, os, locale, referer: req.headers.get('referer'), signedIn: Boolean(req.cookies.get(WHO_COOKIE)?.value) }),
  );

  const target = os ? `/${locale}/download/start?os=${os}` : `/${locale}/download`;
  return NextResponse.redirect(new URL(target, req.nextUrl.origin), { status: 303, headers: { 'cache-control': 'no-store' } });
}
