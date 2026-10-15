'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import type { TrackLabel } from '@/lib/track-labels';
import type { GithubConfig } from '@/lib/track-github';

const LABEL_COLORS = ['#666666', '#d14343', '#d9822b', '#3f8f4f', '#2f6fd1', '#7a4fd1'];

async function send<T>(url: string, method: string, body?: unknown): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, data };
}

/** Labels del workspace: crear, renombrar, cambiar color y borrar (admin). */
export function LabelsSettings({ isAdmin }: { isAdmin: boolean }) {
  const t = useTranslations('track');
  const [labels, setLabels] = useState<TrackLabel[] | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(LABEL_COLORS[0]);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = async () => {
    const res = await send<{ rows: TrackLabel[] }>('/api/track/labels?counts=1', 'GET');
    setLabels(res.ok ? res.data.rows : []);
  };
  useEffect(() => {
    void load();
  }, []);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    const res = await send<TrackLabel>('/api/track/labels', 'POST', { name: name.trim(), color });
    if (!res.ok) {
      setError(res.status === 409 ? t('labelsSettings.duplicate') : t('labelsSettings.error'));
      return;
    }
    setName('');
    await load();
  };

  const patch = async (id: string, body: { name?: string; color?: string }) => {
    setError(null);
    const res = await send<TrackLabel>(`/api/track/labels/${id}`, 'PATCH', body);
    if (!res.ok) setError(res.status === 409 ? t('labelsSettings.duplicate') : t('labelsSettings.error'));
    await load();
  };

  const remove = async (id: string) => {
    const res = await send(`/api/track/labels/${id}`, 'DELETE');
    if (!res.ok) setError(res.status === 403 ? t('labelsSettings.adminOnly') : t('labelsSettings.error'));
    setDeleting(null);
    await load();
  };

  return (
    <section className="track-settings-section" data-testid="track-labels-settings">
      <h2 className="track-settings-title">{t('labelsSettings.title')}</h2>
      <p className="muted track-settings-help">{t('labelsSettings.help')}</p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {labels && labels.length === 0 && <p className="muted">{t('labelsSettings.empty')}</p>}
      <ul className="track-status-list">
        {(labels ?? []).map((l) => (
          <li key={l.id} className="track-status-item" data-testid="track-label-row">
            <input
              type="color"
              className="track-status-color"
              defaultValue={/^#[0-9a-f]{6}$/i.test(l.color) ? l.color : '#666666'}
              onBlur={(e) => {
                if (e.target.value !== l.color) void patch(l.id, { color: e.target.value });
              }}
              aria-label={t('labelsSettings.color')}
            />
            <input
              className="track-status-name"
              defaultValue={l.name}
              maxLength={50}
              aria-label={t('labelsSettings.name')}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== l.name) void patch(l.id, { name: v });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />
            <span className="muted mono track-settings-count">
              {t('labelsSettings.issues', { count: l.issue_count ?? 0 })}
            </span>
            {isAdmin && (
              <button type="button" className="btn btn-small" onClick={() => setDeleting(l.id)}>
                {t('labelsSettings.delete')}
              </button>
            )}
            {deleting === l.id && (
              <div className="track-status-delete" role="group" aria-label={t('labelsSettings.confirmDelete')}>
                <span>{t('labelsSettings.deleteHelp', { count: l.issue_count ?? 0 })}</span>
                <button type="button" className="btn btn-small btn-solid" onClick={() => void remove(l.id)}>
                  {t('labelsSettings.confirmDelete')}
                </button>
                <button type="button" className="btn btn-small" onClick={() => setDeleting(null)}>
                  {t('common.cancel')}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <form className="track-status-add" onSubmit={add}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('labelsSettings.newPlaceholder')}
          aria-label={t('labelsSettings.newPlaceholder')}
          maxLength={50}
          data-testid="track-label-new"
        />
        <span className="track-color-swatches" role="radiogroup" aria-label={t('labelsSettings.color')}>
          {LABEL_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={c}
              className={`track-color-swatch${color === c ? ' is-active' : ''}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </span>
        <button type="submit" className="btn btn-small btn-solid" disabled={!name.trim()}>
          {t('labelsSettings.add')}
        </button>
      </form>
    </section>
  );
}

function CopyField({ label, value, testId }: { label: string; value: string; testId?: string }) {
  const t = useTranslations('track');
  const [copied, setCopied] = useState(false);
  return (
    <div className="track-copy-field">
      <span className="section-label">{label}</span>
      <div className="track-copy-row">
        <code className="mono" data-testid={testId}>
          {value}
        </code>
        <button
          type="button"
          className="btn btn-small"
          onClick={() => {
            void navigator.clipboard?.writeText(value).catch(() => undefined);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? t('github.copied') : t('github.copy')}
        </button>
      </div>
    </div>
  );
}

/** Webhook de GitHub del workspace. */
export function GithubSettings({ isAdmin, locale }: { isAdmin: boolean; locale: string }) {
  const t = useTranslations('track');
  const [config, setConfig] = useState<GithubConfig | null | undefined>(undefined);
  const [repos, setRepos] = useState('');
  const [onPrOpen, setOnPrOpen] = useState<'in_progress' | 'none'>('in_progress');
  const [onPrMerge, setOnPrMerge] = useState<'done' | 'none'>('done');
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    setOrigin(window.location.origin);
    void (async () => {
      const res = await send<{ config: GithubConfig | null }>('/api/track/github', 'GET');
      const c = res.ok ? res.data.config : null;
      setConfig(c);
      if (c) {
        setRepos(c.repos.join('\n'));
        setOnPrOpen(c.onPrOpen);
        setOnPrMerge(c.onPrMerge);
      }
    })();
  }, []);

  const save = async (regenerateSecret = false) => {
    // Regenerar invalida en el acto el secret configurado en GitHub.
    if (regenerateSecret && !window.confirm(t('github.regenerateConfirm'))) return;
    setBusy(true);
    setError(null);
    const list = repos
      .split(/[\n,]/)
      .map((r) => r.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, ''))
      .filter(Boolean);
    try {
      const res = await send<{ config: GithubConfig; secret: string | null; error?: string }>('/api/track/github', 'PUT', {
        repos: list,
        onPrOpen,
        onPrMerge,
        regenerateSecret,
      });
      if (!res.ok) {
        setError(
          res.status === 403 ? t('github.adminOnly') : res.data.error === 'invalid_repo' ? t('github.invalidRepo') : t('github.error'),
        );
        return;
      }
      setConfig(res.data.config);
      setRepos(res.data.config.repos.join('\n'));
      if (res.data.secret) setSecret(res.data.secret);
    } catch {
      setError(t('github.error'));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm(t('github.disconnectConfirm'))) return;
    setBusy(true);
    setError(null);
    try {
      const res = await send('/api/track/github', 'DELETE');
      if (!res.ok) {
        setError(res.status === 403 ? t('github.adminOnly') : t('github.error'));
        return;
      }
      setConfig(null);
      setSecret(null);
    } catch {
      setError(t('github.error'));
    } finally {
      setBusy(false);
    }
  };

  if (config === undefined) return null;

  return (
    <section className="track-settings-section" data-testid="track-github-settings">
      <h2 className="track-settings-title">{t('github.title')}</h2>
      <p className="muted track-settings-help">{t('github.help')}</p>
      <p className="muted track-settings-help">{t('github.moveHelp')}</p>
      {config && (
        <div className="track-github-hook">
          <p className="muted track-settings-help">{t('github.steps')}</p>
          <CopyField label={t('github.webhookUrl')} value={`${origin}/api/track/github/webhook/${config.id}`} testId="track-github-url" />
          {secret ? (
            <>
              <CopyField label={t('github.secret')} value={secret} testId="track-github-secret" />
              <p className="track-settings-note">{t('github.secretOnce')}</p>
            </>
          ) : (
            <div className="track-copy-field">
              <span className="section-label">{t('github.secret')}</span>
              <p className="muted track-settings-help">{t('github.secretHidden')}</p>
            </div>
          )}
          <p className="muted mono track-settings-help">
            {config.lastDeliveryAt
              ? t('github.lastDelivery', {
                  date: new Date(`${config.lastDeliveryAt.replace(' ', 'T')}Z`).toLocaleString(locale),
                })
              : t('github.noDelivery')}
          </p>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <fieldset className="track-github-form" disabled={!isAdmin || busy}>
        <label className="track-field">
          <span className="section-label">{t('github.repos')}</span>
          <textarea
            rows={3}
            value={repos}
            onChange={(e) => setRepos(e.target.value)}
            placeholder={t('github.reposPlaceholder')}
            data-testid="track-github-repos"
          />
          <span className="muted track-settings-help">{t('github.reposHelp')}</span>
        </label>
        <label className="track-field">
          <span className="section-label">{t('github.onOpen')}</span>
          <select value={onPrOpen} onChange={(e) => setOnPrOpen(e.target.value as 'in_progress' | 'none')}>
            <option value="in_progress">{t('github.onOpenMove')}</option>
            <option value="none">{t('github.doNothing')}</option>
          </select>
        </label>
        <label className="track-field">
          <span className="section-label">{t('github.onMerge')}</span>
          <select value={onPrMerge} onChange={(e) => setOnPrMerge(e.target.value as 'done' | 'none')}>
            <option value="done">{t('github.onMergeMove')}</option>
            <option value="none">{t('github.doNothing')}</option>
          </select>
        </label>
        <div className="track-form-actions">
          <button type="button" className="btn btn-small btn-solid" onClick={() => void save()} disabled={!repos.trim()}>
            {config ? t('github.save') : t('github.connect')}
          </button>
          {config && (
            <>
              <button type="button" className="btn btn-small" onClick={() => void save(true)}>
                {t('github.regenerate')}
              </button>
              <button type="button" className="btn btn-small" onClick={() => void disconnect()}>
                {t('github.disconnect')}
              </button>
            </>
          )}
        </div>
      </fieldset>
      {!isAdmin && <p className="muted track-settings-help">{t('github.adminOnly')}</p>}
    </section>
  );
}
