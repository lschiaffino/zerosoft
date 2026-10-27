import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { isWorkspaceAdmin, realUserId, requireUser } from '@/lib/session';
import { googleCalendarRedirectUri, googleOAuthConfigured } from '@/lib/integrations';
import { getCalendarUser, getOrCreateCalendarUser } from '@/lib/calendar';
import { getPaymentSettings } from '@/lib/calendar-payments';
import PageHeader from '@/components/ui/PageHeader';
import PlatformSettingsLink from '@/components/app/PlatformSettingsLink';
import SettingsTabs from '@/components/ui/SettingsTabs';
import { AutomationPanel, CalendarConnectionsPanel, SmsPanel, ZoomPanel } from '@/components/calendar/ConnectionsPanels';
import PrivacyPanel from '@/components/calendar/PrivacyPanel';
import ActivityLogPanel from '@/components/calendar/ActivityLogPanel';
import { microsoftConfigured } from '@/lib/microsoft';
import { outlookCalendarRedirectUri } from '@/lib/outlook-calendar';
import { fakeGoogleCalendarAllowed } from '@/lib/google-calendar-fake';
import { isAppConnected } from '@/lib/crm-apps';
import { getSmsSettings } from '@/lib/calendar-sms';
import { listCalActivity } from '@/lib/calendar-activity';
import CalendarSettingsForm from '@/components/calendar/CalendarSettingsForm';
import PaymentsSettingsPanel from '@/components/calendar/PaymentsSettingsPanel';
import ConferencingPanel from '@/components/calendar/ConferencingPanel';
import CalendlyImportPanel from '@/components/calendar/CalendlyImportPanel';
import { parseConferencing } from '@/lib/calendar-locations';
import { parseTracking } from '@/lib/calendar-tracking';

export const dynamic = 'force-dynamic';

const TABS = ['profile', 'connections', 'payments', 'import', 'privacy', 'activity'] as const;

export default async function CalendarSettingsPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ gcal?: string; outlook?: string; tab?: string }>;
}) {
  const { locale } = await props.params;
  const { gcal, outlook, tab: rawTab } = await props.searchParams;
  // Volver de Google (?gcal=…) cae en Conexiones aunque no venga la pestaña.
  if (gcal && !rawTab) redirect(`/${locale}/app/calendar/settings?tab=connections&gcal=${encodeURIComponent(gcal)}`);
  const tab = TABS.find((k) => k === rawTab) ?? 'profile';
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'calendar' });
  const h = await headers();
  const origin = (process.env.NEXTAUTH_URL ?? `https://${h.get('host') ?? 'zerosoft.ai'}`).replace(/\/$/, '');

  return (
    <div className="ui-page">
      <PageHeader title={t('settings.title')} description={t('settings.lead')} actions={<PlatformSettingsLink locale={locale} />} />
      <SettingsTabs
        mode="query"
        label={t('settings.title')}
        items={[
          { key: 'profile', label: t('settings.tabProfile') },
          { key: 'connections', label: t('settings.tabConnections') },
          { key: 'payments', label: t('settings.tabPayments') },
          { key: 'import', label: t('importer.tab') },
          ...(isWorkspaceAdmin(user)
            ? [
                { key: 'privacy', label: t('privacy.tab') },
                { key: 'activity', label: t('activity.tab') },
              ]
            : []),
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
          <>
            <CalendarConnectionsPanel
              googleConfigured={googleOAuthConfigured() || fakeGoogleCalendarAllowed()}
              outlookConfigured={microsoftConfigured()}
              googleRedirectUri={googleCalendarRedirectUri()}
              outlookRedirectUri={outlookCalendarRedirectUri()}
              notice={gcal ? { provider: 'google', result: gcal } : outlook ? { provider: 'outlook', result: outlook } : null}
            />
            <ZoomPanel initialConnected={await isAppConnected(user.id, 'zoom')} canEdit={isWorkspaceAdmin(user)} />
            <ConferencingPanel initial={parseConferencing((await getCalendarUser(realUserId(user)))?.conferencing)} />
            <SmsPanel initial={await getSmsSettings(user.id)} canEdit={isWorkspaceAdmin(user)} />
            <AutomationPanel mcpUrl={`${origin}/api/v1/calendar/mcp`} />
          </>
        )}
        {tab === 'import' && <CalendlyImportPanel canEdit={isWorkspaceAdmin(user)} />}
        {tab === 'privacy' && isWorkspaceAdmin(user) && <PrivacyPanel />}
        {tab === 'activity' && isWorkspaceAdmin(user) && <ActivityLogPanel initial={await listCalActivity(user.id, { limit: 100 })} locale={locale} />}
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
        hideBranding: config.hide_branding === 1,
        ga4: parseTracking(config.tracking).ga4 ?? '',
        metaPixel: parseTracking(config.tracking).metaPixel ?? '',
      }}
      accountName={accountName}
    />
  );
}
