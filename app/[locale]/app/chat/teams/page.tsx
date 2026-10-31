import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { isWorkspaceAdmin, requireUser } from '@/lib/session';
import { listChatAgents } from '@/lib/chat-data';
import PageHeader from '@/components/ui/PageHeader';
import TeamsClient from '@/components/chat/TeamsClient';
import RoutingClient from '@/components/chat/RoutingClient';

export const dynamic = 'force-dynamic';

/** Equipos de Chat: cada uno con su bandeja en el sidebar y reglas que le asignan conversaciones. */
export default async function ChatTeamsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'chat' });
  const agents = await listChatAgents(user.id, user.team?.id ?? null);
  return (
    <div className="ui-page">
      <PageHeader title={t('teams.pageTitle')} description={t('teams.sub')} />
      <Suspense fallback={null}>
        <TeamsClient agents={agents} canManage={isWorkspaceAdmin(user)} />
        <RoutingClient canManage={isWorkspaceAdmin(user)} />
      </Suspense>
    </div>
  );
}
