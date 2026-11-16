import { NextResponse } from 'next/server';
import { serverBuildId } from '@/lib/app-version';
import { newsLocale, versionNews } from '@/lib/app-version-news';
import { CHANGELOG } from '@/content/changelog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Qué versión sirve el servidor ahora; la pestaña la compara con la suya (AppUpdateBanner). Con `?locale=` suma qué
 * trae (los títulos de lo último del changelog público, en ese idioma).
 */
export async function GET(req: Request) {
  const locale = new URL(req.url).searchParams.get('locale');
  const news = locale ? versionNews(CHANGELOG, newsLocale(locale)) : null;
  return NextResponse.json({ build: serverBuildId(), ...(news ? { news } : {}) }, { headers: { 'cache-control': 'no-store' } });
}
