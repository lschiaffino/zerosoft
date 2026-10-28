'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import FormSection from '@/components/ui/FormSection';
import EmptyState from '@/components/ui/EmptyState';
import CopyButton from './CopyButton';

export interface DomainView {
  id: string;
  hostname: string;
  verified: number;
  root_url: string | null;
  not_found_url: string | null;
  expired_url: string | null;
  dns: Array<{ type: string; name: string; value: string }>;
}

/** Dominios propios para links cortos: alta, instrucciones DNS, verificación y baja. */
export default function DomainsPanel({ initial, canManage }: { initial: DomainView[]; canManage: boolean }) {
  const t = useTranslations('link');
  const [rows, setRows] = useState(initial);
  const [hostname, setHostname] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Record<string, { text: string; tone: 'ok' | 'error' | 'info' }>>({});

  function errorText(code: string | undefined) {
    return code && t.has(`domains.errors.${code}`) ? t(`domains.errors.${code}`) : t('errors.generic');
  }

  async function add(): Promise<string | void> {
    const res = await fetch('/api/links/domains', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hostname: hostname.trim().toLowerCase() }),
    }).catch(() => null);
    if (res?.status === 201) {
      const row = (await res.json()) as DomainView;
      setRows((prev) => [...prev, row]);
      setHostname('');
      return;
    }
    const data = res ? ((await res.json().catch(() => null)) as { error?: string; dns?: Array<{ name: string; value: string }> } | null) : null;
    // Pendiente en otro workspace: el TXT que prueba que es tuyo va en el mensaje.
    if (data?.error === 'domain_pending_elsewhere' && data.dns?.[0]) {
      return t('domains.errors.domain_pending_elsewhere', { name: data.dns[0].name, value: data.dns[0].value });
    }
    return errorText(data?.error);
  }

  async function verify(id: string) {
    setBusy(id);
    const res = await fetch(`/api/links/domains/${id}/verify`, { method: 'POST' }).catch(() => null);
    const data = res?.ok ? ((await res.json()) as { verified: boolean; reason?: string }) : null;
    setBusy(null);
    if (data?.verified) {
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, verified: 1 } : r)));
      setNotice((n) => ({ ...n, [id]: { text: t('domains.verifiedNow'), tone: 'ok' } }));
    } else {
      setNotice((n) => ({
        ...n,
        [id]: { text: data?.reason === 'txt_missing' ? t('domains.txtMissing') : t('domains.notYet'), tone: 'info' },
      }));
    }
  }

  async function remove(id: string, host: string) {
    if (!window.confirm(t('domains.removeConfirm', { hostname: host }))) return;
    setBusy(id);
    const res = await fetch(`/api/links/domains/${id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(null);
    if (res?.status === 204) {
      setRows((prev) => prev.filter((r) => r.id !== id));
      return;
    }
    const code = res ? ((await res.json().catch(() => null)) as { error?: string } | null)?.error : undefined;
    setNotice((n) => ({ ...n, [id]: { text: errorText(code), tone: 'error' } }));
  }

  async function saveRedirects(id: string, form: HTMLFormElement) {
    setBusy(`root-${id}`);
    const read = (name: string) => (form.elements.namedItem(name) as HTMLInputElement).value.trim() || null;
    const urls = { rootUrl: read('root'), notFoundUrl: read('notFound'), expiredUrl: read('expired') };
    const res = await fetch(`/api/links/domains/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(urls),
    }).catch(() => null);
    setBusy(null);
    if (res?.ok) {
      setRows((prev) =>
        prev.map((r) =>
          r.id === id ? { ...r, root_url: urls.rootUrl, not_found_url: urls.notFoundUrl, expired_url: urls.expiredUrl } : r,
        ),
      );
      setNotice((n) => ({ ...n, [id]: { text: t('domains.rootSaved'), tone: 'ok' } }));
      return;
    }
    const code = res ? ((await res.json().catch(() => null)) as { error?: string } | null)?.error : undefined;
    setNotice((n) => ({
      ...n,
      [id]: { text: code === 'self_link' || code === 'unsafe_url' ? errorText(code) : t('domains.errors.invalid_url'), tone: 'error' },
    }));
  }

  const addForm = canManage && (
    <FormSection
      title={t('domains.addTitle')}
      description={t('domains.desc')}
      onSubmit={add}
      submitLabel={t('domains.add')}
      disabled={!hostname.trim()}
      className="lk-form"
    >
      <div className="ui-field">
        <label className="label" htmlFor="domain-host">
          {t('domains.hostname')}
        </label>
        <input
          id="domain-host"
          className="input mono lk-input-md"
          value={hostname}
          onChange={(e) => setHostname(e.target.value)}
          placeholder="go.example.com"
          autoComplete="off"
          spellCheck={false}
          inputMode="url"
        />
      </div>
    </FormSection>
  );

  // Con dominios, primero la lista; el alta va abajo.
  return (
    <>
      {rows.length === 0 && addForm}

      <section className="lk-domains" aria-labelledby="domains-list-title">
        <h2 className="lk-h" id="domains-list-title">
          {t('domains.listTitle')}
        </h2>
        {rows.length === 0 ? (
          <EmptyState title={t('domains.empty')} body={t('domains.emptyBody')} product="link" />
        ) : (
          <ul className="lk-domain-list">
            {rows.map((d) => (
              <li key={d.id} className="panel lk-domain">
                <div className="lk-domain-head">
                  <span className="data lk-domain-host">{d.hostname}</span>
                  <span className={`badge ${d.verified ? 'badge-ok' : 'badge-warn'}`}>
                    {d.verified ? t('domains.verified') : t('domains.pending')}
                  </span>
                  {canManage && (
                    <span className="lk-domain-actions">
                      {!d.verified && (
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={() => verify(d.id)}
                          disabled={busy === d.id}
                          aria-busy={busy === d.id || undefined}
                        >
                          {t('domains.verify')}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost btn-danger"
                        onClick={() => remove(d.id, d.hostname)}
                        disabled={busy === d.id}
                      >
                        {t('domains.remove')}
                      </button>
                    </span>
                  )}
                </div>

                {!d.verified && (
                  <div className="lk-domain-dns">
                    <p className="ui-help">{t('domains.dnsHelp')}</p>
                    <div className="table-wrap">
                      <table className="table table-compact">
                        <caption className="sr-only">{t('domains.dnsCaption', { hostname: d.hostname })}</caption>
                        <thead>
                          <tr>
                            <th scope="col">{t('domains.type')}</th>
                            <th scope="col">{t('domains.name')}</th>
                            <th scope="col">{t('domains.value')}</th>
                            <th scope="col">
                              <span className="sr-only">{t('common.copy')}</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.dns.map((r) => (
                            <tr key={`${r.type}-${r.name}`}>
                              <td className="data">{r.type}</td>
                              <td className="data">{r.name}</td>
                              <td className="data lk-dns-value">{r.value}</td>
                              <td className="num">
                                <CopyButton text={r.value} className="btn btn-sm btn-ghost" iconOnly />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {d.verified === 1 && canManage && (
                  <form
                    className="lk-domain-root"
                    aria-label={t('domains.redirectsTitle', { hostname: d.hostname })}
                    onSubmit={(e) => {
                      e.preventDefault();
                      void saveRedirects(d.id, e.currentTarget);
                    }}
                  >
                    {(
                      [
                        ['root', 'root', d.root_url, t('domains.root'), t('domains.rootPlaceholder')],
                        ['notFound', 'nf', d.not_found_url, t('domains.notFound'), t('domains.notFoundPlaceholder')],
                        ['expired', 'exp', d.expired_url, t('domains.expired'), t('domains.expiredPlaceholder')],
                      ] as const
                    ).map(([name, prefix, value, label, placeholder]) => (
                      <div className="ui-field" key={name}>
                        <label className="label" htmlFor={`${prefix}-${d.id}`}>
                          {label}
                        </label>
                        <input
                          id={`${prefix}-${d.id}`}
                          name={name}
                          className="input"
                          type="url"
                          defaultValue={value ?? ''}
                          placeholder={placeholder}
                        />
                      </div>
                    ))}
                    <p className="ui-help">{t('domains.redirectsHelp')}</p>
                    <div>
                      <button type="submit" className="btn" aria-busy={busy === `root-${d.id}` || undefined}>
                        {t('domains.saveRoot')}
                      </button>
                    </div>
                  </form>
                )}
                {notice[d.id] && (
                  <p
                    className={notice[d.id].tone === 'error' ? 'ui-error' : notice[d.id].tone === 'ok' ? 'ui-help lk-ok' : 'ui-help'}
                    role={notice[d.id].tone === 'error' ? 'alert' : 'status'}
                  >
                    {notice[d.id].text}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {rows.length > 0 && addForm}
    </>
  );
}
