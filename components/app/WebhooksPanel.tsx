'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { WebhookDto, WebhookEvent } from '@/lib/webhooks';
import CopyButton from '@/components/link/CopyButton';

interface Props {
  initial: WebhookDto[];
  events: readonly WebhookEvent[];
}

/** Webhooks del workspace: alta (secret visible una vez), prueba y baja. */
export default function WebhooksPanel({ initial, events }: Props) {
  const t = useTranslations('link');
  const [rows, setRows] = useState(initial);
  const [url, setUrl] = useState('');
  const [selected, setSelected] = useState<WebhookEvent[]>(['booking.created']);
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch('/api/webhooks').catch(() => null);
    if (res?.ok) setRows(((await res.json()) as { rows: WebhookDto[] }).rows);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/webhooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: url.trim(), events: selected }),
    }).catch(() => null);
    setBusy(false);
    if (res?.status === 201) {
      setSecret(((await res.json()) as { secret: string }).secret);
      setUrl('');
      await refresh();
      return;
    }
    const code = res ? ((await res.json().catch(() => null)) as { error?: string } | null)?.error : null;
    setError(code && t.has(`webhooks.errors.${code}`) ? t(`webhooks.errors.${code}`) : t('webhooks.errors.generic'));
  }

  async function test(id: string) {
    setBusy(true);
    await fetch(`/api/webhooks/${id}/test`, { method: 'POST' }).catch(() => null);
    await refresh();
    setBusy(false);
  }

  async function remove(id: string) {
    setBusy(true);
    const res = await fetch(`/api/webhooks/${id}`, { method: 'DELETE' }).catch(() => null);
    if (res?.status === 204) setRows((prev) => prev.filter((r) => r.id !== id));
    setBusy(false);
  }

  function toggle(ev: WebhookEvent) {
    setSelected((prev) => (prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]));
  }

  return (
    <div className="apikeys">
      <p className="muted apikeys-desc">{t('webhooks.desc')}</p>
      <form className="webhook-create" onSubmit={create}>
        <input
          className="input"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/webhooks/zerosoft"
          aria-label={t('webhooks.url')}
          required
        />
        <div className="webhook-events">
          {events.map((ev) => (
            <label key={ev} className="checkbox-field mono">
              <input type="checkbox" checked={selected.includes(ev)} onChange={() => toggle(ev)} />
              <span>{ev}</span>
            </label>
          ))}
        </div>
        <button type="submit" className="btn btn-solid btn-small" disabled={busy || !url.trim() || selected.length === 0}>
          {t('webhooks.add')}
        </button>
      </form>
      {error && <p className="form-error">{error}</p>}

      {secret && (
        <div className="key-reveal">
          <p className="label">{t('webhooks.secretTitle')}</p>
          <div className="key-reveal-row">
            <code className="mono key-value">{secret}</code>
            <CopyButton text={secret} />
          </div>
          <p className="key-warning mono">{t('webhooks.secretWarning')}</p>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="muted">{t('webhooks.empty')}</p>
      ) : (
        <table className="table keys-table">
          <thead>
            <tr>
              <th>{t('webhooks.url')}</th>
              <th>{t('webhooks.events')}</th>
              <th>{t('webhooks.last')}</th>
              <th aria-label="" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="mono">{r.url}</td>
                <td className="mono muted">{r.events.join(', ')}</td>
                <td className="mono muted">
                  {r.lastDelivery
                    ? `${r.lastDelivery.status}${r.lastDelivery.responseCode ? ` · ${r.lastDelivery.responseCode}` : ''}`
                    : '—'}
                </td>
                <td className="td-actions">
                  <button type="button" className="icon-btn" onClick={() => test(r.id)} disabled={busy}>
                    {t('webhooks.test')}
                  </button>
                  <button type="button" className="icon-btn danger" onClick={() => remove(r.id)} disabled={busy}>
                    {t('settings.revoke')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
