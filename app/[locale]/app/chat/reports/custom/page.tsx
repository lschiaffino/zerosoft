import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { listAccessibleChatWidgets } from '@/lib/chat-access';
import PageHeader from '@/components/ui/PageHeader';
import CustomReportsClient from '@/components/chat/CustomReportsClient';

export const dynamic = 'force-dynamic';

export default async function ChatCustomReportsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'chat' });
  const widgets = await listAccessibleChatWidgets(user);
  return (
    <div className="ui-page">
      <PageHeader back={{ href: '/app/chat/reports', label: t('sidebar.reports') }} title={t('reportsCustom.title')} description={t('reportsCustom.sub')} />
      <Suspense fallback={null}>
        <CustomReportsClient widgets={widgets.map((w) => ({ id: w.id, name: w.name }))} />
      </Suspense>
    </div>
  );
}
