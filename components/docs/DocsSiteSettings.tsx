'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import FormSection from '@/components/ui/FormSection';
import EmptyState from '@/components/ui/EmptyState';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import DocsViewsChart, { type ViewsDay } from './DocsViewsChart';
import { downloadExport, type DocsExportFormat } from './DocsExportDialog';

interface Site {
  indexing: boolean;
  locale: 'en' | 'es' | 'pt' | null;
  hostname: string | null;
  verified: boolean;
  verified_at: string | null;
  dns: Array<{ type: string; name: string; value: string }>;
}

interface Analytics {
  days: number;
  views: number;
  visitors: number;
  series: ViewsDay[];
  pages: Array<{ id: string; title: string; slug: string | null; views: number; visitors: number; helpful: number; notHelpful: number }>;
  referrers: Array<{ host: string; visitors: number }>;
}

/**
 * Ajustes › Docs › Sitio: el centro de ayuda como sitio propio. Dominio
 * (con los registros DNS y la verificación), indexación en buscadores,
 * idioma del dominio y la analítica de visitas (sin cookies).
 */
export function DocsSiteSettings({ handle, publicBase }: { handle: string | null; publicBase: string | null }) {
  const t = useTranslations('docs.site');
  const uid = useId();
  const [site, setSite] = useState<Site | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [domain, setDomain] = useState('');
  const [domainError, setDomainError] = useState<string | null>(null);
  /** Dominio pendiente en otro workspace: el TXT que prueba que es tuyo. */
  const [claimDns, setClaimDns] = useState<Site['dns'] | null>(null);
  const [verifyNote, setVerifyNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(async () => {
    setLoadError(false);
    const res = await fetch('/api/docs/site?analytics=1').catch(() => null);
    if (!res?.ok) {
      setLoadError(true);
      return;
    }
    const data = (await res.json()) as { site: Site; analytics: Analytics };
    setSite(data.site);
    setAnalytics(data.analytics);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function patchSite(p: Partial<Pick<Site, 'indexing' | 'locale'>>): Promise<string | void> {
    const res = await fetch('/api/docs/site', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) }).catch(() => null);
    if (!res?.ok) return t('saveError');
    setSite(((await res.json()) as { site: Site }).site);
  }

  async function addDomain() {
    setBusy(true);
    setDomainError(null);
    const res = await fetch('/api/docs/site/domain', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hostname: domain }) }).catch(() => null);
    setBusy(false);
    const data = (await res?.json().catch(() => null)) as { site?: Site; error?: string; dns?: Site['dns'] } | null;
    if (!res?.ok || !data?.site) {
      const code = data?.error ?? 'failed';
      setDomainError(t.has(`domainErrors.${code}`) ? t(`domainErrors.${code}`) : t('domainErrors.failed'));
      setClaimDns(data?.dns ?? null);
      return;
    }
    setClaimDns(null);
    setSite(data.site);
    setDomain('');
  }

  async function verify() {
    setBusy(true);
    setVerifyNote(null);
    const res = await fetch('/api/docs/site/domain', { method: 'PATCH' }).catch(() => null);
    setBusy(false);
    const data = (await res?.json().catch(() => null)) as { verified?: boolean; reason?: string } | null;
    if (data?.verified) {
      setVerifyNote(t('verified'));
      await load();
    } else setVerifyNote(t(data?.reason === 'txt_missing' ? 'verifyTxt' : data?.reason === 'dns_not_ready' ? 'verifyDns' : data?.reason === 'domain_taken' ? 'domainErrors.domain_taken' : 'verifyFailed'));
  }

  async function remove() {
    const res = await fetch('/api/docs/site/domain', { method: 'DELETE' }).catch(() => null);
    setRemoving(false);
    if (res?.ok) await load();
  }

  if (loadError) {
    return (
      <EmptyState
        title={t('loadError')}
        action={
          <button type="button" className="btn" onClick={() => void load()}>
            {t('retry')}
          </button>
        }
      />
    );
  }
  if (!site) return <p className="ui-help" role="status">{t('loading')}</p>;

  return (
    <>
      <FormSection title={t('addressTitle')} description={t('addressHelp')}>
        {publicBase ? (
          <p>
            <a href={publicBase} target="_blank" rel="noopener noreferrer" className="docs-inline-link data" data-testid="docs-site-address">
              {publicBase}
            </a>
          </p>
        ) : (
          <p className="ui-help">{t('noHandle')}</p>
        )}
      </FormSection>

      <FormSection title={t('domainTitle')} description={t('domainHelp')}>
        {!site.hostname ? (
          <form
            className="ui-fields"
            onSubmit={(e) => {
              e.preventDefault();
              if (domain.trim()) void addDomain();
            }}
          >
            <div className="ui-field">
              <label className="label" htmlFor={`${uid}-domain`}>
                {t('domain')}
              </label>
              <div className="ui-input-group">
                <input
                  id={`${uid}-domain`}
                  className="input data"
                  placeholder="docs.example.com"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  disabled={!handle}
                  data-testid="docs-site-domain-input"
                />
                <button type="submit" className="btn btn-secondary" disabled={busy || !domain.trim() || !handle} data-testid="docs-site-domain-add">
                  {t('addDomain')}
                </button>
              </div>
              {domainError && (
                <span className="ui-error" role="alert">
                  {domainError}
                </span>
              )}
              {claimDns && claimDns.length > 0 && (
                <div className="docs-dns-wrap">
                  <table className="docs-dns">
                    <tbody>
                      {claimDns.map((r) => (
                        <tr key={r.name}>
                          <td className="data">{r.type}</td>
                          <td className="data">{r.name}</td>
                          <td className="data">{r.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </form>
        ) : (
          <div className="ui-fields" data-testid="docs-site-domain">
            <p>
              <strong className="data">{site.hostname}</strong>{' '}
              <span className="ui-help" data-testid="docs-site-domain-state">
                {site.verified ? t('domainVerified') : t('domainPending')}
              </span>
            </p>
            {!site.verified && site.dns.length > 0 && (
              <>
                <p className="ui-help">{t('dnsHelp')}</p>
                <div className="docs-dns-wrap">
                  <table className="docs-dns">
                    <thead>
                      <tr>
                        <th scope="col">{t('dnsType')}</th>
                        <th scope="col">{t('dnsName')}</th>
                        <th scope="col">{t('dnsValue')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {site.dns.map((r) => (
                        <tr key={`${r.type}-${r.name}`}>
                          <td className="data">{r.type}</td>
                          <td className="data">{r.name || '@'}</td>
                          <td className="data">{r.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {verifyNote && (
              <p className="ui-help" role="status">
                {verifyNote}
              </p>
            )}
            <div className="ximp-actions">
              {!site.verified && (
                <button type="button" className="btn btn-primary" onClick={() => void verify()} disabled={busy} data-testid="docs-site-verify">
                  {busy ? t('verifying') : t('verify')}
                </button>
              )}
              {site.verified && (
                <a className="btn btn-secondary" href={`https://${site.hostname}`} target="_blank" rel="noopener noreferrer">
                  {t('openSite')}
                </a>
              )}
              <button type="button" className="btn btn-ghost btn-danger" onClick={() => setRemoving(true)}>
                {t('removeDomain')}
              </button>
            </div>
          </div>
        )}
      </FormSection>

      <FormSection
        title={t('seoTitle')}
        description={t('seoHelp')}
        onSubmit={(fd) =>
          patchSite({
            indexing: fd.get('indexing') === 'on',
            locale: (String(fd.get('locale') || '') || null) as Site['locale'],
          })
        }
      >
        <label className="ui-switch docs-switch-row">
          <input type="checkbox" role="switch" name="indexing" defaultChecked={site.indexing} data-testid="docs-site-indexing" />
          <span className="docs-switch-text">
            <span className="docs-switch-label">{t('indexing')}</span>
            <span className="ui-help">{t('indexingHelp')}</span>
          </span>
        </label>
        <div className="ui-field">
          <label className="label" htmlFor={`${uid}-locale`}>
            {t('locale')}
          </label>
          <select id={`${uid}-locale`} name="locale" className="select" defaultValue={site.locale ?? ''}>
            <option value="">{t('localeAuto')}</option>
            <option value="en">English</option>
            <option value="es">Español</option>
            <option value="pt">Português</option>
          </select>
          <span className="ui-help">{t('localeHelp')}</span>
        </div>
      </FormSection>

      <FormSection title={t('analyticsTitle')} description={t('analyticsHelp')}>
        {!analytics ? null : analytics.views === 0 ? (
          <EmptyState title={t('noVisits')} body={t('noVisitsBody')} />
        ) : (
          <div className="docs-site-analytics" data-testid="docs-site-analytics">
            <dl className="docs-analytics-stats">
              <div>
                <dt>{t('views')}</dt>
                <dd data-testid="docs-site-views">{analytics.views}</dd>
              </div>
              <div>
                <dt>{t('visitors')}</dt>
                <dd>{analytics.visitors}</dd>
              </div>
            </dl>
            <DocsViewsChart series={analytics.series} label={t('chart', { days: analytics.days })} />
            <div className="docs-site-tables">
              <div className="docs-dns-wrap">
                <table className="docs-dns">
                  <caption className="docs-analytics-h">{t('topPages')}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t('page')}</th>
                      <th scope="col">{t('views')}</th>
                      <th scope="col">{t('helpful')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.pages.map((p) => (
                      <tr key={p.id}>
                        <td>{p.title || t('untitled')}</td>
                        <td className="data">{p.views}</td>
                        <td className="data">
                          {p.helpful + p.notHelpful > 0 ? `${Math.round((p.helpful / (p.helpful + p.notHelpful)) * 100)}%` : '–'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {analytics.referrers.length > 0 && (
                <div className="docs-dns-wrap">
                  <table className="docs-dns">
                    <caption className="docs-analytics-h">{t('referrers')}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{t('source')}</th>
                        <th scope="col">{t('visitors')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.referrers.map((r) => (
                        <tr key={r.host}>
                          <td className="data">{r.host}</td>
                          <td className="data">{r.visitors}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </FormSection>

      {removing && (
        <ConfirmDialog
          open
          title={t('removeTitle')}
          body={t('removeBody', { domain: site.hostname ?? '' })}
          confirmLabel={t('removeDomain')}
          cancelLabel={t('cancel')}
          danger
          onConfirm={() => void remove()}
          onCancel={() => setRemoving(false)}
        />
      )}
    </>
  );
}

/** Ajustes › Docs: exportar todo el workspace (Markdown, HTML o PDF en un zip). */
export function DocsWorkspaceExport({ allowed }: { allowed: boolean }) {
  const t = useTranslations('docs.export');
  const uid = useId();
  const [format, setFormat] = useState<DocsExportFormat>('md');
  const [state, setState] = useState<'idle' | 'working' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  return (
    <FormSection
      title={t('workspaceTitle')}
      description={t('workspaceHelp')}
      disabled={!allowed}
      note={allowed ? undefined : t('errors.export_disabled')}
      footer={
        <button
          type="button"
          className="btn btn-primary"
          disabled={!allowed || state === 'working'}
          aria-busy={state === 'working' || undefined}
          data-testid="docs-export-workspace"
          onClick={async () => {
            setState('working');
            setError(null);
            const err = await downloadExport(`/api/docs/export?format=${format}`);
            setError(err);
            setState(err ? 'idle' : 'done');
          }}
        >
          {state === 'working' ? t('working') : t('workspaceRun')}
        </button>
      }
    >
      <div className="ui-field">
        <label className="label" htmlFor={`${uid}-fmt`}>
          {t('format')}
        </label>
        <select id={`${uid}-fmt`} className="select" value={format} onChange={(e) => setFormat(e.target.value as DocsExportFormat)} disabled={!allowed}>
          {(['md', 'html', 'pdf'] as const).map((f) => (
            <option key={f} value={f}>
              {t(`formats.${f}`)}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <p className="ui-error" role="alert">
          {t.has(`errors.${error}`) ? t(`errors.${error}`) : t('errors.failed')}
        </p>
      )}
      {state === 'done' && (
        <p className="ui-help" role="status">
          {t('done')}
        </p>
      )}
    </FormSection>
  );
}
