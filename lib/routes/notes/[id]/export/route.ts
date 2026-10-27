import { NextRequest, NextResponse } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { getCurrentUser } from '@/lib/session';
import { getNote, noteOwner } from '@/lib/notes';
import { slugifyTitle } from '@/lib/docs';
import { blocksToMarkdown } from '@/lib/docs-markdown';
import { resolveBlocksPageLinks } from '@/lib/docs-page-links';
import { noteToHtml } from '@/lib/notes-export';
import { enexStream } from '@/lib/notes-export-files';
import { noteFileHref, noteHref } from '@/lib/notes-types';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LOCALES = ['en', 'es', 'pt'];

/**
 * Export de una nota: ?format=md (default, el mismo Markdown que Docs),
 * enex (Evernote, con los adjuntos adentro) o html (página suelta). Los
 * links [[ ]] quedan como links absolutos a la nota; imágenes y archivos,
 * como links al proxy (piden la sesión de la persona dueña). Una nota
 * bloqueada no se exporta: el texto solo se lee con la contraseña.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const note = await getNote(noteOwner(user), id);
  if (!note) return jsonError(404, 'not_found');
  if (note.locked) return jsonError(409, 'note_locked');
  const origin = req.nextUrl.origin;
  const format = req.nextUrl.searchParams.get('format') ?? 'md';
  const localeParam = req.nextUrl.searchParams.get('locale') ?? 'en';
  const locale = LOCALES.includes(localeParam) ? localeParam : 'en';
  // getNote ya resolvió los links con href relativo: se hacen absolutos.
  const blocks = resolveBlocksPageLinks(note.content, (noteId) => ({ href: `${origin}${noteHref(noteId)}` }));
  const base = slugifyTitle(note.title) || 'note';
  const fileLink = (b: { id: string }) => `${origin}${noteFileHref(id, b.id, { download: true })}`;
  const headers = (type: string, ext: string) => ({
    'content-type': type,
    'content-disposition': `attachment; filename="${base}.${ext}"`,
    'cache-control': 'no-store',
  });

  if (format === 'enex') {
    const t = await getTranslations({ locale, namespace: 'notes' });
    return new NextResponse(enexStream([{ ...note, content: blocks }], { origin, lockedText: t('lock.exportedLocked') }), {
      headers: headers('application/enex+xml; charset=utf-8', 'enex'),
    });
  }
  if (format === 'html') {
    return new NextResponse(noteToHtml({ ...note, content: blocks }, { fileLink, lang: locale }), {
      headers: headers('text/html; charset=utf-8', 'html'),
    });
  }
  const md = blocksToMarkdown(blocks, note.title, {
    fileHref: (blockId) => `${origin}${noteFileHref(id, blockId)}`,
  });
  const tags = note.tags.length ? `\n${note.tags.map((t) => `#${t}`).join(' ')}\n` : '';
  return new NextResponse(md + tags, { headers: headers('text/markdown; charset=utf-8', 'md') });
}
