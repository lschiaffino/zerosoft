import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getNote, noteOwner } from '@/lib/notes';
import { slugifyTitle } from '@/lib/docs';
import { blocksToMarkdown } from '@/lib/docs-markdown';
import { resolveBlocksPageLinks } from '@/lib/docs-page-links';
import { noteFileHref, noteHref } from '@/lib/notes-types';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Export de una nota a Markdown (el mismo formato que Docs). Los links [[ ]]
 * quedan como links absolutos a la nota, con su título actual; imágenes y
 * archivos, como links al proxy (piden la sesión de la persona dueña).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const note = await getNote(noteOwner(user), id);
  if (!note) return jsonError(404, 'not_found');
  const origin = req.nextUrl.origin;
  // getNote ya resolvió los links con href relativo: se hacen absolutos.
  const blocks = resolveBlocksPageLinks(note.content, (noteId) => ({ href: `${origin}${noteHref(noteId)}` }));
  const md = blocksToMarkdown(blocks, note.title, {
    fileHref: (blockId) => `${origin}${noteFileHref(id, blockId)}`,
  });
  const tags = note.tags.length ? `\n${note.tags.map((t) => `#${t}`).join(' ')}\n` : '';
  const filename = `${slugifyTitle(note.title) || 'note'}.md`;
  return new NextResponse(md + tags, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}
