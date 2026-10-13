import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { getOrCreateCalendarUser } from '@/lib/calendar';
import { ensureDefaultSchedule, listSchedules } from '@/lib/calendar-schedules';
import SchedulesView from '@/components/calendar/SchedulesView';

export const dynamic = 'force-dynamic';

export default async function AvailabilityPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'calendar' });
  const config = await getOrCreateCalendarUser(user.id);
  await ensureDefaultSchedule(user.id, config.timezone);
  const schedules = await listSchedules(user.id);

  return (
    <div className="app-page cal-page">
      <div className="page-head">
        <h1 className="app-title">{t('schedules.title')}</h1>
      </div>
      <p className="muted cal-page-sub">{t('schedules.sub')}</p>
      <SchedulesView initial={schedules} defaultTimezone={config.timezone} />
    </div>
  );
}
