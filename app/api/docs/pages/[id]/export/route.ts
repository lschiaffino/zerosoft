import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { parseBlocks, readableLinkTitles, resolveDocAccess, slugifyTitle } from '@/lib/docs';
import { pageLinkHref, resolveBlocksPageLinks } from '@/lib/docs-page-links';
import { blocksToMarkdown } from '@/lib/docs-markdown';
import { docsFileHref } from '@/lib/docs-files';
import { docsError, notFound, unauthorized } from '@/lib/docs-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Export de una página: ?format=md (Markdown). El PDF se hace con el diálogo de impresión. */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const format = req.nextUrl.searchParams.get('format') ?? 'md';
  if (format !== 'md') return docsError(400, 'invalid_format');
  const res = await resolveDocAccess(user, id);
  if (!res) return notFound();
  // Links `[[` → links Markdown absolutos con el título actual (una página
  // renombrada no queda con el viejo). A un invitado solo se le resuelven los
  // títulos de páginas que también puede abrir; el resto queda como se insertó.
  const raw = parseBlocks(res.row.content);
  const titles = await readableLinkTitles(user, res.row, raw);
  const origin = req.nextUrl.origin;
  const blocks = resolveBlocksPageLinks(raw, (pageId) => ({
    href: `${origin}${pageLinkHref(pageId)}`,
    title: titles.get(pageId) ?? null,
  }));
  // Imágenes y archivos: links al proxy (piden sesión con acceso a la página).
  const md = blocksToMarkdown(blocks, res.row.title, {
    fileHref: (blockId) => `${origin}${docsFileHref(id, blockId)}`,
  });
  const filename = `${slugifyTitle(res.row.title) || 'page'}.md`;
  return new NextResponse(md, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}
