'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import type { AgentSecretHeaderDto } from '@/lib/agents-config';
import { api, errorText } from './agents-ui';

interface Props {
  agentId: string;
  headers: AgentSecretHeaderDto[];
  onChange: (headers: AgentSecretHeaderDto[]) => void;
  /** Dominios permitidos ya guardados (un header solo se manda a uno de ellos). */
  savedDomains: string[];
  /** Dominios del formulario (sin guardar todavía): avisa si un header queda huérfano. */
  draftDomains: string[];
  readOnly: boolean;
}

/**
 * Headers secretos de http_request (Authorization, X-Api-Key…). El valor se
 * cifra al guardar y no se vuelve a mostrar; el modelo nunca lo ve. Se guardan
 * aparte del Guardar del editor, al momento.
 */
export default function AgentSecretHeaders({ agentId, headers, onChange, savedDomains, draftDomains, readOnly }: Props) {
  const t = useTranslations('agents');
  const [name, setName] = useState('Authorization');
  const [domain, setDomain] = useState(savedDomains[0] ?? '');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const domainValue = savedDomains.includes(domain) ? domain : (savedDomains[0] ?? '');

  async function add(e: FormEvent) {
    e.preventDefault();
    if (busy || !value || !domainValue) return;
    setBusy(true);
    setError(null);
    const res = await api<{ headers?: AgentSecretHeaderDto[] }>(`/api/agents/${agentId}/secrets`, {
      method: 'POST',
      body: JSON.stringify({ name: name.trim(), domain: domainValue, value }),
    });
    setBusy(false);
    if (!res.ok || !res.data.headers) {
      setError(errorText(t, res.data.error));
      return;
    }
    // El valor no vuelve a la UI: se limpia el campo.
    setValue('');
    onChange(res.data.headers);
  }

  async function remove(h: AgentSecretHeaderDto) {
    if (!window.confirm(t('secrets.removeConfirm', { name: h.name, domain: h.domain }))) return;
    const res = await api<{ headers?: AgentSecretHeaderDto[] }>(`/api/agents/${agentId}/secrets/${h.id}`, { method: 'DELETE' });
    if (!res.ok || !res.data.headers) {
      setError(errorText(t, res.data.error));
      return;
    }
    onChange(res.data.headers);
  }

  return (
    <fieldset className="ag-fieldset ag-secrets">
      <legend className="label">{t('secrets.title')}</legend>
      <p className="ui-help">{t('secrets.hint')}</p>
      {headers.length > 0 && (
        <ul className="ag-rows">
          {headers.map((h) => (
            <li key={h.id}>
              <div className="ag-url-main">
                <span className="ag-secret-name data">{h.name}</span>
                <span className="ui-help">
                  {t('secrets.sentTo', { domain: h.domain })} · <span className="data">••••••••</span>
                </span>
                {!draftDomains.includes(h.domain) && <span className="ui-error">{t('secrets.orphan')}</span>}
              </div>
              {!readOnly && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  aria-label={`${t('secrets.remove')}: ${h.name} (${h.domain})`}
                  onClick={() => remove(h)}
                >
                  {t('secrets.remove')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly &&
        (savedDomains.length === 0 ? (
          <p className="ui-help">{t('secrets.saveDomainsFirst')}</p>
        ) : (
          <form className="ag-secret-form" onSubmit={add} autoComplete="off">
            <div className="ui-field">
              <label className="label" htmlFor="ag-secret-domain">
                {t('secrets.domain')}
              </label>
              <select id="ag-secret-domain" className="select" value={domainValue} onChange={(e) => setDomain(e.target.value)}>
                {savedDomains.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div className="ui-field">
              <label className="label" htmlFor="ag-secret-name">
                {t('secrets.name')}
              </label>
              <input
                id="ag-secret-name"
                className="input data"
                value={name}
                maxLength={64}
                spellCheck={false}
                autoCapitalize="off"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="ui-field">
              <label className="label" htmlFor="ag-secret-value">
                {t('secrets.value')}
              </label>
              <input
                id="ag-secret-value"
                className="input data"
                type="password"
                value={value}
                maxLength={4000}
                autoComplete="new-password"
                spellCheck={false}
                placeholder={t('secrets.valuePlaceholder')}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>
            <button type="submit" className="btn btn-secondary" disabled={!value || !name.trim()} aria-busy={busy || undefined}>
              {t('secrets.add')}
            </button>
          </form>
        ))}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
