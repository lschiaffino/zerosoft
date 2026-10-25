import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { isWorkspaceAdmin, requireUser } from '@/lib/session';
import { dnsInstructions, listDomains } from '@/lib/link-domains';
import { LINK_SETTINGS_TABS, linkSettingsTab } from '@/lib/product-settings';
import { ProductSettingsShell } from '@/components/app/ProductSettingsShell';
import DomainsPanel from '@/components/link/DomainsPanel';
import ImportLinksPanel from '@/components/link/ImportLinksPanel';
import EmptyState from '@/components/ui/EmptyState';
import FormSection from '@/components/ui/FormSection';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'settings.products' });
  return { title: t('title', { app: 'Link' }) };
}

/**
 * Ajustes de Link: dominios propios (antes /app/links/domains, que redirige
 * acá), importar desde Bitly (también es pestaña de "Nuevo") y exportar
 * (antes en /app/settings/workspace).
 */
export default async function LinkSettingsPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { locale } = await props.params;
  const tab = linkSettingsTab((await props.searchParams).tab);
  const user = await requireUser(locale);
  const admin = isWorkspaceAdmin(user);
  const [t, tl] = await Promise.all([
    getTranslations({ locale, namespace: 'settings' }),
    getTranslations({ locale, namespace: 'link' }),
  ]);
  const labels: Record<(typeof LINK_SETTINGS_TABS)[number], string> = {
    domains: tl('domains.title'),
    import: tl('import.title'),
    export: t('link.exportTitle'),
  };

  let body;
  if (tab === 'domains') {
    const domains = (await listDomains(user.id)).map((d) => ({
      id: d.id,
      hostname: d.hostname,
      verified: d.verified,
      root_url: d.root_url,
      not_found_url: d.not_found_url ?? null,
      expired_url: d.expired_url ?? null,
      dns: dnsInstructions(d.hostname, d.verified === 1 ? null : d.verify_token),
    }));
    body = (
      <div className="link-domains">
        <DomainsPanel initial={domains} canManage={admin} />
      </div>
    );
  } else if (tab === 'import') {
    body = admin ? <ImportLinksPanel /> : <EmptyState title={tl('import.title')} body={tl('errors.forbidden')} product="link" />;
  } else {
    body = (
      <FormSection id="export" title={t('link.exportTitle')} description={t('link.exportDesc')}>
        {admin ? (
          <div className="st-actions">
            <a className="btn btn-secondary btn-sm" href="/api/links/export?format=csv" download>
              {t('link.csv')}
            </a>
            <a className="btn btn-secondary btn-sm" href="/api/links/export?format=json" download>
              {t('link.json')}
            </a>
          </div>
        ) : (
          <p className="ui-help">{t('link.adminOnly')}</p>
        )}
      </FormSection>
    );
  }

  return (
    <ProductSettingsShell locale={locale} product="link" tabs={LINK_SETTINGS_TABS.map((key) => ({ key, label: labels[key] }))}>
      {body}
    </ProductSettingsShell>
  );
}
