import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { userCanUseApp } from '@/lib/workspace';
import { fleetActorOf } from '@/lib/fleet/api';
import { loadBoard } from '@/lib/fleet/board';
import { feedCursor, listConnections } from '@/lib/fleet/core';
import { listMessages, listSessions, listTokens, markRead } from '@/lib/fleet/sessions';
import { FLEET_NAME } from '@/lib/fleet/name';
import FleetBoard from '@/components/fleet/FleetBoard';
import FleetChats from '@/components/fleet/FleetChats';
import FleetPrs from '@/components/fleet/FleetPrs';
import FleetDeploys from '@/components/fleet/FleetDeploys';
import FleetSettings from '@/components/fleet/FleetSettings';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; zs?: string[] }>; searchParams: Promise<Record<string, string | undefined>> };

const TITLE_KEY: Record<string, string> = { chats: 'nav.chats', prs: 'nav.prs', deploys: 'nav.deploys', settings: 'settings.title' };

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { locale, zs = [] } = await props.params;
  const t = await getTranslations({ locale, namespace: 'fleet' });
  return { title: `${t(TITLE_KEY[zs[0] ?? ''] ?? 'nav.now')} · ${FLEET_NAME}` };
}

const realtimeMode = () => (process.env.FLEET_REALTIME === 'poll' ? 'poll' : 'sse');

async function installUrl(): Promise<string> {
  const env = process.env.NEXT_PUBLIC_SITE_URL;
  if (env) return `${env.replace(/\/$/, '')}/api/fleet/install`;
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}/api/fleet/install`;
}

/**
 * Fleet en una sola ruta (presupuesto de rutas): /app/fleet (ahora), /app/fleet/chats(/<sesión>),
 * /app/fleet/prs, /app/fleet/deploys y /app/fleet/settings.
 */
export default async function FleetPage(props: Props) {
  const { locale, zs = [] } = await props.params;
  const sp = await props.searchParams;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  if (!userCanUseApp(user, 'fleet') || user.role === 'guest') notFound();
  const actor = fleetActorOf(user);
  const [section, id] = zs;

  switch (section) {
    case undefined:
      return <FleetBoard initial={await loadBoard(actor)} realtimeMode={realtimeMode()} />;
    case 'prs':
      return <FleetPrs initial={await loadBoard(actor)} realtimeMode={realtimeMode()} initialChecks={sp.checks ?? ''} />;
    case 'deploys':
      return <FleetDeploys initial={await loadBoard(actor)} realtimeMode={realtimeMode()} />;
    case 'chats': {
      const cursor = await feedCursor(actor);
      if (id) await markRead(actor, id);
      const [sessions, archived, messages] = await Promise.all([listSessions(actor), listSessions(actor, { archived: true }), id ? listMessages(actor, id) : Promise.resolve(null)]);
      return <FleetChats sessions={sessions} archived={archived} activeId={id ?? null} initialMessages={messages} cursor={cursor} realtimeMode={realtimeMode()} />;
    }
    case 'settings': {
      const [connections, tokens, url] = await Promise.all([listConnections(actor), listTokens(actor), installUrl()]);
      return <FleetSettings connections={connections} tokens={tokens} installUrl={url} />;
    }
    default:
      notFound();
  }
}
