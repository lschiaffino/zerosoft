import { getTranslations } from 'next-intl/server';
import { realUserId, requireUser } from '@/lib/session';
import { getOrCreateCalendarUser, listBlockedSlots } from '@/lib/calendar';
import { ensureDefaultSchedule, listSchedules } from '@/lib/calendar-schedules';
import PageHeader from '@/components/ui/PageHeader';
import SchedulesView from '@/components/calendar/SchedulesView';
import BlockedSlotsPanel from '@/components/calendar/BlockedSlotsPanel';

export const dynamic = 'force-dynamic';

export default async function AvailabilityPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'calendar' });
  const config = await getOrCreateCalendarUser(user.id);
  await ensureDefaultSchedule(user.id, config.timezone);
  const schedules = await listSchedules(user.id);
  // Los bloqueos son de la persona (como Google Calendar), no del dueño del workspace.
  const blockedSlots = await listBlockedSlots(realUserId(user));

  return (
    <div className="ui-page">
      <PageHeader title={t('schedules.title')} description={t('schedules.sub')} />
      <SchedulesView initial={schedules} defaultTimezone={config.timezone} />
      <BlockedSlotsPanel initialSlots={blockedSlots} />
    </div>
  );
}
