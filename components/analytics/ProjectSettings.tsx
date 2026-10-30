'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { ProjectDto } from '@/lib/analytics/types';
import { ApiError, api, notifyChanged } from './client';

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
  const router = useRouter();
  const [origin, setOrigin] = useState('https://zerosoft.ai');
  useEffect(() => setOrigin(window.location.origin), []);
  const [form, setForm] = useState({
    name: project.name,
    domains: project.allowedDomains.join('\n'),
    respectDnt: project.respectDnt,
    anonymizeIp: project.anonymizeIp,
    autocapture: project.autocapture,
    retentionDays: project.retentionDays,
    tzOffsetMin: project.tzOffsetMin,
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
      anonymizeIp: project.anonymizeIp,
      autocapture: project.autocapture,
      retentionDays: project.retentionDays,
      tzOffsetMin: project.tzOffsetMin,
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
          anonymizeIp: form.anonymizeIp,
          autocapture: form.autocapture,
          retentionDays: form.retentionDays,
          tzOffsetMin: form.tzOffsetMin,
        },
      });
      setMsg({ ok: true, text: t('saved') });
      notifyChanged();
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? tc('errorCode', { code: err.code }) : tc('error') });
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
            <input type="checkbox" checked={form.respectDnt} onChange={(e) => setForm({ ...form, respectDnt: e.target.checked })} /> {t('respectDnt')}
          </label>
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
              <select className="select" value={form.tzOffsetMin} onChange={(e) => setForm({ ...form, tzOffsetMin: Number(e.target.value) })}>
                {Array.from({ length: 27 }, (_, i) => (i - 12) * 60).map((m) => (
                  <option key={m} value={m}>
                    UTC{m >= 0 ? '+' : '−'}
                    {Math.abs(m / 60)}
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
