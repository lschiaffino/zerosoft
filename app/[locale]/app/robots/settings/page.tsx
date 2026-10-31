import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { Link } from '@/i18n/navigation';
import { ProductSettingsShell } from '@/components/app/ProductSettingsShell';
import FormSection from '@/components/ui/FormSection';
import RobotsWorkspaceSettings from '@/components/robots/RobotsWorkspaceSettings';
import { getRobotWorkspaceConfig, maxWorkspaceConcurrency } from '@/lib/robots';
import { canEditRobots } from '@/lib/robots-http';
import { PRODUCT_SETTINGS_SHORTCUTS } from '@/lib/product-settings';
import '@/styles/robots.css';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'settings.products' });
  return { title: t('title', { app: 'Robots' }) };
}

/** Ajustes de Robots: corridas a la vez, permisos de los members y atajos. */
export default async function RobotsSettingsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'settings.products' });
  const config = await getRobotWorkspaceConfig(user.id);
  return (
    <ProductSettingsShell locale={locale} product="robots" tabs={[{ key: 'general', label: t('general') }]}>
      <div className="st-stack">
        <RobotsWorkspaceSettings initial={config} maxConcurrency={maxWorkspaceConcurrency()} canEdit={canEditRobots(user)} />
        <FormSection title={t('shortcuts')}>
          <ul className="st-links">
            {PRODUCT_SETTINGS_SHORTCUTS.robots.map((s) => (
              <li key={s.href}>
                <Link href={s.href} className="st-link">
                  {t(`links.${s.label}`)}
                </Link>
              </li>
            ))}
          </ul>
        </FormSection>
      </div>
    </ProductSettingsShell>
  );
}
