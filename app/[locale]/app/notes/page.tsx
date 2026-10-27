import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { pathWithQuery } from '@/lib/return-path';
import { aiEnabled } from '@/lib/ai';
import { listNotebooks, listNotes, listTags, noteOwner } from '@/lib/notes';
import { getNoteForViewer, listSharedWithMe } from '@/lib/notes-shares';
import { listNoteTemplates, listSavedSearches } from '@/lib/notes-library';
import NotesApp from '@/components/notes/NotesApp';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'notes' });
  return { title: t('meta.title') };
}

export default async function NotesPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ note?: string; new?: string; view?: string; search?: string; q?: string; template?: string }>;
}) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  setRequestLocale(locale);
  // Un link ?note=<id> abierto sin sesión vuelve a esa nota después del login.
  const user = await requireUser(locale, pathWithQuery(`/${locale}/app/notes`, sp));
  const owner = noteOwner(user);
  // ?view=shared (aviso de una libreta compartida) abre "Compartidas conmigo".
  const shared = sp.view === 'shared';
  const [notebooks, tags, note, searches] = await Promise.all([
    listNotebooks(owner),
    listTags(owner),
    // Propia o compartida conmigo (link de un aviso).
    sp.note ? getNoteForViewer(owner, String(sp.note)) : Promise.resolve(null),
    listSavedSearches(owner),
  ]);
  // ?search=<id> (⌘K) abre una búsqueda guardada; ?q= una búsqueda suelta.
  const savedSearch = sp.search ? (searches.find((s) => s.id === sp.search) ?? null) : null;
  const initialQuery = (savedSearch?.query ?? (typeof sp.q === 'string' ? sp.q : '')).slice(0, 200);
  const notes = shared
    ? await listSharedWithMe(owner)
    : await listNotes(owner, { view: 'all', sort: 'updated', q: initialQuery || null });
  // ?template=<id> (⌘K) crea una nota desde una plantilla propia.
  const template = sp.template ? ((await listNoteTemplates(owner)).find((x) => x.id === sp.template) ?? null) : null;

  return (
    <NotesApp
      locale={locale}
      aiEnabled={aiEnabled()}
      initialNotes={notes}
      initialNotebooks={notebooks}
      initialTags={tags}
      initialNote={note}
      initialFilter={shared ? { kind: 'shared' } : undefined}
      initialSearches={searches}
      initialQuery={initialQuery}
      initialSearchId={savedSearch?.id ?? null}
      initialTemplate={template ? { title: template.title, content: template.content } : null}
      offlineOwner={{ userId: owner.personId, ws: owner.workspaceId }}
      startNew={sp.new === '1'}
      serverNow={Date.now()}
    />
  );
}
