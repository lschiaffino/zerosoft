import { getTranslations } from 'next-intl/server';
import { isWorkspaceAdmin, requireUser } from '@/lib/session';
import { listAccessibleChatWidgets } from '@/lib/chat-access';
import PageHeader from '@/components/ui/PageHeader';
import ImportClient from '@/components/chat/ImportClient';

export const dynamic = 'force-dynamic';

export default async function ChatImportPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'chat' });
  const widgets = await listAccessibleChatWidgets(user);
  return (
    <div className="ui-page">
      <PageHeader back={{ href: '/app/chat/reports', label: t('sidebar.reports') }} title={t('importer.title')} description={t('importer.sub')} />
      <ImportClient widgets={widgets.map((w) => ({ id: w.id, name: w.name }))} canManage={isWorkspaceAdmin(user)} />
    </div>
  );
}
