import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { getSettings, listPeople, listPropertyDefs } from '@/lib/groups';
import { listTickets } from '@/lib/groups-tickets';
import { ticketsForViewer } from '@/lib/groups-access';
import { pageViewer } from '@/lib/groups-page';
import { getDb } from '@/lib/db';
import PageHeader from '@/components/ui/PageHeader';
import TicketsBoard from '@/components/groups/TicketsBoard';

export const dynamic = 'force-dynamic';

export default async function GroupsTicketsPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<{ open?: string }> }) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'groups' });
  const [tickets, people, settings, fields] = await Promise.all([
    listTickets(user.id, { status: sp.open ? 'all' : 'active' }).then(async (list) => ticketsForViewer(await pageViewer(user), list)),
    listPeople(user.id),
    getSettings(user.id),
    listPropertyDefs(user.id, 'ticket'),
  ]);
  // Tickets vinculados en Freshdesk o Zoho Desk (integraciones).
  const links = (await getDb()
    .prepare(
      "SELECT l.ticket_id, l.kind, l.remote_id, l.remote_url FROM groups_ticket_links l JOIN groups_tickets t ON t.id = l.ticket_id WHERE t.user_id = ? AND l.remote_id != ''",
    )
    .all(user.id)) as Array<{ ticket_id: string; kind: string; remote_id: string; remote_url: string }>;
  const remote: Record<string, Array<{ kind: string; remoteId: string; remoteUrl: string }>> = {};
  for (const l of links) (remote[l.ticket_id] ??= []).push({ kind: l.kind, remoteId: l.remote_id, remoteUrl: l.remote_url });
  return (
    <div className="ui-page">
      <PageHeader title={t('tickets.pageTitle')} description={t('tickets.desc', { emoji: settings.ticketEmoji || '🎫' })} />
      <TicketsBoard initial={tickets} people={people} me={user.actingUser?.id ?? user.id} openId={sp.open ?? null} fields={fields} remote={remote} />
    </div>
  );
}
