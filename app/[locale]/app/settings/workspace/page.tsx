import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { isWorkspaceAdmin, realUserId, requireUser } from '@/lib/session';
import { listWebhooks } from '@/lib/webhooks';
import { listApiKeys } from '@/lib/api-auth';
import { listCredentials } from '@/lib/flow-credentials';
import { canEditFlows } from '@/lib/flow-http';
import { Link } from '@/i18n/navigation';
import AiUsagePanel from '@/components/app/AiUsagePanel';
import ApiKeysPanel from '@/components/app/ApiKeysPanel';
import WebhooksPanel from '@/components/app/WebhooksPanel';
import CredentialsSummary from '@/components/app/CredentialsSummary';
import FormSection from '@/components/ui/FormSection';
import { listDomains } from '@/lib/link-domains';
import { shortDomain } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'settings' });
  return { title: `${t('tabs.workspace')} · ${t('title')}` };
}

/**
 * Ajustes › Workspace: lo que comparte todo el workspace. Integraciones
 * primero (API keys, webhooks, credenciales), después el consumo de IA y los
 * datos de Link (dominios e import viven en Link; acá queda el link y la exportación).
 */
export default async function WorkspaceSettingsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const admin = isWorkspaceAdmin(user);
  const t = await getTranslations({ locale, namespace: 'settings' });
  // Members ven solo sus keys; owner/admin, las de todo el workspace.
  const [keys, webhooks, credentials, domains] = await Promise.all([
    listApiKeys(user.id, admin ? undefined : realUserId(user)),
    admin ? listWebhooks(user.id) : Promise.resolve(null),
    listCredentials(user.id),
    admin ? listDomains(user.id) : Promise.resolve([]),
  ]);

  return (
    <div className="st-stack">
      <ApiKeysPanel initialKeys={keys} isAdmin={admin} />

      {webhooks ? (
        <WebhooksPanel
          initial={webhooks}
          defaultDomain={shortDomain()}
          linkDomains={domains.filter((d) => d.verified === 1).map((d) => d.hostname)}
        />
      ) : (
        <FormSection title={t('webhooks.title')} description={t('webhooks.desc')}>
          <p className="ui-help">{t('webhooks.adminOnly')}</p>
        </FormSection>
      )}

      <CredentialsSummary credentials={credentials} canEdit={canEditFlows(user)} locale={locale} />

      <AiUsagePanel workspaceId={user.id} locale={locale} />

      <FormSection title={t('link.title')} description={t('link.desc')}>
        <ul className="st-links">
          <li>
            <Link href="/app/links/domains" className="st-link">
              {t('link.domains')}
            </Link>
          </li>
          <li>
            <Link href="/app/links/import" className="st-link">
              {t('link.import')}
            </Link>
          </li>
        </ul>
        {admin && (
          <div className="st-export">
            <div>
              <h3 className="st-subtitle">{t('link.exportTitle')}</h3>
              <p className="ui-help">{t('link.exportDesc')}</p>
            </div>
            <div className="st-actions">
              <a className="btn btn-secondary btn-sm" href="/api/links/export?format=csv" download>
                {t('link.csv')}
              </a>
              <a className="btn btn-secondary btn-sm" href="/api/links/export?format=json" download>
                {t('link.json')}
              </a>
            </div>
          </div>
        )}
      </FormSection>
    </div>
  );
}
