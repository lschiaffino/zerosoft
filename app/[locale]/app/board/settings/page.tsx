import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { boardViewer } from '@/lib/board-access';
import { ProductSettingsShell } from '@/components/app/ProductSettingsShell';
import FormSection from '@/components/ui/FormSection';
import { PRODUCT_SETTINGS_SHORTCUTS } from '@/lib/product-settings';
import BoardAuditLog from '@/components/board/BoardAuditLog';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'settings.products' });
  return { title: t('title', { app: 'Board' }) };
}

/** Ajustes de Board: atajos y, para owner y admins, el registro de actividad. */
export default async function BoardSettingsPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { locale } = await props.params;
  const { tab: rawTab } = await props.searchParams;
  const user = await requireUser(locale);
  const admin = boardViewer(user).isAdmin;
  const ts = await getTranslations({ locale, namespace: 'settings.products' });
  const tb = await getTranslations({ locale, namespace: 'board.audit' });
  const tabs = [{ key: 'general', label: ts('general') }, ...(admin ? [{ key: 'audit', label: tb('tab') }] : [])];
  const tab = tabs.some((x) => x.key === rawTab) ? rawTab : 'general';
  const shortcuts = PRODUCT_SETTINGS_SHORTCUTS.board;
  return (
    <ProductSettingsShell locale={locale} product="board" tabs={tabs}>
      <div className="st-stack">
        {tab === 'general' && (
          <FormSection title={ts('shortcuts')}>
            <ul className="st-links">
              {shortcuts.map((s) => (
                <li key={s.href}>
                  <Link href={s.href} className="st-link">
                    {ts(`links.${s.label}`)}
                  </Link>
                </li>
              ))}
            </ul>
          </FormSection>
        )}
        {tab === 'audit' && admin && <BoardAuditLog />}
      </div>
    </ProductSettingsShell>
  );
}
