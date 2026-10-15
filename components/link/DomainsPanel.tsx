'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

export interface DomainView {
  id: string;
  hostname: string;
  verified: number;
  root_url: string | null;
  dns: Array<{ type: string; name: string; value: string }>;
}

/** Dominios propios para links cortos: alta, instrucciones DNS, verificación y baja. */
export default function DomainsPanel({ initial, canManage }: { initial: DomainView[]; canManage: boolean }) {
  const t = useTranslations('link');
  const [rows, setRows] = useState(initial);
  const [hostname, setHostname] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Record<string, string>>({});

  function errorText(code: string | undefined) {
    return code && t.has(`domains.errors.${code}`) ? t(`domains.errors.${code}`) : t('errors.generic');
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy('add');
    setError(null);
    const res = await fetch('/api/links/domains', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hostname: hostname.trim().toLowerCase() }),
    }).catch(() => null);
    setBusy(null);
    if (res?.status === 201) {
      const row = (await res.json()) as DomainView;
      setRows((prev) => [...prev, row]);
      setHostname('');
      return;
    }
    setError(errorText(res ? ((await res.json().catch(() => null)) as { error?: string } | null)?.error : undefined));
  }

  async function verify(id: string) {
    setBusy(id);
    const res = await fetch(`/api/links/domains/${id}/verify`, { method: 'POST' }).catch(() => null);
    const data = res?.ok ? ((await res.json()) as { verified: boolean; reason?: string }) : null;
    setBusy(null);
    if (data?.verified) {
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, verified: 1 } : r)));
      setNotice((n) => ({ ...n, [id]: t('domains.verifiedNow') }));
    } else {
      setNotice((n) => ({ ...n, [id]: data?.reason === 'txt_missing' ? t('domains.txtMissing') : t('domains.notYet') }));
    }
  }

  async function remove(id: string) {
    setBusy(id);
    const res = await fetch(`/api/links/domains/${id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(null);
    if (res?.status === 204) {
      setRows((prev) => prev.filter((r) => r.id !== id));
      return;
    }
    const code = res ? ((await res.json().catch(() => null)) as { error?: string } | null)?.error : undefined;
    setNotice((n) => ({ ...n, [id]: errorText(code) }));
  }

  async function saveRoot(id: string, value: string) {
    const rootUrl = value.trim() || null;
    const res = await fetch(`/api/links/domains/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rootUrl }),
    }).catch(() => null);
    setNotice((n) => ({ ...n, [id]: res?.ok ? t('domains.rootSaved') : t('domains.errors.invalid_url') }));
  }

  return (
    <div className="apikeys">
      <p className="muted apikeys-desc">{t('domains.desc')}</p>
      {canManage && (
        <form className="apikeys-create" onSubmit={add}>
          <input
            className="input mono"
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            placeholder="go.example.com"
            aria-label={t('domains.hostname')}
          />
          <button type="submit" className="btn btn-solid btn-small" disabled={busy === 'add' || !hostname.trim()}>
            {t('domains.add')}
          </button>
        </form>
      )}
      {error && <p className="form-error">{error}</p>}

      {rows.length === 0 ? (
        <p className="muted">{t('domains.empty')}</p>
      ) : (
        <ul className="domain-list">
          {rows.map((d) => (
            <li key={d.id} className="domain-item">
              <div className="domain-head">
                <span className="mono">{d.hostname}</span>
                <span className={`badge ${d.verified ? 'status-active' : 'status-protected'}`}>
                  {d.verified ? t('domains.verified') : t('domains.pending')}
                </span>
                {canManage && (
                  <span className="domain-actions">
                    {!d.verified && (
                      <button type="button" className="btn btn-ghost btn-small" onClick={() => verify(d.id)} disabled={busy === d.id}>
                        {t('domains.verify')}
                      </button>
                    )}
                    <button type="button" className="icon-btn danger" onClick={() => remove(d.id)} disabled={busy === d.id}>
                      {t('domains.remove')}
                    </button>
                  </span>
                )}
              </div>
              {!d.verified && (
                <div className="domain-dns">
                  <p className="muted">{t('domains.dnsHelp')}</p>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{t('domains.type')}</th>
                        <th>{t('domains.name')}</th>
                        <th>{t('domains.value')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.dns.map((r) => (
                        <tr key={`${r.type}-${r.name}`}>
                          <td className="mono">{r.type}</td>
                          <td className="mono">{r.name}</td>
                          <td className="mono">{r.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {d.verified === 1 && canManage && (
                <form
                  className="apikeys-create"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const input = e.currentTarget.elements.namedItem('root') as HTMLInputElement;
                    void saveRoot(d.id, input.value);
                  }}
                >
                  <input
                    name="root"
                    className="input"
                    type="url"
                    defaultValue={d.root_url ?? ''}
                    placeholder={t('domains.rootPlaceholder')}
                    aria-label={t('domains.root')}
                  />
                  <button type="submit" className="btn btn-ghost btn-small">
                    {t('domains.saveRoot')}
                  </button>
                </form>
              )}
              {notice[d.id] && <p className="muted mono">{notice[d.id]}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
