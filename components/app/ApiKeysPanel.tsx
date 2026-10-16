'use client';

import { useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { ApiKeyDto } from '@/lib/api-auth';
import { API_SCOPES, type ApiScope } from '@/lib/api-scopes';
import CopyButton from '@/components/link/CopyButton';
import AdvancedSection from '@/components/ui/AdvancedSection';
import DataTable from '@/components/ui/DataTable';
import EmptyState from '@/components/ui/EmptyState';
import FormSection from '@/components/ui/FormSection';

function formatTs(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
    new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z'),
  );
}

/**
 * API keys: camino corto (nombre + Crear key, con todos los permisos) y los
 * permisos en Avanzado. La key completa se muestra una sola vez.
 */
export default function ApiKeysPanel({ initialKeys, isAdmin }: { initialKeys: ApiKeyDto[]; isAdmin: boolean }) {
  const t = useTranslations('settings.keys');
  const locale = useLocale();
  const [keys, setKeys] = useState<ApiKeyDto[]>(initialKeys);
  const [name, setName] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scopes, setScopes] = useState<ApiScope[]>([...API_SCOPES]);

  function toggleScope(scope: ApiScope) {
    setScopes((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : API_SCOPES.filter((s) => s === scope || prev.includes(s))));
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy || scopes.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), scopes }),
      });
      if (res.status !== 201) throw new Error(String(res.status));
      const data = (await res.json()) as { id: string; key: string; scopes: ApiScope[] };
      setNewKey(data.key);
      setKeys((prev) => [
        {
          id: data.id,
          name: name.trim(),
          prefix: data.key.slice(0, 10),
          created_at: new Date().toISOString(),
          last_used_at: null,
          scopes: data.scopes,
        },
        ...prev,
      ]);
      setName('');
    } catch {
      setError(t('error'));
    }
    setBusy(false);
  }

  async function onRevoke(key: ApiKeyDto) {
    if (!window.confirm(t('revokeConfirm', { name: key.name }))) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/keys/${key.id}`, { method: 'DELETE' }).catch(() => null);
    if (res?.status === 204) setKeys((prev) => prev.filter((k) => k.id !== key.id));
    else setError(t('revokeError'));
    setBusy(false);
  }

  const allScopes = scopes.length === API_SCOPES.length;

  return (
    <FormSection
      id="api-keys"
      title={t('title')}
      description={
        <>
          {t('desc')}{' '}
          <Link href="/docs" className="st-inline-link">
            {t('docs')}
          </Link>
        </>
      }
      footer={<p className="ui-section-note">{isAdmin ? t('noteAdmin') : t('noteMember')}</p>}
    >
      <form className="st-create" onSubmit={onCreate}>
        <div className="ui-field st-create-field">
          <label className="label" htmlFor="st-key-name">
            {t('name')}
          </label>
          <input
            id="st-key-name"
            className="input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('namePlaceholder')}
            maxLength={80}
            autoComplete="off"
          />
        </div>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!name.trim() || scopes.length === 0}
          aria-busy={busy || undefined}
        >
          {t('create')}
        </button>
      </form>

      <AdvancedSection
        storageKey="settings.keys.scopes"
        label={t('scopes')}
        hint={allScopes ? t('scopesAll') : t('scopesCount', { count: scopes.length, total: API_SCOPES.length })}
      >
        <fieldset className="st-fieldset">
          <legend className="ui-help">{t('scopesHelp')}</legend>
          <div className="st-checks">
            {API_SCOPES.map((scope) => (
              <label key={scope} className="ui-check">
                <input type="checkbox" checked={scopes.includes(scope)} onChange={() => toggleScope(scope)} />
                <span className="data">{scope}</span>
              </label>
            ))}
          </div>
          {scopes.length === 0 && <p className="ui-error">{t('scopesNone')}</p>}
        </fieldset>
      </AdvancedSection>

      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}

      {newKey && (
        <div className="st-reveal" role="status">
          <p className="label">{t('createdTitle')}</p>
          <div className="st-reveal-row">
            <code className="data st-secret">{newKey}</code>
            <CopyButton text={newKey} className="btn btn-secondary btn-sm" />
          </div>
          <p className="ui-help">{t('createdWarning')}</p>
        </div>
      )}

      <DataTable
        caption={t('title')}
        rows={keys}
        rowKey={(k) => k.id}
        compact
        empty={<EmptyState quiet title={t('emptyTitle')} body={t('emptyBody')} />}
        columns={[
          { key: 'name', header: t('colName'), cell: (k) => <span className="st-strong">{k.name}</span> },
          { key: 'prefix', header: t('colKey'), cell: (k) => `${k.prefix}…`, data: true },
          {
            key: 'scopes',
            header: t('colScopes'),
            cell: (k) => (k.scopes.length === API_SCOPES.length ? t('scopesAll') : <span className="data st-muted">{k.scopes.join(' ')}</span>),
          },
          { key: 'created', header: t('colCreated'), cell: (k) => formatTs(k.created_at, locale), data: true },
          {
            key: 'used',
            header: t('colLastUsed'),
            cell: (k) => (k.last_used_at ? formatTs(k.last_used_at, locale) : <span className="st-muted">{t('never')}</span>),
            data: true,
          },
          {
            key: 'actions',
            header: <span className="sr-only">{t('colActions')}</span>,
            cell: (k) => (
              <div className="st-row-actions">
                <button type="button" className="btn btn-ghost btn-danger btn-sm" onClick={() => onRevoke(k)} disabled={busy} aria-label={`${t('revoke')} ${k.name}`}>
                  {t('revoke')}
                </button>
              </div>
            ),
          },
        ]}
      />
    </FormSection>
  );
}
