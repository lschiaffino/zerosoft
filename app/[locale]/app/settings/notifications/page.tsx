import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { realUserId, requireUser } from '@/lib/session';
import { settingsSectionMetadata } from '@/lib/settings-meta';
import { getEmailPrefs } from '@/lib/lifecycle/prefs';
import { DEFAULT_PREFS } from '@/lib/lifecycle/types';
import FormSection from '@/components/ui/FormSection';
import EmailPreferences from '@/components/settings/EmailPreferences';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  return settingsSectionMetadata(locale, 'notifications');
}

/** Ajustes › Avisos: los emails de zerosoft (por categoría) y los avisos propios de cada app. */
export default async function NotificationsSettingsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'settings.emailPrefs' });
  const prefs = await getEmailPrefs(realUserId(user)).catch(() => ({ ...DEFAULT_PREFS, optedOut: [] }));
  return (
    <div className="st-stack">
      <EmailPreferences initial={prefs} />
      <FormSection title={t('appsTitle')} description={t('appsDesc')}>
        <ul className="st-links">
          <li>
            <Link href="/app/track/settings?tab=notifications" className="st-link" prefetch={false}>
              {t('track')}
            </Link>
          </li>
        </ul>
      </FormSection>
    </div>
  );
}
