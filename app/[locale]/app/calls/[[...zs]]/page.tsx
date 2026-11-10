import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { userCanUseApp } from '@/lib/workspace';
import { sessionScope } from '@/lib/crm-visibility';
import { callsActorOf } from '@/lib/calls/actor';
import { getCallDetail, listCalls, listReps } from '@/lib/calls/core';
import { dealsOverview, searchDeals } from '@/lib/calls/crm';
import { getAutoJoin, getSettings } from '@/lib/calls/settings';
import { botConfigured } from '@/lib/calls/bot';
import { callsStorageConfigured } from '@/lib/calls/files';
import { CallsError } from '@/lib/calls/types';
import CallsLibrary from '@/components/calls/CallsLibrary';
import { durationRange } from '@/lib/calls/filters';
import CallView from '@/components/calls/CallView';
import CallsUpcoming from '@/components/calls/CallsUpcoming';
import CallsDeals from '@/components/calls/CallsDeals';
import CallsAsk from '@/components/calls/CallsAsk';
import CallsSettings from '@/components/calls/CallsSettings';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; zs?: string[] }>; searchParams: Promise<Record<string, string | undefined>> };

const TITLE_KEY: Record<string, string> = { upcoming: 'nav.upcoming', deals: 'nav.deals', ask: 'nav.ask', settings: 'nav.settings' };

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { locale, zs = [] } = await props.params;
  const t = await getTranslations({ locale, namespace: 'calls' });
  return { title: `${t(TITLE_KEY[zs[0] ?? ''] ?? 'nav.library')} · Calls` };
}

/**
 * Calls en una sola ruta (presupuesto de rutas): /app/calls (filtros por query),
 * /app/calls/call/<id> (?t=segundos, ?clip=), /app/calls/upcoming,
 * /app/calls/deals, /app/calls/ask y /app/calls/settings.
 */
export default async function CallsPage(props: Props) {
  const { locale, zs = [] } = await props.params;
  const sp = await props.searchParams;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  if (!userCanUseApp(user, 'calls') || user.role === 'guest') notFound();
  const actor = callsActorOf(user);
  const crmEnabled = userCanUseApp(user, 'crm');
  const [section, id] = zs;

  switch (section) {
    case undefined: {
      const scope = await sessionScope(user);
      const filters = { q: sp.q ?? '', owner: sp.owner ?? '', deal: sp.deal ?? '', from: sp.from ?? '', to: sp.to ?? '', duration: sp.duration ?? '' };
      const [items, reps, deals] = await Promise.all([
        listCalls(actor, { q: filters.q, owner: filters.owner || undefined, deal: filters.deal || undefined, from: filters.from || undefined, to: filters.to || undefined, ...durationRange(filters.duration) }, scope),
        listReps(actor),
        crmEnabled ? searchDeals(actor, scope, '') : Promise.resolve([]),
      ]);
      // El deal filtrado puede no estar entre los recientes: que siga en el selector.
      const dealOptions = filters.deal && !deals.some((d) => d.id === filters.deal) ? [...deals, ...items.filter((c) => c.deal?.id === filters.deal).slice(0, 1).map((c) => c.deal!)] : deals;
      return <CallsLibrary items={items} reps={reps} deals={dealOptions} filters={filters} botConfigured={botConfigured()} openNew={sp.new === '1'} />;
    }
    case 'call': {
      if (!id) notFound();
      try {
        const call = await getCallDetail(actor, id, await sessionScope(user));
        const tSec = sp.t && /^\d{1,6}$/.test(sp.t) ? Number(sp.t) : null;
        return <CallView initial={call} crmEnabled={crmEnabled} initialSeconds={tSec} initialClip={sp.clip ?? null} />;
      } catch (err) {
        if (err instanceof CallsError) notFound();
        throw err;
      }
    }
    case 'upcoming':
      return <CallsUpcoming />;
    case 'deals':
      return <CallsDeals deals={crmEnabled ? await dealsOverview(actor, await sessionScope(user)) : []} crmEnabled={crmEnabled} />;
    case 'ask': {
      const any = await listCalls(actor, { limit: 50 });
      return <CallsAsk hasCalls={any.some((c) => c.status === 'ready')} />;
    }
    case 'settings': {
      const [settings, autoJoin] = await Promise.all([getSettings(actor.ws), getAutoJoin(actor.ws, actor.person)]);
      return <CallsSettings initial={settings} autoJoin={autoJoin} admin={actor.admin} botConfigured={botConfigured()} storageConfigured={callsStorageConfigured()} />;
    }
    default:
      notFound();
  }
}
