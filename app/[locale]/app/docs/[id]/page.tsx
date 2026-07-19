import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { getDocPage, getDocPageAncestors, listDocPages, listDocShares } from '@/lib/docs';
import { createDocPageAction, moveDocPageAction } from '@/lib/docs-actions';
import DocsSidebar from '@/components/docs/DocsSidebar';
import DocsEditorClient from '@/components/docs/DocsEditorClient';

export const dynamic = 'force-dynamic';

export default async function DocsPageEditor({
  params: { locale, id },
}: {
  params: { locale: string; id: string };
}) {
  setRequestLocale(locale);
  const user = await requireUser(locale);
  const page = await getDocPage(user.id, id);
  if (!page) notFound();
  const allPages = await listDocPages(user.id, { archived: false });
  const ancestors = await getDocPageAncestors(user.id, id);
  const shares = await listDocShares(id);
  const t = await getTranslations({ locale, namespace: 'docs' });

  return (
    <div className="docs-layout">
      <DocsSidebar
        pages={allPages}
        currentId={id}
        createAction={createDocPageAction.bind(null, user.id, locale)}
        moveAction={moveDocPageAction.bind(null, user.id)}
        labels={{
          newPage: t('sidebar.newPage'),
          newSubpage: t('sidebar.newSubpage'),
          empty: t('sidebar.empty'),
        }}
      />
      <div className="docs-main">
        <DocsEditorClient page={page} ancestors={ancestors} shares={shares} />
      </div>
    </div>
  );
}
