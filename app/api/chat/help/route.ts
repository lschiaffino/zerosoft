import { NextResponse } from 'next/server';
import { limitByIp } from '@/lib/rate-limit';
import { getChatWidget } from '@/lib/chat-data';
import { getDb } from '@/lib/db';
import { listHelpCollections, searchHelpArticles, type HelpArticleSummary } from '@/lib/docs-help';

export const dynamic = 'force-dynamic';

/**
 * Pestaña "Ayuda" del widget (pública, cross-origin): artículos publicados
 * del workspace dueño del widget. Sin `q` devuelve los primeros artículos;
 * con `q` busca (BM25, lib/docs-help.ts). Solo si el widget tiene la ayuda
 * activada; nunca expone páginas sin publicar.
 */
export async function GET(req: Request) {
  const limited = await limitByIp(req, 'chat-help', 120, 60);
  if (limited) return limited;
  const url = new URL(req.url);
  const widgetId = url.searchParams.get('widgetId') ?? '';
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
  const widget = widgetId ? await getChatWidget(widgetId) : undefined;
  if (!widget || widget.help_enabled !== 1) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const owner = (await getDb().prepare('SELECT handle FROM users WHERE id = ?').get(widget.user_id)) as
    | { handle: string | null }
    | undefined;
  const base = owner?.handle ? `${url.origin}/h/${owner.handle}` : null;
  const link = (a: HelpArticleSummary) => ({
    id: a.id,
    title: a.title,
    excerpt: a.excerpt,
    url: base ? `${base}/${a.slug}` : null,
  });

  if (q) {
    const rows = await searchHelpArticles(widget.user_id, q, 5);
    return NextResponse.json({ helpCenterUrl: base, articles: rows.map(link) });
  }
  const collections = await listHelpCollections(widget.user_id);
  const flat = collections.flatMap(({ articles, ...head }) => [head, ...articles]).slice(0, 6);
  return NextResponse.json({ helpCenterUrl: base, articles: flat.map(link) });
}
