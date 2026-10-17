import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { isWorkspaceAdmin, realUserId, requireUser } from '@/lib/session';
import { getIntegration, googleCalendarRedirectUri, googleOAuthConfigured } from '@/lib/integrations';
import { GOOGLE_CALENDAR_PROVIDER } from '@/lib/google-calendar';
import { getOrCreateCalendarUser } from '@/lib/calendar';
import { getPaymentSettings } from '@/lib/calendar-payments';
import PageHeader from '@/components/ui/PageHeader';
import SettingsTabs from '@/components/ui/SettingsTabs';
import GoogleCalendarPanel from '@/components/calendar/GoogleCalendarPanel';
import CalendarSettingsForm from '@/components/calendar/CalendarSettingsForm';
import PaymentsSettingsPanel from '@/components/calendar/PaymentsSettingsPanel';

export const dynamic = 'force-dynamic';

const TABS = ['profile', 'connections', 'payments'] as const;

export default async function CalendarSettingsPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ gcal?: string; tab?: string }>;
}) {
  const { locale } = await props.params;
  const { gcal, tab: rawTab } = await props.searchParams;
  // Volver de Google (?gcal=…) cae en Conexiones aunque no venga la pestaña.
  if (gcal && !rawTab) redirect(`/${locale}/app/calendar/settings?tab=connections&gcal=${encodeURIComponent(gcal)}`);
  const tab = TABS.find((k) => k === rawTab) ?? 'profile';
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'calendar' });
  const h = await headers();
  const origin = (process.env.NEXTAUTH_URL ?? `https://${h.get('host') ?? 'zerosoft.ai'}`).replace(/\/$/, '');

  return (
    <div className="ui-page">
      <PageHeader title={t('settings.title')} description={t('settings.lead')} />
      <SettingsTabs
        mode="query"
        label={t('settings.title')}
        items={[
          { key: 'profile', label: t('settings.tabProfile') },
          { key: 'connections', label: t('settings.tabConnections') },
          { key: 'payments', label: t('settings.tabPayments') },
        ]}
      >
        {tab === 'profile' && (
          <ProfileTab
            userId={user.id}
            handle={user.handle ?? ''}
            accountName={user.name || user.handle || ''}
            origin={origin}
            locale={locale}
            canEdit={isWorkspaceAdmin(user)}
          />
        )}
        {tab === 'connections' && (
          <GoogleCalendarPanel
            configured={googleOAuthConfigured()}
            connectedEmail={await getIntegration(realUserId(user), GOOGLE_CALENDAR_PROVIDER).then((g) => (g ? g.email || 'Google' : null))}
            notice={gcal ?? null}
            redirectUri={googleCalendarRedirectUri()}
          />
        )}
        {tab === 'payments' && (
          <PaymentsSettingsPanel initial={await getPaymentSettings(user.id)} origin={origin} canEdit={isWorkspaceAdmin(user)} />
        )}
      </SettingsTabs>
    </div>
  );
}

async function ProfileTab({
  userId,
  handle,
  accountName,
  origin,
  locale,
  canEdit,
}: {
  userId: string;
  handle: string;
  accountName: string;
  origin: string;
  locale: string;
  canEdit: boolean;
}) {
  const config = await getOrCreateCalendarUser(userId);
  return (
    <CalendarSettingsForm
      origin={origin}
      locale={locale}
      canEditHandle={canEdit}
      initial={{
        handle,
        timezone: config.timezone,
        weekStart: config.week_start,
        bufferBeforeMin: config.buffer_before_min,
        bufferAfterMin: config.buffer_after_min,
        minNoticeHours: config.min_notice_hours,
        maxBookingDays: config.max_booking_days,
        brandColor: config.brand_color ?? '',
        logoUrl: config.logo_url ?? '',
        displayName: config.display_name ?? '',
      }}
      accountName={accountName}
    />
  );
}
