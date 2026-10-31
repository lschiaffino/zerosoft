import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { isWorkspaceAdmin, requireUser } from '@/lib/session';
import { listAccessibleChatWidgets } from '@/lib/chat-access';
import { listCompanies } from '@/lib/chat-companies';
import PageHeader from '@/components/ui/PageHeader';
import CampaignsClient from '@/components/chat/CampaignsClient';

export const dynamic = 'force-dynamic';

export default async function ChatCampaignsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'chat' });
  const [widgets, companies] = await Promise.all([listAccessibleChatWidgets(user), listCompanies(user.id)]);
  return (
    <div className="ui-page">
      <PageHeader title={t('campaigns.title')} description={t('campaigns.sub')} />
      <Suspense fallback={null}>
        <CampaignsClient
          widgets={widgets.map((w) => ({ id: w.id, name: w.name }))}
          companies={companies.map((c) => ({ id: c.id, name: c.name }))}
          canManage={isWorkspaceAdmin(user) && widgets.length > 0}
        />
      </Suspense>
    </div>
  );
}
