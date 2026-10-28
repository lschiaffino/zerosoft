import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { isWorkspaceAdmin, requireUser } from '@/lib/session';
import { dnsInstructions, listDomains } from '@/lib/link-domains';
import { LINK_SETTINGS_TABS, linkSettingsTab } from '@/lib/product-settings';
import { listApps } from '@/lib/crm-apps';
import { listLinkIntegrations } from '@/lib/link-integrations';
import { listLinkActivity } from '@/lib/link-activity';
import { ProductSettingsShell } from '@/components/app/ProductSettingsShell';
import ClientMessages from '@/components/i18n/ClientMessages';
import AppsPanel from '@/components/crm/AppsPanel';
import DomainsPanel from '@/components/link/DomainsPanel';
import ImportLinksPanel from '@/components/link/ImportLinksPanel';
import LinkIntegrationsPanel from '@/components/link/LinkIntegrationsPanel';
import LinkActivityList from '@/components/link/LinkActivityList';
import CopyButton from '@/components/link/CopyButton';
import EmptyState from '@/components/ui/EmptyState';
import FormSection from '@/components/ui/FormSection';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'settings.products' });
  return { title: t('title', { app: 'Link' }) };
}

function appBase(): string {
  return (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  return (
    <div className="lk-code">
      <pre className="data" aria-label={label}>
        <code>{code}</code>
      </pre>
      <CopyButton text={code} className="btn btn-secondary btn-sm" />
    </div>
  );
}

/**
 * Ajustes de Link: dominios, conversiones (script, API, Stripe y Shopify),
 * integraciones (Slack, Stripe, Zapier, Make, Segment y MCP), importar,
 * exportar y el registro de actividad del workspace.
 */
export default async function LinkSettingsPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string; before?: string }>;
}) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const tab = linkSettingsTab(sp.tab);
  const user = await requireUser(locale);
  const admin = isWorkspaceAdmin(user);
  const [t, tl] = await Promise.all([
    getTranslations({ locale, namespace: 'settings' }),
    getTranslations({ locale, namespace: 'link' }),
  ]);
  const labels: Record<(typeof LINK_SETTINGS_TABS)[number], string> = {
    domains: tl('domains.title'),
    conversions: tl('conversions.title'),
    integrations: tl('integrations.title'),
    import: tl('import.tab'),
    export: t('link.exportTitle'),
    activity: tl('activity.title'),
  };
  const base = appBase();

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
  } else if (tab === 'conversions') {
    const [integrations, apps] = await Promise.all([listLinkIntegrations(user.id), listApps(user.id)]);
    const stripe = apps.find((a) => a.key === 'stripe');
    const snippet = `<script src="${base}/link-tracking.js" defer></script>`;
    const lead = `curl -X POST ${base}/api/v1/links/track/lead \\
  -H "Authorization: Bearer zs_…" -H "Content-Type: application/json" \\
  -d '{"clickId":"<zs_id cookie>","eventName":"Sign up","customerExternalId":"user_123"}'`;
    const sale = `curl -X POST ${base}/api/v1/links/track/sale \\
  -H "Authorization: Bearer zs_…" -H "Content-Type: application/json" \\
  -d '{"customerExternalId":"user_123","amount":4900,"currency":"USD","invoiceId":"inv_1"}'`;
    body = (
      <div className="lk-conv-setup" data-testid="link-conversions-setup">
        <FormSection id="conv-how" title={tl('conversions.howTitle')} description={tl('conversions.howDesc')}>
          <ol className="lk-steps">
            <li>{tl('conversions.step1')}</li>
            <li>{tl('conversions.step2')}</li>
            <li>{tl('conversions.step3')}</li>
          </ol>
          <CodeBlock code={snippet} label={tl('conversions.snippetLabel')} />
          <p className="ui-help">{tl('conversions.snippetHelp')}</p>
        </FormSection>
        <FormSection id="conv-api" title={tl('conversions.apiTitle')} description={tl('conversions.apiDesc')}>
          <CodeBlock code={lead} label={tl('conversions.leadLabel')} />
          <CodeBlock code={sale} label={tl('conversions.saleLabel')} />
          <p className="ui-help">
            {tl.rich('conversions.apiKeys', { a: (chunks) => <Link href="/app/settings/api#api-keys">{chunks}</Link> })}
          </p>
        </FormSection>
        <FormSection id="conv-stripe" title={tl('conversions.stripeTitle')} description={tl('conversions.stripeDesc')}>
          <p className="ui-help">
            <span className={`badge ${stripe?.connected ? 'badge-ok' : ''}`}>
              {stripe?.connected ? tl('integrations.status.connected') : tl('integrations.status.off')}
            </span>{' '}
            {tl.rich('conversions.stripeConnect', { a: (chunks) => <Link href="/app/links/settings?tab=integrations">{chunks}</Link> })}
          </p>
          <CodeBlock code={`client_reference_id: "zs_id_" + clickId`} label={tl('conversions.stripeLabel')} />
        </FormSection>
        <FormSection id="conv-shopify" title={tl('integrations.shopify.name')} description={tl('integrations.shopify.desc')}>
          <LinkIntegrationsPanel initial={integrations} canEdit={admin} only={['shopify']} />
        </FormSection>
      </div>
    );
  } else if (tab === 'integrations') {
    const [apps, integrations] = await Promise.all([listApps(user.id), listLinkIntegrations(user.id)]);
    const mcpUrl = `${base}/api/v1/links/mcp`;
    body = (
      <>
        <FormSection id="int-apps" title={tl('integrations.title')} description={tl('integrations.desc')}>
          <ClientMessages locale={locale} namespaces={['crm']}>
            <AppsPanel initial={apps} canEdit={admin} only={['slack', 'stripe', 'zapier', 'make']} />
          </ClientMessages>
        </FormSection>
        <FormSection id="int-segment" title={tl('integrations.segment.name')} description={tl('integrations.segment.desc')}>
          <LinkIntegrationsPanel initial={integrations} canEdit={admin} only={['segment']} />
        </FormSection>
        <FormSection id="int-mcp" title={tl('integrations.mcp.title')} description={tl('integrations.mcp.desc')}>
          <CodeBlock code={mcpUrl} label={tl('integrations.mcp.title')} />
          <p className="ui-help">
            {tl.rich('integrations.mcp.help', { a: (chunks) => <Link href="/app/settings/api#api-keys">{chunks}</Link> })}
          </p>
        </FormSection>
      </>
    );
  } else if (tab === 'import') {
    body = admin ? <ImportLinksPanel /> : <EmptyState title={tl('import.title')} body={tl('errors.forbidden')} product="link" />;
  } else if (tab === 'activity') {
    if (!admin) {
      body = <EmptyState title={tl('activity.title')} body={tl('errors.forbidden')} product="link" />;
    } else {
      const before = Number(sp.before) || undefined;
      const activity = await listLinkActivity(user.id, { before, limit: 50 });
      body = (
        <FormSection id="activity" title={tl('activity.title')} description={tl('activity.desc')}>
          <LinkActivityList
            locale={locale}
            rows={activity.rows}
            showLink
            moreHref={activity.nextBefore ? `/app/links/settings?tab=activity&before=${activity.nextBefore}` : null}
          />
        </FormSection>
      );
    }
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
