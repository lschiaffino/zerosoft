'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import LocalText from '@/components/ui/LocalText';
import { INBOUND_OBJECT_NAMES, emptyInboundCounts, type InboundCounts, type InboundObjectName, type InboundView } from '@/lib/crm-hubspot-sync/inbound-types';

/**
 * CRM › Ajustes › Integraciones › Sync con HubSpot: la entrada de HubSpot al
 * CRM (bloque S2). Arrancar, pausar y retomar, qué objetos se traen, el
 * avance de la primera vuelta, conteos por objeto, la última vez que corrió y
 * los últimos problemas (como códigos traducidos: nunca datos de registros).
 * Solo admins (el panel que la contiene ya lo exige).
 */

const API = '/api/crm/hubspot-sync/inbound';
type Row = 'companies' | 'contacts' | 'deals' | 'activities';
const ROWS: Row[] = ['companies', 'contacts', 'deals', 'activities'];
const ACTIVITY_OBJECTS: InboundObjectName[] = ['notes', 'calls', 'meetings', 'tasks', 'emails'];
const COLUMNS = ['linked', 'created', 'updated', 'conflicts', 'skipped'] as const;

function formatDate(raw: string | null, locale: string): string {
  if (!raw) return '';
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? raw : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

function rowCounts(view: InboundView, row: Row): InboundCounts {
  const list = row === 'activities' ? ACTIVITY_OBJECTS : [row];
  const out = emptyInboundCounts();
  for (const o of list) {
    const c = view.counts[o];
    if (!c) continue;
    for (const k of Object.keys(out) as Array<keyof InboundCounts>) out[k] += c[k] ?? 0;
  }
  return out;
}

const running = (v: InboundView | null) => v?.state === 'initial';

export default function HubspotInboundSync({ locale }: { locale: string }) {
  const t = useTranslations('crm.hubspotSync.inbound');
  const [view, setView] = useState<InboundView | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<'' | 'start' | 'pause' | 'resume' | 'objects'>('');
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<InboundObjectName, boolean> | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(API).catch(() => null);
    if (!res || !res.ok) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setView(((await res.json()) as { inbound: InboundView }).inbound);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Primera vuelta: la pantalla abierta empuja tramos y muestra el avance. Después, solo mira cada tanto.
  const state = view?.state ?? 'off';
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    if (state === 'off' || state === 'paused' || state === 'blocked') return;
    let stop = false;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      while (!stop) {
        const push = running(viewRef.current);
        const res = await fetch(push ? `${API}/run` : API, push ? { method: 'POST' } : undefined).catch(() => null);
        if (stop) return;
        const data = res && res.ok ? ((await res.json().catch(() => null)) as { inbound: InboundView } | null) : null;
        if (stop) return;
        // Sin sesión o sin permiso ya no tiene sentido seguir; otro fallo no corta el seguimiento: se espera y se sigue.
        if (res && (res.status === 401 || res.status === 403)) return;
        if (!data) {
          await wait(5_000);
          continue;
        }
        setView(data.inbound);
        if (data.inbound.state !== state) return;
        await wait(push ? 400 : 20_000);
      }
    })();
    return () => {
      stop = true;
    };
  }, [state]);

  async function act(kind: 'start' | 'pause' | 'resume' | 'objects', body: Record<string, unknown>) {
    if (busy) return;
    setBusy(kind);
    setError(null);
    const res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    setBusy('');
    const data = res ? ((await res.json().catch(() => null)) as { inbound?: InboundView; error?: string } | null) : null;
    if (res && res.ok && data?.inbound) {
      setView(data.inbound);
      setDraft(null);
      return;
    }
    setError(data?.error && t.has(`errors.${data.error}`) ? t(`errors.${data.error}`) : t('errors.generic'));
  }

  if (failed && !view) {
    return (
      <div role="group" className="hsync-card" data-testid="hubspot-sync-inbound" data-state="error" aria-label={t('title')}>
        <h3 className="hsync-title">{t('title')}</h3>
        <p className="form-error" role="alert">
          {t('loadError')}
        </p>
        <div className="form-actions hsync-actions">
          <button type="button" className="btn btn-small" onClick={() => void load()}>
            {t('retry')}
          </button>
        </div>
      </div>
    );
  }
  if (!view) {
    return (
      <p className="muted" role="status" data-testid="hubspot-sync-inbound-loading">
        {t('loading')}
      </p>
    );
  }

  const objects = draft ?? view.objects;
  const changed = Boolean(draft) && INBOUND_OBJECT_NAMES.some((o) => draft![o] !== view.objects[o]);
  const nf = new Intl.NumberFormat(locale);
  const off = view.state === 'off';
  const totals = ROWS.map((r) => ({ row: r, counts: rowCounts(view, r) }));
  const failure = view.failure && t.has(`failures.${view.failure}`) ? t(`failures.${view.failure}`) : t('failures.provider_error');

  return (
    <div role="group" className="hsync-card" data-testid="hubspot-sync-inbound" data-state={view.state} aria-label={t('title')}>
      <h3 className="hsync-title">{t('title')}</h3>
      <p className="ui-help">{t('desc')}</p>

      {off ? (
        <div className="hsync-state" data-testid="hubspot-sync-off">
          <p className="hsync-state-title">{t('off.title')}</p>
          <p className="ui-help">{view.started ? t('off.again') : t('off.body')}</p>
        </div>
      ) : (
        <div className="hsync-state" data-testid="hubspot-sync-inbound-state" data-state={view.state} data-warn={view.state === 'retrying' || view.state === 'blocked'}>
          <p className="hsync-state-title" role="status">
            {t(`state.${view.state}`)}
          </p>
          {(view.state === 'retrying' || view.state === 'blocked') && <p className="ui-help">{failure}</p>}
          {(view.state === 'waiting' || view.state === 'retrying') && view.nextRunAt && (
            <p className="ui-help">
              {t('nextTry')} <LocalText>{formatDate(view.nextRunAt, locale)}</LocalText>
            </p>
          )}
          <p className="ui-help hsync-meta">
            {view.lastSuccessAt ? (
              <span data-testid="hubspot-sync-inbound-last">
                {t('lastSync')} <LocalText>{formatDate(view.lastSuccessAt, locale)}</LocalText>
              </span>
            ) : (
              <span>{t('neverSynced')}</span>
            )}
            {view.startedAt && (
              <span>
                {t('startedAt')} <LocalText>{formatDate(view.startedAt, locale)}</LocalText>
              </span>
            )}
          </p>
        </div>
      )}

      {view.state === 'initial' && (
        <div className="hsync-progress" data-testid="hubspot-sync-inbound-progress">
          <div className="mig-bar" role="progressbar" aria-label={t('progress')} data-indeterminate="true">
            <span />
          </div>
          <ul className="hsync-progress-list">
            {INBOUND_OBJECT_NAMES.filter((o) => view.objects[o] && view.progress[o]).map((o) => {
              const p = view.progress[o]!;
              return (
                <li key={o} data-testid={`hubspot-sync-inbound-progress-${o}`} data-done={p.caughtUp}>
                  <span>{t(`objects.${o}`)}</span>
                  <span className="mono">
                    {p.caughtUp ? t('caughtUp', { n: nf.format(p.read) }) : p.total === null ? t('read', { n: nf.format(p.read) }) : t('readOf', { n: nf.format(p.read), total: nf.format(p.total) })}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="ui-help">{t('leave')}</p>
        </div>
      )}

      {!off && (
        <div className="hsync-table-wrap">
          <table className="hsync-table" data-testid="hubspot-sync-inbound-counts">
            <caption className="sr-only">{t('countsCaption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('col.object')}</th>
                {COLUMNS.map((c) => (
                  <th scope="col" key={c} data-col={c}>
                    {t(`col.${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {totals.map(({ row, counts }) => (
                <tr key={row}>
                  <th scope="row">{t(`rows.${row}`)}</th>
                  {COLUMNS.map((c) => (
                    <td key={c} className="mono" data-col={c} data-testid={`hubspot-sync-inbound-${row}-${c}`} data-warn={c === 'conflicts' && counts.conflicts > 0}>
                      {nf.format(c === 'linked' ? view.linked[row] : counts[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!off && view.conflicts > 0 && (
        <p className="ui-help" data-testid="hubspot-sync-inbound-conflicts">
          {t('conflicts', { n: nf.format(view.conflicts) })}
        </p>
      )}
      {!off && view.linked.archived > 0 && (
        <p className="ui-help" data-testid="hubspot-sync-inbound-archived">
          {t('archived', { n: nf.format(view.linked.archived) })}
        </p>
      )}

      <fieldset className="hsync-objects" disabled={Boolean(busy)}>
        <legend className="label">{t('objectsTitle')}</legend>
        <div className="hsync-objects-grid">
          {INBOUND_OBJECT_NAMES.map((o) => (
            <label key={o} className="hsync-check">
              <input
                type="checkbox"
                checked={objects[o]}
                data-testid={`hubspot-sync-inbound-object-${o}`}
                onChange={(e) => setDraft({ ...objects, [o]: e.target.checked })}
              />
              <span>{t(`objects.${o}`)}</span>
              {view.progress[o]?.error === 'missing_scope' && <span className="hsync-sub">{t('objectNoScope')}</span>}
            </label>
          ))}
        </div>
        {view.emailScopeMissing && <p className="ui-help">{t('emailScope')}</p>}
        {!off && changed && (
          <div className="form-actions hsync-actions">
            <button type="button" className="btn btn-small" onClick={() => setDraft(null)}>
              {t('objectsCancel')}
            </button>
            <button type="button" className="btn btn-solid btn-small" onClick={() => void act('objects', { action: 'objects', objects })} aria-busy={busy === 'objects'} data-testid="hubspot-sync-inbound-objects-save">
              {t('objectsSave')}
            </button>
          </div>
        )}
      </fieldset>

      {off && <p className="ui-help">{t('startNote')}</p>}
      {error && (
        <p className="form-error" role="alert" data-testid="hubspot-sync-inbound-error">
          {error}
        </p>
      )}
      <div className="form-actions hsync-actions">
        {off && (
          <button
            type="button"
            className="btn btn-solid btn-small"
            onClick={() => void act('start', { action: 'start', objects })}
            disabled={Boolean(busy) || !INBOUND_OBJECT_NAMES.some((o) => objects[o])}
            aria-busy={busy === 'start'}
            data-testid="hubspot-sync-inbound-start"
          >
            {busy === 'start' ? t('starting') : view.started ? t('restart') : t('start')}
          </button>
        )}
        {!off && view.state !== 'paused' && view.state !== 'blocked' && (
          <button type="button" className="btn btn-small" onClick={() => void act('pause', { action: 'pause' })} disabled={Boolean(busy)} aria-busy={busy === 'pause'} data-testid="hubspot-sync-inbound-pause">
            {t('pause')}
          </button>
        )}
        {view.state === 'paused' && (
          <button type="button" className="btn btn-solid btn-small" onClick={() => void act('resume', { action: 'resume' })} disabled={Boolean(busy)} aria-busy={busy === 'resume'} data-testid="hubspot-sync-inbound-resume">
            {t('resume')}
          </button>
        )}
      </div>

      {view.errors.length > 0 && (
        <details className="hsync-bucket" data-testid="hubspot-sync-inbound-errors">
          <summary>
            <span>{t('errorsTitle')}</span>
            <span className="mono hsync-count">{nf.format(view.errors.length)}</span>
          </summary>
          <ul className="hsync-list">
            {view.errors.map((e, i) => (
              <li key={`${e.at}:${e.code}:${i}`}>
                <LocalText>{formatDate(e.at, locale)}</LocalText>
                {' · '}
                {e.object && t.has(`objects.${e.object}`) ? `${t(`objects.${e.object}`)} · ` : ''}
                {t.has(`codes.${e.code}`) ? t(`codes.${e.code}`) : t('codes.other')}
                {e.count > 1 ? ` (${nf.format(e.count)})` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
      <details className="hsync-bucket" data-testid="hubspot-sync-inbound-rules">
        <summary>{t('rules.title')}</summary>
        <ul className="hsync-list">
          {(['match', 'wins', 'conflict', 'deletes', 'owners', 'fields', 'hubspot'] as const).map((k) => (
            <li key={k}>{t(`rules.${k}`)}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
