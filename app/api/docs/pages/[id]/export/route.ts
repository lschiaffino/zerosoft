import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { parseBlocks, resolveDocAccess, slugifyTitle } from '@/lib/docs';
import { blocksToMarkdown } from '@/lib/docs-markdown';
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
  const md = blocksToMarkdown(parseBlocks(res.row.content), res.row.title);
  const filename = `${slugifyTitle(res.row.title) || 'page'}.md`;
  return new NextResponse(md, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}
