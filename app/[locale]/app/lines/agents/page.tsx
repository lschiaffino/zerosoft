import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { userCanUseApp } from '@/lib/workspace';
import { fleetActorOf } from '@/lib/fleet/api';
import { feedCursor } from '@/lib/fleet/core';
import { listMessages, listSessions, markRead } from '@/lib/fleet/sessions';
import FleetChats from '@/components/fleet/FleetChats';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | undefined>> };

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'fleet' });
  return { title: `${t('mirror.row')} · Lines` };
}

/** /app/lines/agents(?s=<sesión>): los chats con los agentes de Fleet, con la cara de WhatsApp de Lines. */
export default async function LinesAgentsPage(props: Props) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  if (!userCanUseApp(user, 'fleet') || !userCanUseApp(user, 'groups') || user.role === 'guest') notFound();
  const actor = fleetActorOf(user);
  const id = typeof sp.s === 'string' && /^[0-9a-f-]{36}$/.test(sp.s) ? sp.s : null;
  const cursor = await feedCursor(actor);
  const [sessions, archived, messages] = await Promise.all([listSessions(actor), listSessions(actor, { archived: true }), id ? listMessages(actor, id).catch(() => null) : Promise.resolve(null)]);
  if (id && !messages) notFound();
  if (id) await markRead(actor, id);
  return (
    <div className="flt-embed">
      <FleetChats
        sessions={sessions}
        archived={archived}
        activeId={id}
        initialMessages={messages}
        cursor={cursor}
        base="/app/lines/agents"
        linkMode="query"
        realtimeMode={process.env.FLEET_REALTIME === 'poll' ? 'poll' : 'sse'}
      />
    </div>
  );
}
