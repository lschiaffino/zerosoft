'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { HubspotRecord } from '@/lib/groups-hubspot';
import type { UnlinkedGroup } from '@/lib/groups-hubspot-sync';
import { ChatPlate, api, useErrorText, useToast } from './ui';

const PAGE = 25;

interface ListResponse {
  connected: boolean;
  rows: UnlinkedGroup[];
  total: number;
}

/** Un grupo sin empresa: la sugerencia por nombre (se confirma con un clic) y un buscador de empresas propio. */
function Row({ group, onLinked, onError }: { group: UnlinkedGroup; onLinked: (group: UnlinkedGroup, company: string) => void; onError: (code: string) => void }) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<HubspotRecord[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const seq = useRef(0);

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
      const res = await api<{ results: HubspotRecord[] }>(`/api/groups/hubspot/search?chat=${encodeURIComponent(group.id)}&type=company&q=${encodeURIComponent(text)}`);
      if (mine !== seq.current) return;
      setSearching(false);
      if (res.data) setResults(res.data.results);
      else {
        setResults(null);
        setSearchError(errText(res.error));
      }
    }, 300);
    return () => clearTimeout(id);
  }, [q, group.id, errText]);

  async function link(id: string, name: string) {
    setBusy(true);
    const res = await api('/api/groups/hubspot/links', { body: { chatId: group.id, type: 'company', objectId: id } });
    setBusy(false);
    if (!res.data) return onError(res.error);
    onLinked(group, name);
  }

  const suggestion = dismissed ? null : group.suggestion;
  return (
    <li className="gr-hsu-row" data-chat={group.id}>
      <div className="gr-hsu-group">
        <ChatPlate name={group.name} kind="group" />
        <span className="gr-hsu-names">
          <Link href={`/app/lines/list/${group.id}`} className="gr-hsu-name">
            {group.name}
          </Link>
          <span className="ui-help">{[group.lineName, group.memberCount > 0 ? t('thread.groupMeta', { n: group.memberCount }) : ''].filter(Boolean).join(' · ')}</span>
        </span>
      </div>
      <div className="gr-hsu-link">
        {suggestion ? (
          <div className="gr-hsu-suggestion">
            <span className="gr-hsu-suggested">
              <span className="ui-help">{t('hubspot.bulk.suggested')}</span>
              <strong>{suggestion.name}</strong>
              {suggestion.domain && <span className="ui-help">{suggestion.domain}</span>}
            </span>
            <span className="gr-hsu-actions">
              <button type="button" className="btn btn-primary btn-sm" disabled={busy} aria-label={t('hubspot.bulk.linkLabel', { group: group.name, company: suggestion.name })} onClick={() => void link(suggestion.id, suggestion.name)}>
                {t('hubspot.bulk.link')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} aria-label={t('hubspot.bulk.dismissLabel', { group: group.name })} onClick={() => setDismissed(true)}>
                {t('hubspot.bulk.dismiss')}
              </button>
            </span>
          </div>
        ) : (
          <p className="ui-help" role="status">
            {group.pending ? t('hubspot.bulk.looking') : t('hubspot.bulk.noSuggestion')}
          </p>
        )}
        <input
          className="input"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('hubspot.search.company')}
          aria-label={t('hubspot.bulk.searchFor', { group: group.name })}
          maxLength={100}
        />
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
            {results.map((r) => (
              <li key={r.id}>
                <button type="button" disabled={busy} onClick={() => void link(r.id, r.name)} aria-label={t('hubspot.bulk.linkLabel', { group: group.name, company: r.name })}>
                  <span className="gr-hs-result-name">{r.name}</span>
                  {r.domain && <span className="ui-help">{r.domain}</span>}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Grupos sin empresa de HubSpot: para vincular de a muchos. Cada fila trae
 * una sugerencia por parecido de nombre (nunca se vincula sola: se confirma
 * con un clic) y su propio buscador de empresas.
 */
export default function HubspotUnlinked() {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const [toast, showToast] = useToast();
  const [rows, setRows] = useState<UnlinkedGroup[] | null>(null);
  const [total, setTotal] = useState(0);
  const [connected, setConnected] = useState(true);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [more, setMore] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);

  /** Busca en HubSpot las sugerencias que faltan, de a 10 grupos. */
  const suggest = useCallback(async (pending: UnlinkedGroup[], mine: number) => {
    for (let i = 0; i < pending.length; i += 10) {
      const ids = pending.slice(i, i + 10).map((r) => r.id);
      const res = await api<{ suggestions: Record<string, UnlinkedGroup['suggestion']> }>('/api/groups/hubspot/unlinked', { body: { chatIds: ids } });
      if (mine !== seq.current) return;
      const found = res.data?.suggestions ?? {};
      // Con o sin resultado (o si HubSpot no respondió), la fila deja de estar "buscando".
      setRows((cur) => cur?.map((r) => (ids.includes(r.id) ? { ...r, pending: false, suggestion: found[r.id] ?? r.suggestion } : r)) ?? cur);
    }
  }, []);

  const load = useCallback(
    async (offset: number) => {
      const mine = offset === 0 ? ++seq.current : seq.current;
      if (offset > 0) setMore(true);
      const res = await api<ListResponse>(`/api/groups/hubspot/unlinked?limit=${PAGE}&offset=${offset}${debounced ? `&q=${encodeURIComponent(debounced)}` : ''}`);
      if (mine !== seq.current) return;
      setMore(false);
      if (!res.data) return setFailed(true);
      const data = res.data;
      setFailed(false);
      setConnected(data.connected);
      setTotal(data.total);
      setRows((cur) => (offset === 0 ? data.rows : [...(cur ?? []), ...data.rows.filter((r) => !(cur ?? []).some((x) => x.id === r.id))]));
      void suggest(
        data.rows.filter((r) => r.pending),
        mine,
      );
    },
    [debounced, suggest],
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  function onLinked(group: UnlinkedGroup, company: string) {
    setRows((cur) => cur?.filter((r) => r.id !== group.id) ?? cur);
    setTotal((n) => Math.max(0, n - 1));
    showToast(t('hubspot.bulk.linked', { group: group.name, company }));
  }

  if (!connected) {
    return (
      <p className="ui-help">
        {t('hubspot.bulk.notConnected')} <Link href="/app/lines/settings?tab=integrations">{t('hubspot.connectLink')}</Link>
      </p>
    );
  }

  return (
    <div className="gr-hsu">
      <div className="gr-hsu-tools">
        <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('hubspot.bulk.filter')} aria-label={t('hubspot.bulk.filter')} maxLength={100} />
        {rows && (
          <p className="ui-help" role="status">
            {t('hubspot.bulk.count', { n: total })}
          </p>
        )}
      </div>
      {failed ? (
        <p className="ui-help" role="alert">
          {t('hubspot.bulk.loadError')}{' '}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load(0)}>
            {t('common.retry')}
          </button>
        </p>
      ) : !rows ? (
        <p className="ui-help" role="status">
          {t('common.loading')}
        </p>
      ) : rows.length === 0 ? (
        <p className="ui-help gr-hsu-empty">{debounced ? t('hubspot.bulk.noMatch') : t('hubspot.bulk.empty')}</p>
      ) : (
        <>
          <ul className="gr-hsu-rows" aria-label={t('hubspot.bulk.title')}>
            {rows.map((r) => (
              <Row key={r.id} group={r} onLinked={onLinked} onError={(code) => showToast(errText(code), true)} />
            ))}
          </ul>
          {rows.length < total && (
            <div>
              <button type="button" className="btn btn-secondary" disabled={more} aria-busy={more || undefined} onClick={() => void load(rows.length)}>
                {t('hubspot.bulk.more')}
              </button>
            </div>
          )}
        </>
      )}
      {toast}
    </div>
  );
}
