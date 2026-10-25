import { NextResponse } from 'next/server';
import { getUnifiedChangelog } from '@/lib/changelog';
import { pick } from '@/content/changelog';

export const dynamic = 'force-dynamic';

/** Últimas entradas del changelog (repo + base) para "Novedades" del launcher. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const locale = url.searchParams.get('locale') ?? 'en';
  const entries = (await getUnifiedChangelog()).slice(0, 6).map((e) => ({
    id: e.id,
    date: e.date,
    title: pick(e.title, locale),
    products: e.products,
  }));
  return NextResponse.json({ entries }, { headers: { 'cache-control': 'public, max-age=60', 'cdn-cache-control': 'public, s-maxage=300, stale-while-revalidate=600' } });
}
