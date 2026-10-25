'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import FormSection from '@/components/ui/FormSection';
import AdvancedSection from '@/components/ui/AdvancedSection';
import EmptyState from '@/components/ui/EmptyState';
import type { TrackLabel } from '@/lib/track-labels';
import { invalidateWorkspaceLabels } from './LabelPicker';
import TrackIcon from './TrackIcon';
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

function SettingsSkeleton() {
  return (
    <div className="ui-loading-stack" aria-busy="true">
      <span className="ui-skeleton ui-skeleton-title" />
      <span className="ui-skeleton ui-skeleton-row" />
      <span className="ui-skeleton ui-skeleton-row" />
    </div>
  );
}

/** Labels del workspace: crear, renombrar, cambiar color y borrar (admin). */
export function LabelsSettings({ isAdmin }: { isAdmin: boolean }) {
  const t = useTranslations('track');
  const [labels, setLabels] = useState<TrackLabel[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(LABEL_COLORS[0]);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = async () => {
    const res = await send<{ rows: TrackLabel[] }>('/api/track/labels?counts=1', 'GET').catch(() => null);
    setLoadFailed(!res?.ok);
    setLabels(res?.ok ? res.data.rows : []);
    // Pickers y edición masiva leen otra caché: que la recarguen.
    invalidateWorkspaceLabels();
  };
  useEffect(() => {
    void load();
  }, []);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || adding) return;
    setError(null);
    setAdding(true);
    const res = await send<TrackLabel>('/api/track/labels', 'POST', { name: name.trim(), color }).catch(() => null);
    setAdding(false);
    if (!res?.ok) {
      setError(res?.status === 409 ? t('labelsSettings.duplicate') : t('labelsSettings.error'));
      return;
    }
    setName('');
    await load();
  };

  const patch = async (id: string, body: { name?: string; color?: string }): Promise<boolean> => {
    setError(null);
    const res = await send<TrackLabel>(`/api/track/labels/${id}`, 'PATCH', body).catch(() => null);
    if (!res?.ok) {
      setError(
        res?.status === 409
          ? t('labelsSettings.duplicate')
          : res?.status === 403
            ? t('labelsSettings.adminOnly')
            : t('labelsSettings.error'),
      );
    }
    await load();
    return Boolean(res?.ok);
  };

  const remove = async (id: string) => {
    const res = await send(`/api/track/labels/${id}`, 'DELETE').catch(() => null);
    if (!res?.ok) setError(res?.status === 403 ? t('labelsSettings.adminOnly') : t('labelsSettings.error'));
    setDeleting(null);
    await load();
  };

  return (
    <div data-testid="track-labels-settings">
    <FormSection
      title={t('labelsSettings.title')}
      description={t('labelsSettings.help')}
      footer={!isAdmin ? <span className="ui-section-note">{t('labelsSettings.adminOnly')}</span> : undefined}
    >
      <div className="track-settings-block">
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
        {labels === null ? (
          <SettingsSkeleton />
        ) : loadFailed ? (
          <EmptyState
            quiet
            title={t('labelsSettings.loadError')}
            action={
              <button type="button" className="btn btn-primary" onClick={() => void load()}>
                {t('common.retry')}
              </button>
            }
          />
        ) : labels.length === 0 ? (
          <p className="ui-help">{t('labelsSettings.empty')}</p>
        ) : (
          <ul className="track-status-list">
            {labels.map((l) => (
              <li key={l.id} className="track-status-item" data-testid="track-label-row">
                <input
                  type="color"
                  className="track-status-color"
                  defaultValue={/^#[0-9a-f]{6}$/i.test(l.color) ? l.color : '#666666'}
                  disabled={!isAdmin}
                  onBlur={(e) => {
                    const el = e.target;
                    if (el.value === l.color) return;
                    // Los inputs no son controlados: si el cambio se rechaza hay
                    // que volver al valor guardado a mano (load() no lo reaplica).
                    void patch(l.id, { color: el.value }).then((ok) => {
                      if (!ok) el.value = /^#[0-9a-f]{6}$/i.test(l.color) ? l.color : '#666666';
                    });
                  }}
                  aria-label={`${t('labelsSettings.color')}: ${l.name}`}
                />
                <input
                  className="input track-status-name"
                  defaultValue={l.name}
                  maxLength={50}
                  aria-label={t('labelsSettings.name')}
                  disabled={!isAdmin}
                  onBlur={(e) => {
                    const el = e.target;
                    const v = el.value.trim();
                    if (!v) el.value = l.name;
                    if (!v || v === l.name) return;
                    void patch(l.id, { name: v }).then((ok) => {
                      if (!ok) el.value = l.name;
                    });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  }}
                />
                <span className="track-settings-count">{t('labelsSettings.issues', { count: l.issue_count ?? 0 })}</span>
                {isAdmin && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm btn-icon btn-danger"
                    onClick={() => setDeleting(l.id)}
                    aria-label={`${t('labelsSettings.delete')}: ${l.name}`}
                    title={t('labelsSettings.delete')}
                  >
                    <TrackIcon name="close" />
                  </button>
                )}
                {deleting === l.id && (
                  <div className="track-status-delete" role="group" aria-label={t('labelsSettings.confirmDelete')}>
                    <span>{t('labelsSettings.deleteHelp', { count: l.issue_count ?? 0 })}</span>
                    <span className="track-inline-form-actions">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleting(null)}>
                        {t('common.cancel')}
                      </button>
                      <button type="button" className="btn btn-sm btn-primary btn-danger" onClick={() => void remove(l.id)}>
                        {t('labelsSettings.confirmDelete')}
                      </button>
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <form className="track-status-add" onSubmit={add}>
          <input
            className="input"
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
          <button type="submit" className="btn btn-sm" disabled={!name.trim()} aria-busy={adding || undefined}>
            {t('labelsSettings.add')}
          </button>
        </form>
      </div>
    </FormSection>
    </div>
  );
}

export function CopyField({ id, label, value, testId }: { id: string; label: string; value: string; testId?: string }) {
  const t = useTranslations('track');
  const [copied, setCopied] = useState(false);
  return (
    <div className="ui-field">
      <span className="label" id={`${id}-label`}>
        {label}
      </span>
      <div className="ui-input-group">
        <code className="input data track-copy-value" aria-labelledby={`${id}-label`} data-testid={testId}>
          {value}
        </code>
        <button
          type="button"
          className="btn track-copy-btn"
          onClick={() => {
            void navigator.clipboard?.writeText(value).catch(() => undefined);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
        >
          <span aria-live="polite">{copied ? t('github.copied') : t('github.copy')}</span>
        </button>
      </div>
    </div>
  );
}

/**
 * Webhook de GitHub del workspace. Sin conectar, es una sola línea con
 * "Conectar GitHub"; el formulario aparece al pedirlo. Conectado: datos del
 * webhook, repos (con su Guardar) y una zona para secret nuevo y desconectar.
 */
export function GithubSettings(props: { isAdmin: boolean; locale: string; example: string }) {
  return (
    <div data-testid="track-github-settings" className="ui-page">
      <GithubSettingsBody {...props} />
    </div>
  );
}

function GithubSettingsBody({ isAdmin, locale, example }: { isAdmin: boolean; locale: string; example: string }) {
  const t = useTranslations('track');
  // El ejemplo usa el prefijo real de un proyecto y no se corta entre líneas.
  const help = t.rich('github.help', { example, id: (chunks) => <span className="track-nowrap data">{chunks}</span> });
  const [config, setConfig] = useState<GithubConfig | null | undefined>(undefined);
  const [loadFailed, setLoadFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [repos, setRepos] = useState('');
  const [onPrOpen, setOnPrOpen] = useState<'in_progress' | 'none'>('in_progress');
  const [onPrMerge, setOnPrMerge] = useState<'done' | 'none'>('done');
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState('');

  const load = async () => {
    setLoadFailed(false);
    const res = await send<{ config: GithubConfig | null }>('/api/track/github', 'GET').catch(() => null);
    if (!res?.ok) {
      setLoadFailed(true);
      setConfig(null);
      return;
    }
    const c = res.data.config;
    setConfig(c);
    if (c) {
      setRepos(c.repos.join('\n'));
      setOnPrOpen(c.onPrOpen);
      setOnPrMerge(c.onPrMerge);
    }
  };

  useEffect(() => {
    setOrigin(window.location.origin);
    void load();
  }, []);

  const parseRepos = () =>
    repos
      .split(/[\n,]/)
      .map((r) => r.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, ''))
      .filter(Boolean);

  const save = async (regenerateSecret = false): Promise<string | void> => {
    if (!parseRepos().length) return t('github.reposRequired');
    const res = await send<{ config: GithubConfig; secret: string | null; error?: string }>('/api/track/github', 'PUT', {
      repos: parseRepos(),
      onPrOpen,
      onPrMerge,
      regenerateSecret,
    }).catch(() => null);
    if (!res?.ok) {
      return res?.status === 403
        ? t('github.adminOnly')
        : res?.data.error === 'invalid_repo'
          ? t('github.invalidRepo')
          : t('github.error');
    }
    setConfig(res.data.config);
    setRepos(res.data.config.repos.join('\n'));
    if (res.data.secret) setSecret(res.data.secret);
  };

  const regenerate = async () => {
    // Regenerar invalida en el acto el secret configurado en GitHub.
    if (!window.confirm(t('github.regenerateConfirm'))) return;
    setBusy(true);
    setError(null);
    const msg = await save(true);
    setBusy(false);
    if (msg) setError(msg);
  };

  const disconnect = async () => {
    if (!window.confirm(t('github.disconnectConfirm'))) return;
    setBusy(true);
    setError(null);
    const res = await send('/api/track/github', 'DELETE').catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(res?.status === 403 ? t('github.adminOnly') : t('github.error'));
      return;
    }
    setConfig(null);
    setSecret(null);
    setExpanded(false);
  };

  if (config === undefined) {
    return (
      <FormSection title={t('github.title')} description={help}>
        <SettingsSkeleton />
      </FormSection>
    );
  }

  if (loadFailed) {
    return (
      <FormSection title={t('github.title')} description={help}>
        <EmptyState
          quiet
          title={t('github.loadError')}
          action={
            <button type="button" className="btn btn-primary" onClick={() => void load()}>
              {t('common.retry')}
            </button>
          }
        />
      </FormSection>
    );
  }

  const fields = (
    <fieldset className="track-github-form" disabled={!isAdmin}>
      <div className="ui-field">
        <label className="label" htmlFor="gh-repos">
          {t('github.repos')}
        </label>
        <textarea
          id="gh-repos"
          name="repos"
          className="textarea data"
          rows={3}
          value={repos}
          onChange={(e) => setRepos(e.target.value)}
          placeholder={t('github.reposPlaceholder')}
          aria-describedby="gh-repos-help"
          data-testid="track-github-repos"
        />
        <p className="ui-help" id="gh-repos-help">
          {t('github.reposHelp')}
        </p>
      </div>
      <AdvancedSection storageKey="track.github" label={t('github.statusRules')} hint={t('github.statusRulesHint')}>
        <p className="ui-help">{t('github.moveHelp')}</p>
        <div className="ui-fields-2">
          <div className="ui-field">
            <label className="label" htmlFor="gh-open">
              {t('github.onOpen')}
            </label>
            <select
              id="gh-open"
              className="select"
              value={onPrOpen}
              onChange={(e) => setOnPrOpen(e.target.value as 'in_progress' | 'none')}
            >
              <option value="in_progress">{t('github.onOpenMove')}</option>
              <option value="none">{t('github.doNothing')}</option>
            </select>
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="gh-merge">
              {t('github.onMerge')}
            </label>
            <select
              id="gh-merge"
              className="select"
              value={onPrMerge}
              onChange={(e) => setOnPrMerge(e.target.value as 'done' | 'none')}
            >
              <option value="done">{t('github.onMergeMove')}</option>
              <option value="none">{t('github.doNothing')}</option>
            </select>
          </div>
        </div>
      </AdvancedSection>
    </fieldset>
  );

  if (!config) {
    if (!expanded) {
      return (
        <FormSection
          title={t('github.title')}
          description={help}
          footer={
            <>
              <span className="ui-section-note">{isAdmin ? t('github.notConnected') : t('github.adminOnly')}</span>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setExpanded(true)}
                disabled={!isAdmin}
                data-testid="track-github-start"
              >
                {t('github.connect')}
              </button>
            </>
          }
        >
          {null}
        </FormSection>
      );
    }
    return (
      <FormSection
        title={t('github.title')}
        description={help}
        onSubmit={() => save()}
        submitLabel={t('github.connect')}
        note={t('github.connectNote')}
        disabled={!isAdmin || !repos.trim()}
      >
        <div className="track-settings-block">{fields}</div>
      </FormSection>
    );
  }

  return (
    <>
      <FormSection title={t('github.webhookTitle')} description={t('github.steps')}>
        <div className="track-settings-block">
          <CopyField
            id="gh-url"
            label={t('github.webhookUrl')}
            value={`${origin}/api/track/github/webhook/${config.id}`}
            testId="track-github-url"
          />
          {secret ? (
            <>
              <CopyField id="gh-secret" label={t('github.secret')} value={secret} testId="track-github-secret" />
              <p className="ui-help track-settings-note" role="status">
                {t('github.secretOnce')}
              </p>
            </>
          ) : (
            <div className="ui-field">
              <span className="label">{t('github.secret')}</span>
              <p className="ui-help">{t('github.secretHidden')}</p>
            </div>
          )}
          <p className="ui-help">
            {config.lastDeliveryAt
              ? t('github.lastDelivery', {
                  date: new Date(`${config.lastDeliveryAt.replace(' ', 'T')}Z`).toLocaleString(locale),
                })
              : t('github.noDelivery')}
          </p>
        </div>
      </FormSection>

      <FormSection
        title={t('github.reposTitle')}
        onSubmit={() => save()}
        submitLabel={t('github.save')}
        note={isAdmin ? undefined : t('github.adminOnly')}
        disabled={!isAdmin || !repos.trim()}
      >
        {fields}
      </FormSection>

      <FormSection
        tone="danger"
        title={t('github.dangerTitle')}
        description={t('github.dangerHelp')}
        footer={
          <>
            <span className="ui-section-note" role={error ? 'alert' : undefined}>
              {error}
            </span>
            <span className="track-inline-form-actions">
              <button type="button" className="btn" onClick={() => void regenerate()} disabled={!isAdmin} aria-busy={busy || undefined}>
                {t('github.regenerate')}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-danger"
                onClick={() => void disconnect()}
                disabled={!isAdmin}
                aria-busy={busy || undefined}
              >
                {t('github.disconnect')}
              </button>
            </span>
          </>
        }
      />
    </>
  );
}
