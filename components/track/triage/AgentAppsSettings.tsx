'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import FormSection from '@/components/ui/FormSection';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { AgentAppDto } from '@/lib/track-agents';
import { call } from './api';

/**
 * Ajustes de Track › Agentes: agentes externos que trabajan issues (protocolo
 * tipo Linear for Agents). Al delegar un issue reciben un webhook firmado y
 * responden por la API con su token. Los agentes de la app Agents aparecen
 * solos en el selector del issue.
 */
export default function AgentAppsSettings({ isAdmin }: { isAdmin: boolean }) {
  const t = useTranslations('trackTriage.agents');
  const [rows, setRows] = useState<AgentAppDto[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [created, setCreated] = useState<{ token: string; signingSecret: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string; webhookUrl: string } | null>(null);
  const [confirm, setConfirm] = useState<AgentAppDto | null>(null);

  const load = useCallback(async () => {
    const res = await call<{ rows: AgentAppDto[] }>('/api/track/agent-apps');
    if (res.ok) {
      setRows(res.data.rows);
      setLoadError(false);
    } else setLoadError(true);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const urlError = (code: string) =>
    code === 'https_required' ? t('httpsRequired') : code === 'private_host' || code === 'unresolvable_host' || code === 'invalid_url' ? t('invalidUrl') : t('saveError');

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    const res = await call<{ app: AgentAppDto; token: string; signingSecret: string }>('/api/track/agent-apps', {
      method: 'POST',
      json: { name: name.trim(), webhookUrl: url.trim() },
    });
    setBusy(false);
    if (res.ok) {
      setCreated({ token: res.data.token, signingSecret: res.data.signingSecret, name: res.data.app.name });
      setName('');
      setUrl('');
      setRows((prev) => [...(prev ?? []), res.data.app].sort((a, b) => a.name.localeCompare(b.name)));
    } else setError(urlError(res.error));
  };

  const saveEdit = async () => {
    if (!editing || !editing.name.trim()) return;
    setBusy(true);
    setError(null);
    const res = await call<AgentAppDto>(`/api/track/agent-apps/${editing.id}`, { method: 'PATCH', json: { name: editing.name.trim(), webhookUrl: editing.webhookUrl.trim() } });
    setBusy(false);
    if (res.ok) {
      setRows((prev) => (prev ?? []).map((r) => (r.id === res.data.id ? res.data : r)));
      setEditing(null);
    } else setError(urlError(res.error));
  };

  const remove = async (app: AgentAppDto) => {
    setConfirm(null);
    const res = await call(`/api/track/agent-apps/${app.id}`, { method: 'DELETE' });
    if (res.ok) setRows((prev) => (prev ?? []).filter((r) => r.id !== app.id));
    else setError(t('saveError'));
  };

  return (
    <div data-testid="track-agent-apps">
      <FormSection title={t('settingsTitle')} description={t('settingsHelp')} footer={!isAdmin ? <span className="ui-section-note">{t('adminOnly')}</span> : undefined}>
        <div className="track-settings-block">
          {created && (
            <div className="track-x-secret" role="status" data-testid="track-agent-created">
              <p>{t('created', { name: created.name })}</p>
              <label className="ui-field">
                <span className="label">{t('token')}</span>
                <input className="input data" readOnly value={created.token} onFocus={(e) => e.currentTarget.select()} data-testid="track-agent-token" />
              </label>
              <label className="ui-field">
                <span className="label">{t('secret')}</span>
                <input className="input data" readOnly value={created.signingSecret} onFocus={(e) => e.currentTarget.select()} />
              </label>
              <button type="button" className="btn btn-sm" onClick={() => setCreated(null)}>
                {t('done')}
              </button>
            </div>
          )}
          {loadError ? (
            <p className="ui-error" role="alert">
              {t('loadError')}{' '}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()}>
                {t('retry')}
              </button>
            </p>
          ) : rows === null ? (
            <p className="ui-help">{t('loading')}</p>
          ) : rows.length === 0 ? (
            <p className="ui-help">{t('empty')}</p>
          ) : (
            <ul className="track-x-rules">
              {rows.map((r) =>
                editing?.id === r.id ? (
                  <li key={r.id} className="track-x-rule">
                    <form
                      className="track-x-inline track-x-grow"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void saveEdit();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          setEditing(null);
                        }
                      }}
                    >
                      <input className="input" aria-label={t('name')} value={editing.name} maxLength={80} autoFocus onChange={(e) => setEditing({ ...editing, name: e.target.value })} data-testid="track-agent-rename" />
                      <input className="input" aria-label={t('webhook')} value={editing.webhookUrl} maxLength={1000} onChange={(e) => setEditing({ ...editing, webhookUrl: e.target.value })} />
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>
                        {t('cancel')}
                      </button>
                      <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !editing.name.trim()}>
                        {t('save')}
                      </button>
                    </form>
                  </li>
                ) : (
                  <li key={r.id} className="track-x-rule" data-testid="track-agent-app">
                    <div className="track-x-rule-main">
                      <span className="track-x-rule-name">{r.name}</span>
                      <span className="ui-help">
                        {r.webhookUrl || t('noWebhook')} · <span className="data">zsa_…{r.tokenHint}</span>
                      </span>
                    </div>
                    {isAdmin && (
                      <span className="track-x-row-actions">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing({ id: r.id, name: r.name, webhookUrl: r.webhookUrl })}>
                          {t('edit')}
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => setConfirm(r)} data-testid="track-agent-app-delete">
                          {t('delete')}
                        </button>
                      </span>
                    )}
                  </li>
                ),
              )}
            </ul>
          )}
          {isAdmin && (
            <form
              className="track-x-inline"
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <input className="input" aria-label={t('name')} placeholder={t('name')} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} data-testid="track-agent-app-name" />
              <input
                className="input track-x-grow"
                aria-label={t('webhook')}
                placeholder={t('webhookPlaceholder')}
                value={url}
                maxLength={1000}
                onChange={(e) => setUrl(e.target.value)}
                data-testid="track-agent-app-url"
              />
              <button type="submit" className="btn btn-sm btn-primary" disabled={busy || !name.trim()} data-testid="track-agent-app-create">
                {t('create')}
              </button>
            </form>
          )}
          {error && (
            <p className="ui-error" role="alert">
              {error}
            </p>
          )}
          <details className="track-x-docs">
            <summary>{t('docsTitle')}</summary>
            <p className="ui-help">{t('docs1')}</p>
            <pre className="data">{`POST /api/v1/track/agent-sessions/{id}/activities
Authorization: Bearer zsa_…
{ "type": "thought" | "action" | "elicitation" | "response" | "error", "body": "…" }

PATCH /api/v1/track/agent-sessions/{id}
{ "externalUrl": "https://…", "issueStatus": "in_progress" | "done" }`}</pre>
            <p className="ui-help">{t('docs2')}</p>
          </details>
        </div>
      </FormSection>
      <ConfirmDialog
        open={Boolean(confirm)}
        title={t('deleteTitle', { name: confirm?.name ?? '' })}
        body={t('deleteBody')}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        danger
        onConfirm={() => confirm && void remove(confirm)}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
