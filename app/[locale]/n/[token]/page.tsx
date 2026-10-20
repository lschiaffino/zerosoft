import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { getSharedNote } from '@/lib/notes';
import NoteBlocksView from '@/components/notes/NoteBlocksView';
import { noteFileHref } from '@/lib/notes-types';
import '@/styles/notes.css';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; token: string }> };

export async function generateMetadata(props: Props) {
  const { locale, token } = await props.params;
  const note = await getSharedNote(token);
  const t = await getTranslations({ locale, namespace: 'notes' });
  return {
    title: note ? note.title || t('untitled') : t('public.notFound'),
    robots: { index: false, follow: false },
  };
}

/** Nota compartida por link: solo lectura, sin login. */
export default async function SharedNotePage(props: Props) {
  const { locale, token } = await props.params;
  setRequestLocale(locale);
  const note = await getSharedNote(token);
  if (!note) notFound();
  const t = await getTranslations({ locale, namespace: 'notes' });
  const format = await getFormatter({ locale });
  return (
    <main className="note-public">
      <article>
        <p className="note-public-meta mono">
          {t('public.updated', { date: format.dateTime(new Date(note.updated_at), { dateStyle: 'medium' }) })}
        </p>
        <h1 className="note-view-title">{note.title || t('untitled')}</h1>
        {note.source_url && (
          <p className="note-source">
            {t('editor.source')}{' '}
            <a href={note.source_url} target="_blank" rel="noopener noreferrer nofollow">
              {note.source_url.replace(/^https?:\/\//, '').slice(0, 80)}
            </a>
          </p>
        )}
        <NoteBlocksView
          blocks={note.content}
          fileHref={(blockId, opts) => noteFileHref(note.id, blockId, { ...opts, share: token })}
        />
      </article>
    </main>
  );
}
