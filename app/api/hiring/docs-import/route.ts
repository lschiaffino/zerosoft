import { NextRequest } from 'next/server';
import { userCanUseApp } from '@/lib/workspace';
import { docsActorFor } from '@/lib/docs-platform-access';
import { getPage, searchPages } from '@/lib/docs-platform';
import { hiringActor, hJson } from '@/lib/hiring/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Descripción de puesto desde una página de Docs (con los permisos de Docs de
 * la persona). GET ?q= busca páginas; GET ?pageId= devuelve su texto en markdown.
 */
export async function GET(req: NextRequest) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  if (!userCanUseApp(a.user, 'docs')) return hJson({ error: 'docs_unavailable' }, 403);
  const docs = await docsActorFor(a.actor.ws, a.actor.person);
  if (!docs) return hJson({ error: 'docs_unavailable' }, 403);
  const sp = req.nextUrl.searchParams;
  const pageId = sp.get('pageId');
  if (pageId) {
    try {
      const page = await getPage(docs, pageId.slice(0, 80));
      return hJson({ title: page.title, markdown: page.markdown.slice(0, 20_000) });
    } catch {
      return hJson({ error: 'not_found' }, 404);
    }
  }
  const hits = await searchPages(docs, (sp.get('q') ?? '').slice(0, 100), 10).catch(() => []);
  return hJson({ pages: hits.map((h) => ({ id: h.page.id, title: h.page.title })) });
}
