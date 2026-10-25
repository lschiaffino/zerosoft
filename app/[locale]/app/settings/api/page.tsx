import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { isWorkspaceAdmin, realUserId, requireUser } from '@/lib/session';
import { listWebhooks } from '@/lib/webhooks';
import { listApiKeys } from '@/lib/api-auth';
import { listDomains } from '@/lib/link-domains';
import { shortDomain } from '@/lib/utils';
import { settingsSectionMetadata } from '@/lib/settings-meta';
import ApiKeysPanel from '@/components/app/ApiKeysPanel';
import WebhooksPanel from '@/components/app/WebhooksPanel';
import FormSection from '@/components/ui/FormSection';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  return settingsSectionMetadata(locale, 'api');
}

/** Ajustes › API y webhooks: keys de la API v1 y avisos salientes (antes en /app/settings/workspace). */
export default async function ApiSettingsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const admin = isWorkspaceAdmin(user);
  const t = await getTranslations({ locale, namespace: 'settings' });
  // Members ven solo sus keys; owner/admin, las de todo el workspace.
  const [keys, webhooks, domains] = await Promise.all([
    listApiKeys(user.id, admin ? undefined : realUserId(user)),
    admin ? listWebhooks(user.id) : Promise.resolve(null),
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
        <FormSection id="webhooks" title={t('webhooks.title')} description={t('webhooks.desc')}>
          <p className="ui-help">{t('webhooks.adminOnly')}</p>
        </FormSection>
      )}
    </div>
  );
}
