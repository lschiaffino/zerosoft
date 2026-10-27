import { NextRequest, NextResponse } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { getCurrentUser } from '@/lib/session';
import { getNote, listNotebooks, listNotes, noteOwner } from '@/lib/notes';
import { slugifyTitle } from '@/lib/docs';
import { resolveBlocksPageLinks } from '@/lib/docs-page-links';
import { enexStream } from '@/lib/notes-export-files';
import { noteHref, type NoteDetail } from '@/lib/notes-types';
import { jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const LOCALES = ['en', 'es', 'pt'];
const MAX_NOTES = 2000;

/**
 * Export de muchas notas a un .enex (lo importan Evernote, Apple Notes,
 * Bear, Joplin u Obsidian): ?notebook=<id> (una libreta), ?ids=a,b,c (una
 * selección) o nada (todas, sin la papelera). Solo notas propias.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const owner = noteOwner(user);
  // Exportar todo lee muchos archivos: pocas veces por minuto alcanza.
  const limited = await limitWrites('notes:export', owner.personId, 20);
  if (limited) return limited;
  const sp = req.nextUrl.searchParams;
  const localeParam = sp.get('locale') ?? 'en';
  const locale = LOCALES.includes(localeParam) ? localeParam : 'en';
  const t = await getTranslations({ locale, namespace: 'notes' });
  const notebookId = sp.get('notebook');
  const ids = (sp.get('ids') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 500);

  let name = t('export.allFile');
  let wanted: string[];
  if (ids.length) {
    wanted = ids;
    name = t('export.selectionFile');
  } else {
    if (notebookId) {
      const nb = (await listNotebooks(owner)).find((n) => n.id === notebookId);
      if (!nb) return jsonError(404, 'not_found');
      name = nb.name;
    }
    wanted = (await listNotes(owner, { view: 'all', notebookId, sort: 'updated', limit: MAX_NOTES })).map((n) => n.id);
  }
  const origin = req.nextUrl.origin;
  async function* notes(): AsyncGenerator<NoteDetail> {
    for (const id of wanted) {
      const note = await getNote(owner, id);
      if (!note) continue;
      yield { ...note, content: resolveBlocksPageLinks(note.content, (noteId) => ({ href: `${origin}${noteHref(noteId)}` })) };
    }
  }
  const filename = `${slugifyTitle(name) || 'notes'}.enex`;
  return new NextResponse(enexStream(notes(), { origin, lockedText: t('lock.exportedLocked') }), {
    headers: {
      'content-type': 'application/enex+xml; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}
