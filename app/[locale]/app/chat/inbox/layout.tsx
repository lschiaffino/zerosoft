import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { realUserId, requireUser } from '@/lib/session';
import { isChatAgentAway, listChatAgents, listChatWidgets } from '@/lib/chat-data';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import InboxShell from '@/components/chat/InboxShell';
import NewWidgetButton from '@/components/chat/NewWidgetButton';
import { listChatTeams } from '@/lib/chat-collab';
import { Suspense } from 'react';

export const dynamic = 'force-dynamic';

/**
 * La bandeja en tres columnas: lista (este layout), conversación y detalles
 * (la página hija). El layout no se vuelve a montar al cambiar de
 * conversación, así la lista conserva filtros y scroll.
 */
export default async function ChatInboxLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'chat' });
  const widgets = await listChatWidgets(user.id, user.team?.id ?? null);

  if (widgets.length === 0) {
    return (
      <div className="ui-page">
        <PageHeader title={t('inbox.title')} />
        <EmptyState
          title={t('inbox.noWidgetsTitle')}
          body={t('inbox.noWidgetsSub')}
          action={<NewWidgetButton shortcut={false} />}
          product="chat"
        />
      </div>
    );
  }

  // Los widgets del workspace comparten agentes (el dueño o los miembros del team).
  const agents = await listChatAgents(widgets[0].user_id, widgets[0].team_id);
  const away = await isChatAgentAway(realUserId(user));
  const teams = (await listChatTeams(user.id)).map((x) => ({ id: x.id, name: x.name }));

  return (
    <Suspense fallback={null}>
      <InboxShell widgetIds={widgets.map((w) => w.id)} currentUserId={realUserId(user)} agents={agents} teams={teams} initialAway={away}>
        {props.children}
      </InboxShell>
    </Suspense>
  );
}
