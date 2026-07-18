'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { ApiKeyDto } from '@/lib/api-auth';
import CopyButton from './CopyButton';

interface ApiKeysPanelProps {
  initialKeys: ApiKeyDto[];
}

function formatTs(iso: string | null, locale: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
    new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z'),
  );
}

/** Create (shows the full key once), list and revoke API keys. */
export default function ApiKeysPanel({ initialKeys }: ApiKeysPanelProps) {
  const t = useTranslations('link');
  const locale = useLocale();
  const [keys, setKeys] = useState<ApiKeyDto[]>(initialKeys);
  const [name, setName] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (res.status === 201) {
        const data = (await res.json()) as { id: string; key: string };
        setNewKey(data.key);
        setKeys((prev) => [
          {
            id: data.id,
            name: name.trim(),
            prefix: data.key.slice(0, 10),
            created_at: new Date().toISOString(),
            last_used_at: null,
          },
          ...prev,
        ]);
        setName('');
      }
    } catch {
      // Network error; leave form as-is.
    }
    setBusy(false);
  }

  async function onRevoke(id: string) {
    setBusy(true);
    const res = await fetch(`/api/keys/${id}`, { method: 'DELETE' }).catch(() => null);
    if (res && res.status === 204) setKeys((prev) => prev.filter((k) => k.id !== id));
    setBusy(false);
  }

  return (
    <div className="apikeys">
      <p className="muted apikeys-desc">
        {t('settings.apiKeysDesc')} <span className="mono">{t('settings.rateNote')}</span>
      </p>

      <form className="apikeys-create" onSubmit={onCreate}>
        <input
          className="input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('settings.keyNamePlaceholder')}
          aria-label={t('settings.keyName')}
          maxLength={80}
        />
        <button type="submit" className="btn btn-solid btn-small" disabled={busy || !name.trim()}>
          {busy ? t('settings.creating') : t('settings.createKey')}
        </button>
      </form>

      {newKey && (
        <div className="key-reveal">
          <p className="label">{t('settings.keyCreatedTitle')}</p>
          <div className="key-reveal-row">
            <code className="mono key-value">{newKey}</code>
            <CopyButton text={newKey} />
          </div>
          <p className="key-warning mono">{t('settings.keyWarning')}</p>
        </div>
      )}

      {keys.length === 0 ? (
        <p className="muted">{t('settings.noKeys')}</p>
      ) : (
        <table className="table keys-table">
          <thead>
            <tr>
              <th>{t('settings.colPrefix')}</th>
              <th>{t('settings.colName')}</th>
              <th>{t('settings.colCreated')}</th>
              <th>{t('settings.colLastUsed')}</th>
              <th aria-label="" />
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key.id}>
                <td className="mono">{key.prefix}…</td>
                <td>{key.name}</td>
                <td className="mono muted">{formatTs(key.created_at, locale)}</td>
                <td className="mono muted">
                  {key.last_used_at ? formatTs(key.last_used_at, locale) : t('settings.never')}
                </td>
                <td className="td-actions">
                  <button
                    type="button"
                    className="icon-btn danger"
                    onClick={() => onRevoke(key.id)}
                    disabled={busy}
                  >
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
