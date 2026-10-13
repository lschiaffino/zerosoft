import { getTranslations } from 'next-intl/server';
import { DEMO_MODE, isWorkspaceAdmin, realUserId, requireUser } from '@/lib/session';
import { listWebhooks, WEBHOOK_EVENTS } from '@/lib/webhooks';
import WebhooksPanel from '@/components/app/WebhooksPanel';
import DomainsPanel from '@/components/link/DomainsPanel';
import ImportLinksPanel from '@/components/link/ImportLinksPanel';
import { dnsInstructions, listDomains } from '@/lib/link-domains';
import { listApiKeys } from '@/lib/api-auth';
import { formatDate } from '@/lib/utils';
import ApiKeysPanel from '@/components/link/ApiKeysPanel';
import { Link } from '@/i18n/navigation';
import { isAdminEmail } from '@/lib/feedback';

export const dynamic = 'force-dynamic';

export default async function SettingsPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const {
    locale
  } = params;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'link' });
  const tFeedback = await getTranslations({ locale, namespace: 'feedback.admin' });
  // Members ven solo sus keys; owner/admin, las de todo el workspace.
  const keys = await listApiKeys(user.id, isWorkspaceAdmin(user) ? undefined : realUserId(user));
  const webhooks = isWorkspaceAdmin(user) ? await listWebhooks(user.id) : null;
  const domains = (await listDomains(user.id)).map((d) => ({ ...d, dns: dnsInstructions(d.hostname) }));

  return (
    <div className="app-page">
      <h1 className="app-title">{t('settings.title')}</h1>

      <section className="panel">
        <div className="panel-head">
          <p className="section-label">{t('settings.profile')}</p>
          {DEMO_MODE && <span className="badge status-protected">{t('settings.demoBadge')}</span>}
        </div>
        {DEMO_MODE && <p className="muted demo-note">{t('settings.demoDesc')}</p>}
        <div className="profile-row">
          {user.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.image} alt="" className="profile-avatar" />
          ) : (
            <span className="brand-zero profile-avatar-fallback">0</span>
          )}
          <div className="profile-fields">
            <div className="profile-field">
              <span className="label">{t('settings.name')}</span>
              <span>{user.name ?? '—'}</span>
            </div>
            <div className="profile-field">
              <span className="label">{t('settings.email')}</span>
              <span className="mono">{user.email}</span>
            </div>
            <div className="profile-field">
              <span className="label">{t('settings.memberSince')}</span>
              <span className="mono">{formatDate(user.created_at, locale)}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <p className="section-label">{t('domains.title')}</p>
        <DomainsPanel initial={domains} canManage={isWorkspaceAdmin(user)} />
      </section>

      <section className="panel">
        <p className="section-label">{t('import.title')}</p>
        <ImportLinksPanel />
      </section>

      <section className="panel">
        <p className="section-label">{t('export.title')}</p>
        <p className="muted">{t('export.desc')}</p>
        <div className="form-actions">
          <a className="btn btn-ghost btn-small" href="/api/links/export?format=csv" download>
            CSV
          </a>
          <a className="btn btn-ghost btn-small" href="/api/links/export?format=json" download>
            JSON
          </a>
        </div>
      </section>

      <section className="panel">
        <p className="section-label">{t('settings.apiKeys')}</p>
        <ApiKeysPanel initialKeys={keys} />
      </section>

      {webhooks && (
        <section className="panel">
          <p className="section-label">Webhooks</p>
          <WebhooksPanel initial={webhooks} events={WEBHOOK_EVENTS} />
        </section>
      )}

      {isAdminEmail(user.actingUser?.email ?? user.email) && (
        <section className="panel">
          <p className="section-label">{tFeedback('title')}</p>
          <p className="muted">{tFeedback('sub')}</p>
          <div className="form-actions">
            <Link className="btn btn-ghost btn-small" href="/app/settings/feedback">
              {tFeedback('title')} →
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
