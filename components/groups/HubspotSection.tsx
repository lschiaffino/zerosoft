'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import LocalText from '@/components/ui/LocalText';
import type { ChatHubspotDto, HubspotRecord, HubspotSuggestion, HubspotType } from '@/lib/groups-hubspot';
import { parseDbUtc } from '@/lib/utils';
import { formatHubspotValue } from '@/lib/groups-hubspot-shared';
import HubspotScreen from './HubspotScreen';
import { useGroupsInbox } from './InboxShell';
import { api, useErrorText } from './ui';

const TYPES: HubspotType[] = ['company', 'deal', 'contact'];

/** Las pocas propiedades que se muestran de cada registro, ya formateadas. */
function useRecordProps() {
  const t = useTranslations('groups.hubspot');
  const locale = useLocale();
  return (r: HubspotRecord): Array<{ key: string; label: string; value: string }> => {
    const out: Array<{ key: string; label: string; value: string }> = [];
    const add = (key: string, value: string | undefined) => {
      if (value) out.push({ key, label: t(`props.${key}`), value });
    };
    if (r.type === 'company') {
      add('domain', r.domain);
      add('owner', r.owner);
      add('lifecycle', r.lifecycle);
    } else if (r.type === 'deal') {
      add('stage', r.stage);
      if (typeof r.amount === 'number') {
        let amount = r.amount.toLocaleString(locale);
        try {
          if (r.currency) amount = r.amount.toLocaleString(locale, { style: 'currency', currency: r.currency, maximumFractionDigits: 2 });
        } catch {
          amount = `${r.amount.toLocaleString(locale)} ${r.currency ?? ''}`.trim();
        }
        add('amount', amount);
      }
      // La fecha de cierre de HubSpot es un día, no un instante: se muestra en UTC.
      if (r.closeDate) add('closeDate', new Date(r.closeDate).toLocaleDateString(locale, { timeZone: 'UTC', dateStyle: 'medium' }));
      add('owner', r.owner);
    } else {
      add('email', r.email);
      add('company', r.company);
      add('owner', r.owner);
    }
    return out;
  };
}

/**
 * HubSpot en los detalles de un chat o grupo: la empresa, el negocio y el
 * contacto vinculados (con link al registro), el contacto sugerido por
 * teléfono, el buscador para vincular y "Registrar la conversación".
 */
export default function HubspotSection({ chatId, isAdmin, showToast }: { chatId: string; isAdmin: boolean; showToast: (text: string, error?: boolean) => void }) {
  const t = useTranslations('groups');
  const locale = useLocale();
  const errText = useErrorText();
  const inbox = useGroupsInbox();
  const recordProps = useRecordProps();
  const titleId = useId();
  const [state, setState] = useState<ChatHubspotDto | null>(null);
  const [failed, setFailed] = useState(false);
  const [type, setType] = useState<HubspotType>('company');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<HubspotRecord[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [busy, setBusy] = useState(false);
  const [screen, setScreen] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const res = await api<ChatHubspotDto>(`/api/groups/hubspot/links?chat=${encodeURIComponent(chatId)}`);
    if (res.data) {
      setState(res.data);
      setFailed(false);
    } else setFailed(true);
  }, [chatId]);

  useEffect(() => {
    setState(null);
    setFailed(false);
    setQ('');
    setResults(null);
    setSearchError('');
    void load();
  }, [load]);

  useEffect(() => {
    const text = q.trim();
    const mine = ++seq.current;
    setSearchError('');
    if (text.length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const id = setTimeout(async () => {
      const res = await api<{ results: HubspotRecord[] }>(`/api/groups/hubspot/search?chat=${encodeURIComponent(chatId)}&type=${type}&q=${encodeURIComponent(text)}`);
      if (mine !== seq.current) return;
      setSearching(false);
      if (res.data) setResults(res.data.results);
      else {
        setResults(null);
        setSearchError(errText(res.error));
      }
    }, 300);
    return () => clearTimeout(id);
  }, [q, type, chatId, errText]);

  async function link(rec: Pick<HubspotRecord, 'type' | 'id' | 'name'>, withCompany = false) {
    setBusy(true);
    const res = await api<{ links: HubspotRecord[] }>('/api/groups/hubspot/links', { body: { chatId, type: rec.type, objectId: rec.id, withCompany } });
    setBusy(false);
    if (!res.data) return showToast(errText(res.error), true);
    setState((s) => (s ? { ...s, links: res.data.links, suggestions: rec.type === 'contact' ? [] : s.suggestions } : s));
    setQ('');
    setResults(null);
    showToast(t('hubspot.linked', { name: rec.name }));
    inbox.refresh();
    // La empresa nueva trae sus propiedades fijadas.
    if (rec.type !== 'deal') void load();
  }

  async function unlink(rec: HubspotRecord) {
    setBusy(true);
    const res = await api(`/api/groups/hubspot/links?chat=${encodeURIComponent(chatId)}&type=${rec.type}`, { method: 'DELETE' });
    setBusy(false);
    if (!res.data) return showToast(errText(res.error), true);
    setState((s) => (s ? { ...s, links: s.links.filter((l) => l.type !== rec.type) } : s));
    showToast(t('hubspot.unlinked'));
    inbox.refresh();
  }

  async function dismiss() {
    const res = await api('/api/groups/hubspot/links', { body: { chatId, dismiss: true } });
    if (!res.data) return showToast(errText(res.error), true);
    setState((s) => (s ? { ...s, suggestions: [] } : s));
  }

  async function logNow() {
    setBusy(true);
    const res = await api<{ notes: number; days: number }>('/api/groups/hubspot/log', { body: { chatId } });
    setBusy(false);
    if (!res.data) return showToast(errText(res.error), true);
    showToast(t('hubspot.logDone', { n: res.data.notes }));
    if (res.data.notes > 0) setState((s) => (s ? { ...s, lastLoggedAt: new Date().toISOString() } : s));
  }

  // Sin HubSpot conectado: un admin ve dónde conectarlo; el resto no ve la sección.
  if (state && !state.connected && !isAdmin) return null;

  const company = state?.company ?? null;
  const hasCompany = Boolean(state?.connected && state.links.some((l) => l.type === 'company'));
  /** Las propiedades fijadas por el workspace, con su valor como se lee. */
  const pinnedProps = (company?.pinned ?? []).map((p) => ({
    key: p.name,
    label: p.label,
    value: formatHubspotValue(p, p.value, { locale, owners: p.ownerName ? [{ id: p.value, name: p.ownerName }] : [], yes: t('props.yes'), no: t('hubspot.screen.no') }),
  }));

  const suggestion = (sg: HubspotSuggestion) => (
    <li key={sg.contact.id} className="gr-hs-suggestion">
      <span className="gr-hs-suggestion-who">
        <strong>{sg.contact.name}</strong>
        {(sg.company?.name || sg.contact.company) && <span className="ui-help">{sg.company?.name || sg.contact.company}</span>}
      </span>
      <button type="button" className="btn btn-secondary btn-sm" disabled={busy} aria-label={t('hubspot.suggestLinkLabel', { name: sg.contact.name })} onClick={() => void link(sg.contact, true)}>
        {t('hubspot.suggestLink')}
      </button>
    </li>
  );

  return (
    <section className="gr-detail-section gr-hs" aria-labelledby={titleId}>
      <div className="gr-hs-title">
        <h3 className="gr-detail-title" id={titleId}>
          {t('hubspot.title')}
        </h3>
        {hasCompany && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setScreen(true)}>
            {t('hubspot.screen.open')}
          </button>
        )}
      </div>
      {failed ? (
        <p className="ui-help" role="alert">
          {t('hubspot.loadError')}{' '}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()}>
            {t('common.retry')}
          </button>
        </p>
      ) : !state ? (
        <p className="ui-help">{t('common.loading')}</p>
      ) : !state.connected ? (
        <p className="ui-help">
          {t('hubspot.notConnected')} <Link href="/app/lines/settings?tab=integrations">{t('hubspot.connectLink')}</Link>
        </p>
      ) : (
        <>
          {state.links.length === 0 ? (
            <p className="ui-help">{t('hubspot.empty')}</p>
          ) : (
            <ul className="gr-hs-links" aria-label={t('hubspot.linkedList')}>
              {state.links.map((r) => (
                <li key={r.type} className="gr-hs-record">
                  <span className="gr-hs-kind">{t(`hubspot.types.${r.type}`)}</span>
                  <span className="gr-hs-head">
                    <a className="gr-hs-name" href={r.url} target="_blank" rel="noopener noreferrer" aria-label={t('hubspot.open', { name: r.name })}>
                      {r.name}
                    </a>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busy} aria-label={t('hubspot.unlinkLabel', { name: r.name })} onClick={() => void unlink(r)}>
                      {t('hubspot.unlink')}
                    </button>
                  </span>
                  {r.type === 'company' && company?.broken ? (
                    <span className="ui-error gr-hs-broken" role="alert">
                      {company.broken.reason === 'merged' ? t('hubspot.brokenMerged', { name: company.broken.mergedName || company.broken.mergedInto }) : t('hubspot.brokenDeleted')}
                      {company.broken.reason === 'merged' && company.broken.mergedInto && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={busy}
                          onClick={() => void link({ type: 'company', id: company.broken?.mergedInto ?? '', name: company.broken?.mergedName || company.broken?.mergedInto || '' })}
                        >
                          {t('hubspot.relink', { name: company.broken.mergedName || company.broken.mergedInto })}
                        </button>
                      )}
                    </span>
                  ) : r.missing ? (
                    <span className="ui-error">{t('hubspot.missing')}</span>
                  ) : (
                    (() => {
                      // La empresa muestra las propiedades que fijó el workspace; el resto, las de siempre.
                      const shown = r.type === 'company' && pinnedProps.length > 0 ? pinnedProps : recordProps(r);
                      return (
                        shown.length > 0 && (
                          <dl className="gr-hs-props">
                            {shown.map((p) => (
                              <div key={p.key}>
                                <dt>{p.label}</dt>
                                <dd>
                                  <LocalText>{p.value}</LocalText>
                                </dd>
                              </div>
                            ))}
                          </dl>
                        )
                      );
                    })()
                  )}
                </li>
              ))}
            </ul>
          )}

          {state.suggestions.length > 0 && (
            <div className="gr-hs-suggest" role="group" aria-label={t('hubspot.suggestTitle', { n: state.suggestions.length })}>
              <p className="gr-hs-suggest-title">{t('hubspot.suggestTitle', { n: state.suggestions.length })}</p>
              <ul className="gr-hs-suggestions">{state.suggestions.map(suggestion)}</ul>
              <div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void dismiss()}>
                  {t('hubspot.suggestDismiss', { n: state.suggestions.length })}
                </button>
              </div>
            </div>
          )}

          <div className="gr-hs-search">
            <div className="gr-hs-search-row">
              <select className="select" value={type} onChange={(e) => setType(e.target.value as HubspotType)} aria-label={t('hubspot.searchType')}>
                {TYPES.map((k) => (
                  <option key={k} value={k}>
                    {t(`hubspot.types.${k}`)}
                  </option>
                ))}
              </select>
              <input
                className="input"
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && q) {
                    e.stopPropagation();
                    setQ('');
                  }
                }}
                placeholder={t(`hubspot.search.${type}`)}
                aria-label={t(`hubspot.search.${type}`)}
                maxLength={100}
              />
            </div>
            {searchError ? (
              <p className="ui-error" role="alert">
                {searchError}
              </p>
            ) : searching && !results ? (
              <p className="ui-help" role="status">
                {t('hubspot.searching')}
              </p>
            ) : results && results.length === 0 ? (
              <p className="ui-help" role="status">
                {t('hubspot.noResults')}
              </p>
            ) : results && results.length > 0 ? (
              <ul className="gr-hs-results" aria-label={t('hubspot.results')}>
                {results.map((r) => {
                  const meta = recordProps(r)
                    .slice(0, 2)
                    .map((p) => p.value)
                    .join(' · ');
                  return (
                    <li key={r.id}>
                      <button type="button" disabled={busy} onClick={() => void link(r)} aria-label={t('hubspot.linkResult', { name: r.name })}>
                        <span className="gr-hs-result-name">{r.name}</span>
                        {meta && <span className="ui-help">{meta}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>

          {state.links.length > 0 && (
            <div className="gr-hs-log">
              {state.canLog && (
                <div>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={busy} aria-busy={busy || undefined} onClick={() => void logNow()}>
                    {t('hubspot.log')}
                  </button>
                </div>
              )}
              <p className="ui-help">
                {!state.canLog ? t('hubspot.logNoScope') : state.logNotes ? t('hubspot.logAuto') : t('hubspot.logHelp')}
                {state.lastLoggedAt && (
                  <>
                    {' '}
                    <LocalText>{t('hubspot.lastLogged', { time: parseDbUtc(state.lastLoggedAt).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }) })}</LocalText>
                  </>
                )}
              </p>
            </div>
          )}
        </>
      )}
      <HubspotScreen
        chatId={chatId}
        open={screen}
        isAdmin={isAdmin}
        onClose={() => {
          setScreen(false);
          // Lo que se editó o fijó en la pantalla se ve en la sección y en la fila de la bandeja.
          void load();
          inbox.refresh();
        }}
      />
    </section>
  );
}
