import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { roleAtLeast } from '@/lib/teams';
import { Link } from '@/i18n/navigation';
import { PRODUCT_SETTINGS_SHORTCUTS } from '@/lib/product-settings';
import { ProductSettingsShell } from '@/components/app/ProductSettingsShell';
import FormSection from '@/components/ui/FormSection';
import { NotesAdminPanel, NotesEmailPanel } from '@/components/notes/NotesSettingsPanels';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'settings.products' });
  return { title: t('title', { app: 'Notes' }) };
}

/** Ajustes de Notes: email a nota, atajos y, para admins, la consola del equipo. */
export default async function NotesSettingsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'settings.products' });
  const tNotes = await getTranslations({ locale, namespace: 'notes' });
  const admin = roleAtLeast(user.role, 'admin');
  return (
    <ProductSettingsShell locale={locale} product="notes" tabs={[{ key: 'general', label: t('general') }]}>
      <div className="st-stack">
        <FormSection title={tNotes('email.title')}>
          <NotesEmailPanel />
        </FormSection>
        {admin && (
          <FormSection title={tNotes('admin.title')}>
            <NotesAdminPanel />
          </FormSection>
        )}
        <FormSection title={t('shortcuts')}>
          <ul className="st-links">
            {PRODUCT_SETTINGS_SHORTCUTS.notes.map((s) => (
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
