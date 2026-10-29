import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { listDesigns, listFolders, type DesignView } from '@/lib/design';
import { designActorOf } from '@/lib/design-http';
import DesignHome from '@/components/design/DesignHome';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'design' });
  return { title: t('meta.title') };
}

const VIEWS: DesignView[] = ['recent', 'mine', 'shared', 'starred', 'trash'];

/** Design: crear (tamaños), recientes, tus diseños, compartidos, favoritos, papelera y carpetas. ?new=1 abre "Crear un diseño". */
export default async function DesignHomePage(props: { params: Promise<{ locale: string }>; searchParams: Promise<{ view?: string; folder?: string; new?: string; q?: string }> }) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  const actor = designActorOf(user);
  const folders = await listFolders(actor);
  const folder = sp.folder && folders.some((f) => f.id === sp.folder) ? sp.folder : null;
  const view: DesignView = folder ? 'folder' : VIEWS.includes(sp.view as DesignView) ? (sp.view as DesignView) : 'recent';
  const designs = await listDesigns(actor, { view, folderId: folder, q: sp.q ?? '' });
  return <DesignHome key={`${view}:${folder ?? ''}`} initialDesigns={designs} initialFolders={folders} view={view} folderId={folder} startNew={sp.new === '1'} initialQ={sp.q ?? ''} />;
}
