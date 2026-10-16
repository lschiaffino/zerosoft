import { getTranslations } from 'next-intl/server';
import { isWorkspaceAdmin, requireUser } from '@/lib/session';
import ImportLinksPanel from '@/components/link/ImportLinksPanel';
import NewLinkShell from '@/components/link/NewLinkShell';
import EmptyState from '@/components/ui/EmptyState';

export const dynamic = 'force-dynamic';

export default async function ImportLinksPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'link' });

  return (
    <NewLinkShell locale={locale}>
      {isWorkspaceAdmin(user) ? (
        <ImportLinksPanel />
      ) : (
        <EmptyState title={t('import.title')} body={t('errors.forbidden')} product="link" />
      )}
    </NewLinkShell>
  );
}
