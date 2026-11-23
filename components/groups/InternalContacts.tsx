'use client';

import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { api, useErrorText } from './dialog-kit';
import { useToast } from './toast';
import type { InternalContactDto, InternalSettings } from '@/lib/internal-contacts';

interface State {
  settings: InternalSettings;
  contacts: InternalContactDto[];
  masked: boolean;
}

/**
 * Contactos internos del workspace (lib/internal-contacts.ts), para admins:
 * la regla (las líneas cuentan como internas, los dominios de la empresa) y
 * los contactos marcados. Lo usan Ajustes de Lines (/api/groups/internal) y
 * Ajustes de Inbox (/api/inbox/internal): los dos leen y cambian lo mismo.
 */
export default function InternalContactsPanel({ apiBase }: { apiBase: '/api/groups/internal' | '/api/inbox/internal' }) {
  const t = useTranslations('groups.wa.internal');
  const errText = useErrorText();
  const [toast, showToast] = useToast();
  const [state, setState] = useState<State | null>(null);
  const [loadError, setLoadError] = useState('');
  const [handle, setHandle] = useState('');
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const ids = useId();

  const load = useCallback(async () => {
    setLoadError('');
    const res = await api<State>(apiBase);
    if (!res.data) return setLoadError(errText(res.error) || t('error'));
    setState(res.data);
  }, [apiBase, errText, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(body: Partial<InternalSettings>) {
    if (!state) return;
    const prev = state;
    setState({ ...state, settings: { ...state.settings, ...body } });
    const res = await api<State>(apiBase, { method: 'PATCH', body });
    if (!res.data) {
      setState(prev);
      return showToast(errText(res.error), true);
    }
    setState(res.data);
    showToast(t('saved'));
  }

  async function mark(body: { handle?: string; ref?: string; internal: boolean | null; name?: string }): Promise<boolean> {
    setBusy(true);
    const res = await api<State>(apiBase, { method: 'POST', body });
    setBusy(false);
    if (!res.data) {
      showToast(errText(res.error), true);
      return false;
    }
    setState(res.data);
    return true;
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!handle.trim() || busy) return;
    if (await mark({ handle: handle.trim(), internal: true, name: name.trim() })) {
      setHandle('');
      setName('');
      showToast(t('added'));
    }
  }

  function addDomain(e: FormEvent) {
    e.preventDefault();
    if (!state) return;
    const d = domain.trim().toLowerCase().replace(/^@/, '');
    if (!d) return;
    if (!state.settings.domains.includes(d)) void patch({ domains: [...state.settings.domains, d] });
    setDomain('');
  }

  if (loadError)
    return (
      <div className="ui-fields" data-testid="internal-contacts">
        <p className="ui-error" role="alert">
          {loadError}
        </p>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load()}>
          {t('retry')}
        </button>
      </div>
    );
  if (!state)
    return (
      <p className="ui-help" role="status" data-testid="internal-contacts" aria-busy="true">
        {t('loading')}
      </p>
    );

  return (
    <div className="ui-fields gr-internal" data-testid="internal-contacts">
      <section className="gr-detail-section" aria-labelledby={`${ids}-title`}>
        <h2 className="gr-detail-title" id={`${ids}-title`}>
          {t('title')}
        </h2>
        <p className="ui-help">{t('intro')}</p>
        <label className="gr-check-label">
          <input type="checkbox" className="ui-check" checked={state.settings.lines} onChange={(e) => void patch({ lines: e.target.checked })} data-testid="internal-lines" />
          {t('linesRule')}
        </label>
        <p className="ui-help">{t('linesHelp')}</p>
      </section>

      <section className="gr-detail-section" aria-labelledby={`${ids}-add`}>
        <h2 className="gr-detail-title" id={`${ids}-add`}>
          {t('addTitle')}
        </h2>
        <form className="gr-internal-form" onSubmit={(e) => void add(e)}>
          <label className="ui-field">
            <span className="label">{t('handleLabel')}</span>
            <input className="input" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder={t('handlePlaceholder')} maxLength={320} data-testid="internal-handle" autoComplete="off" />
          </label>
          <label className="ui-field">
            <span className="label">{t('nameLabel')}</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} data-testid="internal-name" autoComplete="off" />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy || !handle.trim()} data-testid="internal-add">
            {t('add')}
          </button>
        </form>
      </section>

      <section className="gr-detail-section" aria-labelledby={`${ids}-list`}>
        <h2 className="gr-detail-title" id={`${ids}-list`}>
          {t('listTitle')}
        </h2>
        {state.contacts.length === 0 ? (
          <p className="ui-help" data-testid="internal-empty">
            {t('empty')}
          </p>
        ) : (
          <ul className="gr-mini-list gr-internal-list" aria-label={t('listTitle')}>
            {state.contacts.map((c) => (
              <li key={c.ref} data-testid="internal-row" data-state={c.internal ? 'internal' : 'external'}>
                <span className="gr-internal-who">
                  <span className="gr-internal-handle">{c.kind === 'phone' && !c.masked ? `+${c.handle}` : c.handle}</span>
                  {c.name && <span className="ui-help">{c.name}</span>}
                </span>
                <select
                  className="select gr-internal-state"
                  value={c.internal ? 'internal' : 'external'}
                  aria-label={t('stateLabel', { handle: c.name || c.handle })}
                  disabled={busy}
                  onChange={(e) => void mark({ ref: c.ref, internal: e.target.value === 'internal' })}
                >
                  <option value="internal">{t('state.internal')}</option>
                  <option value="external">{t('state.external')}</option>
                </select>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busy}
                  aria-label={t('remove', { handle: c.name || c.handle })}
                  onClick={() => void mark({ ref: c.ref, internal: null })}
                >
                  {t('removeShort')}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="ui-help">{t('stateHelp')}</p>
      </section>

      <section className="gr-detail-section" aria-labelledby={`${ids}-domains`}>
        <h2 className="gr-detail-title" id={`${ids}-domains`}>
          {t('domains')}
        </h2>
        <p className="ui-help">{t('domainsHelp')}</p>
        {state.settings.domains.length > 0 && (
          <ul className="gr-mini-list" aria-label={t('domains')}>
            {state.settings.domains.map((d) => (
              <li key={d} data-testid="internal-domain">
                <span>@{d}</span>
                <button type="button" className="btn btn-ghost btn-sm" aria-label={t('removeDomain', { domain: d })} onClick={() => void patch({ domains: state.settings.domains.filter((x) => x !== d) })}>
                  {t('removeShort')}
                </button>
              </li>
            ))}
          </ul>
        )}
        <form className="gr-internal-form" onSubmit={addDomain}>
          <label className="ui-field">
            <span className="label">{t('domainLabel')}</span>
            <input className="input" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder={t('domainPlaceholder')} maxLength={253} data-testid="internal-domain-input" autoComplete="off" />
          </label>
          <button type="submit" className="btn btn-secondary" disabled={!domain.trim()}>
            {t('addDomain')}
          </button>
        </form>
      </section>
      {toast}
    </div>
  );
}
