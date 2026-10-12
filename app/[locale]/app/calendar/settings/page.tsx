import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { isWorkspaceAdmin, requireUser } from '@/lib/session';
import { getOrCreateCalendarUser } from '@/lib/calendar';
import CalendarSettingsForm from '@/components/calendar/CalendarSettingsForm';

export const dynamic = 'force-dynamic';

export default async function CalendarSettingsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'calendar' });
  const config = await getOrCreateCalendarUser(user.id);
  const h = await headers();
  const origin = (process.env.NEXTAUTH_URL ?? `https://${h.get('host') ?? 'zerosoft.ai'}`).replace(/\/$/, '');

  return (
    <div className="app-page">
      <h1 className="app-title">{t('settings.title')}</h1>
      <CalendarSettingsForm
        origin={origin}
        locale={locale}
        canEditHandle={isWorkspaceAdmin(user)}
        initial={{
          handle: user.handle ?? '',
          timezone: config.timezone,
          weekStart: config.week_start,
          bufferBeforeMin: config.buffer_before_min,
          bufferAfterMin: config.buffer_after_min,
          minNoticeHours: config.min_notice_hours,
          maxBookingDays: config.max_booking_days,
        }}
      />
    </div>
  );
}
