import { getTranslations } from 'next-intl/server';
import { isWorkspaceAdmin, requireUser } from '@/lib/session';
import { listFolders, viewerOf, workspacePeople } from '@/lib/link-folders';
import PageHeader from '@/components/ui/PageHeader';
import FoldersPanel from '@/components/link/FoldersPanel';

export const dynamic = 'force-dynamic';

/** Carpetas de links y quién ve o edita cada una. */
export default async function LinkFoldersPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'link' });
  const canManage = isWorkspaceAdmin(user);
  const [folders, people] = await Promise.all([
    listFolders(user.id, viewerOf(user)),
    canManage ? workspacePeople(user.id) : Promise.resolve([]),
  ]);

  return (
    <div className="ui-page ui-page-narrow link-folders">
      <PageHeader back={{ href: '/app/links', label: t('detail.back') }} title={t('folders.title')} description={t('folders.pageDesc')} />
      <FoldersPanel
        initial={folders.map((f) => ({ id: f.id, name: f.name, default_access: f.default_access, access: f.access, links: f.links }))}
        canManage={canManage}
        people={people.filter((p) => p.id !== user.id).map((p) => ({ id: p.id, name: p.name || p.email }))}
      />
    </div>
  );
}
