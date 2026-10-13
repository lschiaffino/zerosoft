import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { aiEnabled } from '@/lib/ai';
import { getNote, listNotebooks, listNotes, listTags, noteOwner } from '@/lib/notes';
import NotesApp from '@/components/notes/NotesApp';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'notes' });
  return { title: t('meta.title') };
}

export default async function NotesPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ note?: string; new?: string }>;
}) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  const owner = noteOwner(user);
  const [notes, notebooks, tags, note] = await Promise.all([
    listNotes(owner, { view: 'all', sort: 'updated' }),
    listNotebooks(owner),
    listTags(owner),
    sp.note ? getNote(owner, String(sp.note)) : Promise.resolve(null),
  ]);

  return (
    <NotesApp
      locale={locale}
      aiEnabled={aiEnabled()}
      initialNotes={notes}
      initialNotebooks={notebooks}
      initialTags={tags}
      initialNote={note}
      startNew={sp.new === '1'}
      serverNow={Date.now()}
    />
  );
}
