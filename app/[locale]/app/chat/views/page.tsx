import { getTranslations } from 'next-intl/server';
import { realUserId, requireUser } from '@/lib/session';
import { listChatAgents } from '@/lib/chat-data';
import { listChatTeams } from '@/lib/chat-collab';
import PageHeader from '@/components/ui/PageHeader';
import ViewsClient from '@/components/chat/ViewsClient';

export const dynamic = 'force-dynamic';

/** Vistas guardadas de la bandeja: renombrar, compartir y borrar. */
export default async function ChatViewsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'chat' });
  const agents = await listChatAgents(user.id, user.team?.id ?? null);
  const teams = (await listChatTeams(user.id)).map((x) => ({ id: x.id, name: x.name }));
  return (
    <div className="ui-page">
      <PageHeader title={t('views.pageTitle')} description={t('views.sub')} />
      <ViewsClient me={realUserId(user)} agents={agents} teams={teams} />
    </div>
  );
}
