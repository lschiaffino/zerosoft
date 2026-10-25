import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { getSettings, listPeople, listPropertyDefs } from '@/lib/groups';
import { listTickets } from '@/lib/groups-tickets';
import PageHeader from '@/components/ui/PageHeader';
import TicketsBoard from '@/components/groups/TicketsBoard';

export const dynamic = 'force-dynamic';

export default async function GroupsTicketsPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<{ open?: string }> }) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'groups' });
  const [tickets, people, settings, fields] = await Promise.all([
    listTickets(user.id, { status: sp.open ? 'all' : 'active' }),
    listPeople(user.id, user.team?.id ?? null),
    getSettings(user.id),
    listPropertyDefs(user.id, 'ticket'),
  ]);
  return (
    <div className="ui-page">
      <PageHeader title={t('tickets.pageTitle')} description={t('tickets.desc', { emoji: settings.ticketEmoji || '🎫' })} />
      <TicketsBoard initial={tickets} people={people} me={user.actingUser?.id ?? user.id} openId={sp.open ?? null} fields={fields} />
    </div>
  );
}
