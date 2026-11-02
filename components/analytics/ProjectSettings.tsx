'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { ProjectDto, PropertyFilter } from '@/lib/analytics/types';
import { FilterList, cleanFilters, useProjectMeta } from './Filters';
import { offsetLabel } from '@/lib/analytics/tz';
import { ApiError, apiErrorText, api, notifyChanged } from './client';
import ReplaySettings from './replay/ReplaySettings';

const RETENTION = [30, 90, 180, 365, 730];

function CopyBlock({ code, label }: { code: string; label: string }) {
  const t = useTranslations('analytics.common');
  const [copied, setCopied] = useState(false);
  return (
    <div className="an-copy">
      <pre className="an-code" aria-label={label}>
        <code>{code}</code>
      </pre>
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => {
          void navigator.clipboard?.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? t('copied') : t('copy')}
      </button>
    </div>
  );
}

/**
 * Instalar y ajustar un proyecto: el snippet (script y módulo), la ingesta
 * desde un servidor, las keys, la privacidad (Do Not Track, IP, dominios),
 * la retención y borrar el proyecto.
 */
export default function ProjectSettings({ project, canManage }: { project: ProjectDto; canManage: boolean }) {
  const t = useTranslations('analytics.settings');
  const tc = useTranslations('analytics.common');
  const tm = useTranslations('analyticsMore.settings');
  const router = useRouter();
  const [origin, setOrigin] = useState('https://zerosoft.ai');
  // Las zonas salen del navegador: la lista completa recién al montar, para no romper la hidratación.
  const [zones, setZones] = useState<string[]>([]);
  useEffect(() => setZones(Intl.supportedValuesOf('timeZone')), []);
  const labelAt = useMemo(() => Date.parse('2026-01-15T12:00:00Z'), []);
  useEffect(() => setOrigin(window.location.origin), []);
  const [form, setForm] = useState({
    name: project.name,
    domains: project.allowedDomains.join('\n'),
    respectDnt: project.respectDnt,
    keepBots: project.keepBots,
    cookieless: project.cookieless,
    anonymizeIp: project.anonymizeIp,
    autocapture: project.autocapture,
    captureExceptions: project.captureExceptions,
    webVitals: project.webVitals,
    retentionDays: project.retentionDays,
    tzOffsetMin: project.tzOffsetMin,
    tzName: project.tzName,
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setForm({
      name: project.name,
      domains: project.allowedDomains.join('\n'),
      respectDnt: project.respectDnt,
    keepBots: project.keepBots,
    cookieless: project.cookieless,
      anonymizeIp: project.anonymizeIp,
      autocapture: project.autocapture,
      captureExceptions: project.captureExceptions,
      webVitals: project.webVitals,
      retentionDays: project.retentionDays,
      tzOffsetMin: project.tzOffsetMin,
    tzName: project.tzName,
    });
    setSecret(null);
  }, [project]);

  const snippet = `<script src="${origin}/zs.js" defer></script>
<script>
  window.zs = window.zs || [];
  zs.push(['init', '${project.publicKey}']);
</script>`;
  const esm = `import zs from '${origin}/zs.mjs';

zs.init('${project.publicKey}');
zs.capture('signed_up', { plan: 'pro' });
zs.identify('user-123', { email: 'ana@example.com' });`;
  const server = `curl -X POST ${origin}/api/ingest/e \\
  -H 'Authorization: Bearer <secret key>' \\
  -H 'Content-Type: application/json' \\
  -d '{"batch":[{"event":"order_paid","distinct_id":"user-123","properties":{"amount":49}}]}'`;
  const erase = `curl -X POST ${origin}/api/ingest/delete \\
  -H 'Authorization: Bearer <secret key>' \\
  -d '{"distinct_id":"user-123"}'`;

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/analytics/projects/${project.id}`, {
        method: 'PATCH',
        body: {
          name: form.name,
          allowedDomains: form.domains.split(/[\s,]+/).filter(Boolean),
          respectDnt: form.respectDnt,
          keepBots: form.keepBots,
          cookieless: form.cookieless,
          anonymizeIp: form.anonymizeIp,
          autocapture: form.autocapture,
          captureExceptions: form.captureExceptions,
          webVitals: form.webVitals,
          retentionDays: form.retentionDays,
          tzName: form.tzName,
        },
      });
      setMsg({ ok: true, text: t('saved') });
      notifyChanged();
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: apiErrorText(err, tc) });
    } finally {
      setBusy(false);
    }
  };

  const rotate = async () => {
    setBusy(true);
    try {
      const r = await api<{ secret: string }>(`/api/analytics/projects/${project.id}/secret`, { method: 'POST' });
      setSecret(r.secret);
      router.refresh();
    } catch {
      setMsg({ ok: false, text: tc('error') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="an-settings">
      <section className="ui-section" aria-labelledby="an-install">
        <div className="ui-section-head">
          <h2 id="an-install" className="ui-section-title">
            {t('installTitle')}
          </h2>
          <p className="ui-section-desc">{t('installDesc')}</p>
        </div>
        <div className="ui-section-body">
          <p className="an-small">{t('publicKey')}</p>
          <p className="an-mono an-key" data-testid="an-public-key">
            {project.publicKey}
          </p>
          <h3 className="an-h4">{t('snippetTitle')}</h3>
          <CopyBlock code={snippet} label={t('snippetTitle')} />
          <h3 className="an-h4">{t('moduleTitle')}</h3>
          <CopyBlock code={esm} label={t('moduleTitle')} />
          <p className="an-note">{t('apiHelp')}</p>
        </div>
      </section>

      <section className="ui-section" aria-labelledby="an-server">
        <div className="ui-section-head">
          <h2 id="an-server" className="ui-section-title">
            {t('serverTitle')}
          </h2>
          <p className="ui-section-desc">{t('serverDesc')}</p>
        </div>
        <div className="ui-section-body">
          <CopyBlock code={server} label={t('serverTitle')} />
          <h3 className="an-h4">{t('eraseTitle')}</h3>
          <CopyBlock code={erase} label={t('eraseTitle')} />
          <p className="an-small">{project.secretHint ? t('secretHint', { hint: project.secretHint }) : t('noSecret')}</p>
          {secret && (
            <div className="an-callout" role="status">
              <p>{t('secretOnce')}</p>
              <CopyBlock code={secret} label={t('secretKey')} />
            </div>
          )}
          {canManage && (
            <button type="button" className="btn btn-sm" onClick={() => void rotate()} disabled={busy}>
              {project.secretHint ? t('rotateSecret') : t('createSecret')}
            </button>
          )}
        </div>
      </section>

      <form
        className="ui-section"
        aria-labelledby="an-privacy"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="ui-section-head">
          <h2 id="an-privacy" className="ui-section-title">
            {t('settingsTitle')}
          </h2>
          <p className="ui-section-desc">{canManage ? t('settingsDesc') : t('adminsOnly')}</p>
        </div>
        <fieldset className="ui-section-body ui-fields" disabled={!canManage}>
          <label className="ui-field">
            <span className="label">{t('name')}</span>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={100} required />
          </label>
          <label className="ui-check">
            <input type="checkbox" checked={form.autocapture} onChange={(e) => setForm({ ...form, autocapture: e.target.checked })} /> {t('autocapture')}
          </label>
          <p className="ui-help">{t('autocaptureHelp')}</p>
          <label className="ui-check">
            <input type="checkbox" checked={form.captureExceptions} onChange={(e) => setForm({ ...form, captureExceptions: e.target.checked })} data-testid="an-capture-exceptions" /> {tm('captureExceptions')}
          </label>
          <p className="ui-help">{tm('captureExceptionsHelp')}</p>
          <label className="ui-check">
            <input type="checkbox" checked={form.webVitals} onChange={(e) => setForm({ ...form, webVitals: e.target.checked })} data-testid="an-web-vitals" /> {tm('webVitals')}
          </label>
          <p className="ui-help">{tm('webVitalsHelp')}</p>
          <label className="ui-check">
            <input type="checkbox" checked={form.respectDnt} onChange={(e) => setForm({ ...form, respectDnt: e.target.checked })} /> {t('respectDnt')}
          </label>
          <label className="ui-check">
            <input type="checkbox" data-testid="an-cookieless" checked={form.cookieless} onChange={(e) => setForm({ ...form, cookieless: e.target.checked })} /> {t('cookieless')}
          </label>
          <p className="ui-help">{t('cookielessHelp')}</p>
          {!project.cookieless && project.cookielessDropped > 0 && (
            <p className="ui-error" role="alert" data-testid="an-cookieless-dropped">
              {t('cookielessDropped', { count: project.cookielessDropped })}
            </p>
          )}
          <label className="ui-check">
            <input type="checkbox" data-testid="an-keep-bots" checked={form.keepBots} onChange={(e) => setForm({ ...form, keepBots: e.target.checked })} /> {t('keepBots')}
          </label>
          <p className="ui-help" data-testid="an-bots-filtered">{t('botsFiltered', { count: project.botsFiltered })}</p>
          <label className="ui-check">
            <input type="checkbox" checked={form.anonymizeIp} onChange={(e) => setForm({ ...form, anonymizeIp: e.target.checked })} /> {t('anonymizeIp')}
          </label>
          <label className="ui-field">
            <span className="label">{t('domains')}</span>
            <textarea className="textarea" rows={3} value={form.domains} onChange={(e) => setForm({ ...form, domains: e.target.value })} placeholder="example.com&#10;*.example.com" />
            <span className="ui-help">{t('domainsHelp')}</span>
          </label>
          <div className="ui-fields-2 ui-fields">
            <label className="ui-field">
              <span className="label">{t('retention')}</span>
              <select className="select" value={form.retentionDays} onChange={(e) => setForm({ ...form, retentionDays: Number(e.target.value) })}>
                {[...new Set([...RETENTION, form.retentionDays])].sort((a, b) => a - b).map((d) => (
                  <option key={d} value={d}>
                    {t('days', { n: d })}
                  </option>
                ))}
              </select>
            </label>
            <label className="ui-field">
              <span className="label">{t('timezone')}</span>
              <select
                className="select"
                data-testid="an-timezone"
                value={form.tzName ?? ''}
                onChange={(e) => setForm({ ...form, tzName: e.target.value || null })}
              >
                {/* Un proyecto de antes sigue con su desfase fijo hasta que elige una zona. */}
                {!project.tzName && <option value="">{t('timezoneFixed', { offset: offsetLabel(project.tzOffsetMin, 0) })}</option>}
                {[...new Set([...(form.tzName ? [form.tzName] : []), ...zones])].map((z) => (
                  <option key={z} value={z}>
                    {z.replace(/_/g, ' ')} ({offsetLabel(z, labelAt)})
                  </option>
                ))}
              </select>
              <span className="ui-help">{t('timezoneHelp')}</span>
            </label>
          </div>
          {canManage && (
            <div className="an-row">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {tc('save')}
              </button>
              {msg && (
                <span className={msg.ok ? 'an-saved' : 'ui-error'} role={msg.ok ? 'status' : 'alert'}>
                  {msg.text}
                </span>
              )}
            </div>
          )}
        </fieldset>
      </form>

      <InternalFilters project={project} canManage={canManage} />
      <IntegrationGuides origin={origin} publicKey={project.publicKey} />
      <ReplaySettings project={project} canManage={canManage} />

      {canManage && (
        <section className="ui-section ui-section-danger" aria-labelledby="an-danger">
          <div className="ui-section-head">
            <h2 id="an-danger" className="ui-section-title">
              {t('deleteTitle')}
            </h2>
            <p className="ui-section-desc">{t('deleteDesc')}</p>
          </div>
          <div className="ui-section-body">
            <button type="button" className="btn btn-danger btn-sm" onClick={() => setDeleting(true)}>
              {t('deleteButton')}
            </button>
          </div>
        </section>
      )}
      <ConfirmDialog
        open={deleting}
        title={t('deleteConfirm', { name: project.name })}
        body={t('deleteDesc')}
        confirmLabel={t('deleteButton')}
        cancelLabel={tc('cancel')}
        danger
        busy={busy}
        onCancel={() => setDeleting(false)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api(`/api/analytics/projects/${project.id}`, { method: 'DELETE' });
            notifyChanged();
            router.replace('/app/analytics/projects');
            router.refresh();
          } catch {
            setBusy(false);
            setDeleting(false);
            setMsg({ ok: false, text: tc('error') });
          }
        }}
      />
    </div>
  );
}

/** Quién es gente interna o de prueba: se saca de los insights que lo piden. */
function InternalFilters({ project, canManage }: { project: ProjectDto; canManage: boolean }) {
  const t = useTranslations('analytics.settings');
  const tc = useTranslations('analytics.common');
  const router = useRouter();
  const meta = useProjectMeta(project.id);
  const [filters, setFilters] = useState<PropertyFilter[]>(project.testFilters);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/analytics/projects/${project.id}`, { method: 'PATCH', body: { testFilters: cleanFilters(filters) } });
      setMsg({ ok: true, text: t('saved') });
      router.refresh();
    } catch {
      setMsg({ ok: false, text: tc('error') });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="ui-section" aria-labelledby="an-internal-title" id="an-internal">
      <div className="ui-section-head">
        <h2 id="an-internal-title" className="ui-section-title">
          {t('internalTitle')}
        </h2>
        <p className="ui-section-desc">{canManage ? t('internalDesc') : t('adminsOnly')}</p>
      </div>
      <fieldset className="ui-section-body ui-fields" disabled={!canManage}>
        <p className="an-note">{t('internalExample')}</p>
        <FilterList filters={filters} onChange={setFilters} meta={meta} />
        {canManage && (
          <div className="an-row">
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void save()}>
              {tc('save')}
            </button>
            {msg && (
              <span className={msg.ok ? 'an-saved' : 'ui-error'} role={msg.ok ? 'status' : 'alert'}>
                {msg.text}
              </span>
            )}
          </div>
        )}
      </fieldset>
    </section>
  );
}

/** Guías: proxy inverso, SDKs de PostHog apuntados acá y flags evaluados en tu servidor. */
function IntegrationGuides({ origin, publicKey }: { origin: string; publicKey: string }) {
  const t = useTranslations('analytics.settings');
  const host = origin || 'https://zerosoft.ai';
  const hostName = host.replace(/^https?:\/\//, '');
  const nextProxy = `// next.config.js\nasync rewrites() {\n  return [\n    { source: '/z/zs.js', destination: '${host}/zs.js' },\n    { source: '/z/zs-replay.js', destination: '${host}/zs-replay.js' },\n    { source: '/z/api/ingest/:path*', destination: '${host}/api/ingest/:path*' },\n  ];\n}`;
  const nginx = `# Only the snippet and ingest, not the whole app.\nlocation ~ ^/z/(zs\\.js|zs-replay\\.js|api/ingest/.*)$ {\n  proxy_pass ${host}/$1$is_args$args;\n  proxy_set_header Host ${hostName};\n  proxy_ssl_server_name on;\n}`;
  const useProxy = `<script src="/z/zs.js" defer></script>\n<script>\n  window.zs = window.zs || [];\n  zs.push(['init', '${publicKey}', { api_host: location.origin + '/z' }]);\n</script>`;
  const node = `import { PostHog } from 'posthog-node';\n\nconst client = new PostHog('${publicKey}', { host: '${host}/api/ingest' });\nclient.capture({ distinctId: 'user-123', event: 'order_paid', properties: { total: 42 } });\nawait client.shutdown();`;
  const defs = `curl ${host}/api/ingest/flag-definitions \\\n  -H "Authorization: Bearer zss_…"`;
  return (
    <section className="ui-section" aria-labelledby="an-guides">
      <div className="ui-section-head">
        <h2 id="an-guides" className="ui-section-title">
          {t('guidesTitle')}
        </h2>
        <p className="ui-section-desc">{t('guidesDesc')}</p>
      </div>
      <div className="ui-section-body">
        <h3 className="an-h4">{t('proxyTitle')}</h3>
        <p className="an-note">{t('proxyDesc')}</p>
        <CopyBlock code={nextProxy} label={t('proxyNext')} />
        <CopyBlock code={nginx} label={t('proxyNginx')} />
        <CopyBlock code={useProxy} label={t('proxyUse')} />
        <h3 className="an-h4">{t('cookielessTitle')}</h3>
        <p className="an-note">{t('cookielessDesc')}</p>
        <CopyBlock code={`zs.push(['init', '${publicKey}', { cookieless_mode: 'always' }]);\n\n// With a cookie banner: nothing until the person decides.\nzs.push(['init', '${publicKey}', { cookieless_mode: 'on_reject' }]);\nzs.optIn();  // accepts\nzs.optOut(); // rejects: stays without cookies`} label={t('cookielessTitle')} />
        <h3 className="an-h4">{t('sdkTitle')}</h3>
        <p className="an-note">{t('sdkDesc')}</p>
        <CopyBlock code={node} label={t('sdkTitle')} />
        <h3 className="an-h4">{t('localEvalTitle')}</h3>
        <p className="an-note">{t('localEvalDesc')}</p>
        <CopyBlock code={defs} label={t('localEvalTitle')} />
      </div>
    </section>
  );
}
