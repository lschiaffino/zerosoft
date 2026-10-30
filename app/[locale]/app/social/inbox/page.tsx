import { getTranslations } from 'next-intl/server';
import PageHeader from '@/components/ui/PageHeader';
import InboxView from '@/components/social/InboxView';
import { requireUser } from '@/lib/session';
import { listAccounts, listSocialPeople, socialActor } from '@/lib/social';
import { listInbox, type InboxFilter } from '@/lib/social-inbox';
import { NETWORK_SPECS } from '@/lib/social-networks';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'social' });
  return { title: t('inbox.title') };
}

type Search = { status?: string; kind?: string; account?: string; assigned?: string; item?: string };

/** Bandeja unificada de las cuentas que la persona ve. */
export default async function SocialInboxPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<Search> }) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'social' });
  const actor = socialActor(user);
  const filter: InboxFilter = {
    status: sp.status === 'done' || sp.status === 'all' ? sp.status : 'open',
    kind: sp.kind === 'comment' || sp.kind === 'mention' || sp.kind === 'dm' ? sp.kind : undefined,
    accountId: sp.account || undefined,
    assigned: sp.assigned === 'me' || sp.assigned === 'none' ? sp.assigned : undefined,
  };
  const [accounts, people] = await Promise.all([listAccounts(actor), listSocialPeople(actor)]);
  let items = await listInbox(actor, filter);
  // Un ítem abierto por link (aviso de asignación) aparece aunque ya esté hecho.
  if (sp.item && !items.some((i) => i.id === sp.item)) {
    const extra = (await listInbox(actor, { status: 'all' })).find((i) => i.id === sp.item);
    if (extra) items = [extra, ...items];
  }
  // Qué redes no traen bandeja por API (se dice en la página).
  const noInbox = [...new Set(accounts.filter((a) => NETWORK_SPECS[a.network].inbox.length === 0).map((a) => a.networkName))];
  return (
    <div className="ui-page">
      <PageHeader title={t('inbox.title')} description={t('inbox.description')} />
      {noInbox.length > 0 && <p className="sc-muted sc-small">{t('inbox.noApi', { networks: noInbox.join(', ') })}</p>}
      <InboxView
        items={items}
        accounts={accounts}
        people={people.map((p) => ({ id: p.id, name: p.name }))}
        me={actor.personId}
        filters={{ status: filter.status ?? 'open', kind: filter.kind ?? '', account: filter.accountId ?? '', assigned: filter.assigned ?? '' }}
      />
    </div>
  );
}
