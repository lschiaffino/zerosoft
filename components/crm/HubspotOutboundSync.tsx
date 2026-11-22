'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import LocalText from '@/components/ui/LocalText';
import { OUTBOUND_OBJECT_NAMES, emptyOutboundCounts, type OutboundObjectName, type OutboundView } from '@/lib/crm-hubspot-sync/outbound-types';

/**
 * CRM › Ajustes › Integraciones › Sync con HubSpot: la escritura del CRM en
 * HubSpot (bloque S3). Apagada por defecto y aparte de la entrada: primero la
 * vista previa (qué campos y cuántos registros saldrían, sin llamar a
 * HubSpot), después prenderla con una confirmación. Prendida muestra la cola,
 * conteos por objeto y los últimos problemas como códigos traducidos (nunca
 * datos de registros). Solo admins (el panel que la contiene ya lo exige).
 */

const API = '/api/crm/hubspot-sync/outbound';
const COLUMNS = ['updated', 'created', 'associations', 'conflicts', 'failed'] as const;

function formatDate(raw: string | null, locale: string): string {
  if (!raw) return '';
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? raw : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

type Busy = '' | 'preview' | 'enable' | 'disable' | 'retry_failed';

export default function HubspotOutboundSync({ locale }: { locale: string }) {
  const t = useTranslations('crm.hubspotSync.outbound');
  const tf = useTranslations('crm.hubspotSync.fields');
  const [view, setView] = useState<OutboundView | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<Busy>('');
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const turnOnRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(API).catch(() => null);
    if (!res || !res.ok) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setView(((await res.json()) as { outbound: OutboundView }).outbound);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Prendida: con cambios en la cola, la pantalla abierta empuja tramos; si no, mira cada tanto (el cron sigue sin ella).
  const enabled = view?.enabled ?? false;
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      while (!stop) {
        const v = viewRef.current;
        const push = Boolean(v && v.state === 'on' && v.due > 0);
        await wait(push ? 1_500 : 20_000);
        if (stop) return;
        const res = await fetch(API, push ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'run' }) } : undefined).catch(() => null);
        if (stop) return;
        if (res && (res.status === 401 || res.status === 403 || res.status === 429)) return;
        const data = res && res.ok ? ((await res.json().catch(() => null)) as { outbound: OutboundView } | null) : null;
        if (stop) return;
        if (data) {
          setView(data.outbound);
          if (!data.outbound.enabled) return;
        }
      }
    })();
    return () => {
      stop = true;
    };
  }, [enabled]);

  // La confirmación se cierra con Esc y con un clic afuera; el foco vuelve al botón que la abrió.
  useEffect(() => {
    if (!confirming) return;
    const close = () => {
      setConfirming(false);
      turnOnRef.current?.focus();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (confirmRef.current && !confirmRef.current.contains(e.target as Node) && !turnOnRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    confirmRef.current?.querySelector<HTMLButtonElement>('[data-autofocus]')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [confirming]);

  async function act(kind: Exclude<Busy, ''>) {
    if (busy) return;
    setBusy(kind);
    setError(null);
    setNotice(null);
    const res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: kind }) }).catch(() => null);
    setBusy('');
    const data = res ? ((await res.json().catch(() => null)) as { outbound?: OutboundView; error?: string; retried?: number } | null) : null;
    if (res && res.ok && data?.outbound) {
      setView(data.outbound);
      setConfirming(false);
      setNotice(kind === 'retry_failed' ? t('retried', { n: data.retried ?? 0 }) : null);
      return;
    }
    setError(data?.error && t.has(`errors.${data.error}`) ? t(`errors.${data.error}`) : t('errors.generic'));
  }

  if (failed && !view) {
    return (
      <div role="group" className="hsync-card" data-testid="hubspot-sync-outbound" data-state="error" aria-label={t('title')}>
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
      <p className="muted" role="status" data-testid="hubspot-sync-outbound-loading">
        {t('loading')}
      </p>
    );
  }

  const nf = new Intl.NumberFormat(locale);
  const fieldLabel = (f: string) => (f.startsWith('custom.') ? f.slice(7) : tf.has(f) ? tf(f) : f);
  const preview = view.preview;
  const previewTotal = preview ? OUTBOUND_OBJECT_NAMES.reduce((n, o) => n + (preview.objects[o]?.records ?? 0) + (preview.objects[o]?.create ?? 0), 0) : 0;
  const failure = view.failure && t.has(`failures.${view.failure}`) ? t(`failures.${view.failure}`) : t('failures.provider_error');
  const objectsOn = OUTBOUND_OBJECT_NAMES.filter((o) => view.objects[o]);

  return (
    <div role="group" className="hsync-card" data-testid="hubspot-sync-outbound" data-state={view.state} aria-label={t('title')}>
      <h3 className="hsync-title">{t('title')}</h3>
      <p className="ui-help">{t('desc')}</p>

      <div className="hsync-state" data-testid="hubspot-sync-outbound-state" data-state={view.state} data-warn={view.state === 'retrying' || view.state === 'blocked'}>
        <p className="hsync-state-title" role="status">
          {t(`state.${view.state}`)}
        </p>
        {view.state === 'unavailable' && view.blocker && <p className="ui-help">{t(`blockers.${view.blocker}`)}</p>}
        {view.blocker === 'missing_write_scope' && view.missingScopes.length > 0 && (
          <ul className="hsync-list" data-testid="hubspot-sync-outbound-scopes">
            {view.missingScopes.map((s) => (
              <li key={s}>
                <code>{s}</code>
              </li>
            ))}
          </ul>
        )}
        {(view.state === 'retrying' || view.state === 'blocked') && <p className="ui-help">{failure}</p>}
        {(view.state === 'waiting' || view.state === 'retrying') && view.nextRunAt && (
          <p className="ui-help">
            {t('nextTry')} <LocalText>{formatDate(view.nextRunAt, locale)}</LocalText>
          </p>
        )}
        {view.enabled && (
          <p className="ui-help hsync-meta">
            {view.lastSuccessAt ? (
              <span data-testid="hubspot-sync-outbound-last">
                {t('lastRun')} <LocalText>{formatDate(view.lastSuccessAt, locale)}</LocalText>
              </span>
            ) : (
              <span>{t('neverRun')}</span>
            )}
            {view.enabledAt && (
              <span>
                {t('enabledAt')} <LocalText>{formatDate(view.enabledAt, locale)}</LocalText>
              </span>
            )}
            <span data-testid="hubspot-sync-outbound-queued">{t('queued', { n: view.queued })}</span>
          </p>
        )}
      </div>

      {view.enabled && (
        <div className="hsync-table-wrap">
          <table className="hsync-table" data-testid="hubspot-sync-outbound-counts">
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
              {OUTBOUND_OBJECT_NAMES.map((o) => {
                const counts = view.counts[o] ?? emptyOutboundCounts();
                return (
                  <tr key={o}>
                    <th scope="row">{t(`objects.${o}`)}</th>
                    {COLUMNS.map((c) => (
                      <td key={c} className="mono" data-col={c} data-testid={`hubspot-sync-outbound-${o}-${c}`} data-warn={(c === 'conflicts' || c === 'failed') && counts[c] > 0}>
                        {nf.format(c === 'created' ? counts.created + counts.matched : counts[c])}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {view.enabled && view.failedItems > 0 && (
        <div className="hsync-progress">
          <p className="ui-help" data-testid="hubspot-sync-outbound-failed">
            {t('failedItems', { n: view.failedItems })}
          </p>
          <div className="form-actions hsync-actions">
            <button type="button" className="btn btn-small" onClick={() => void act('retry_failed')} disabled={Boolean(busy)} aria-busy={busy === 'retry_failed'} data-testid="hubspot-sync-outbound-retry-failed">
              {busy === 'retry_failed' ? t('retrying') : t('retryFailed')}
            </button>
          </div>
        </div>
      )}
      {notice && (
        <p className="ui-help" role="status" data-testid="hubspot-sync-outbound-notice">
          {notice}
        </p>
      )}

      {preview && (
        <section className="hsync-progress" data-testid="hubspot-sync-outbound-preview" aria-label={t('preview.title')}>
          <p className="hsync-progress-title">{t('preview.title')}</p>
          <p className="ui-help">
            {t('preview.at')} <LocalText>{formatDate(preview.at, locale)}</LocalText>
          </p>
          {previewTotal === 0 ? (
            <p className="ui-help" data-testid="hubspot-sync-outbound-preview-empty">
              {t('preview.empty')}
            </p>
          ) : (
            <ul className="hsync-list">
              {OUTBOUND_OBJECT_NAMES.filter((o) => preview.objects[o]).map((o) => {
                const p = preview.objects[o]!;
                const fields = Object.entries(p.fields).sort((a, b) => b[1] - a[1]);
                return (
                  <li key={o} data-testid={`hubspot-sync-outbound-preview-${o}`}>
                    <span className="hsync-preview-head">
                      <strong>{t(`objects.${o}`)}</strong>
                      <span className="mono" data-testid={`hubspot-sync-outbound-preview-${o}-records`}>
                        {t('preview.records', { n: p.records })}
                      </span>
                      {p.create > 0 && <span className="mono">{t('preview.create', { n: p.create })}</span>}
                      {p.associations > 0 && <span className="mono">{t('preview.associations', { n: p.associations })}</span>}
                    </span>
                    {fields.length > 0 && (
                      <span className="hsync-sub" data-testid={`hubspot-sync-outbound-preview-${o}-fields`}>
                        {fields.map(([f, n]) => `${fieldLabel(f)} (${nf.format(n)})`).join(', ')}
                      </span>
                    )}
                    {p.truncated && <span className="hsync-sub">{t('preview.truncated')}</span>}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="ui-help">{t('preview.note')}</p>
        </section>
      )}

      {error && (
        <p className="form-error" role="alert" data-testid="hubspot-sync-outbound-error">
          {error}
        </p>
      )}

      {confirming && (
        <div className="hsync-confirm" ref={confirmRef} role="dialog" aria-modal="false" aria-labelledby="hsync-out-confirm-title" data-testid="hubspot-sync-outbound-confirm">
          <p className="hsync-state-title" id="hsync-out-confirm-title">
            {t('confirm.title')}
          </p>
          <p className="ui-help">{t('confirm.body', { n: previewTotal, objects: objectsOn.map((o) => t(`objects.${o}`)).join(', ') })}</p>
          <div className="form-actions hsync-actions">
            <button type="button" className="btn btn-small" onClick={() => setConfirming(false)} data-autofocus data-testid="hubspot-sync-outbound-confirm-cancel">
              {t('confirm.cancel')}
            </button>
            <button type="button" className="btn btn-solid btn-small" onClick={() => void act('enable')} disabled={Boolean(busy)} aria-busy={busy === 'enable'} data-testid="hubspot-sync-outbound-confirm-yes">
              {busy === 'enable' ? t('enabling') : t('confirm.yes')}
            </button>
          </div>
        </div>
      )}

      <div className="form-actions hsync-actions">
        {view.state !== 'unavailable' || view.blocker === 'missing_write_scope' ? (
          <button type="button" className="btn btn-small" onClick={() => void act('preview')} disabled={Boolean(busy)} aria-busy={busy === 'preview'} data-testid="hubspot-sync-outbound-preview-run">
            {busy === 'preview' ? t('previewing') : preview ? t('previewAgain') : t('previewRun')}
          </button>
        ) : null}
        {!view.enabled && view.state === 'off' && (
          <button
            type="button"
            ref={turnOnRef}
            className="btn btn-solid btn-small"
            onClick={() => setConfirming(true)}
            disabled={Boolean(busy) || !view.previewFresh}
            aria-expanded={confirming}
            data-testid="hubspot-sync-outbound-enable"
          >
            {t('enable')}
          </button>
        )}
        {view.enabled && (
          <button type="button" className="btn btn-small" onClick={() => void act('disable')} disabled={Boolean(busy)} aria-busy={busy === 'disable'} data-testid="hubspot-sync-outbound-disable">
            {t('disable')}
          </button>
        )}
      </div>
      {!view.enabled && view.state === 'off' && !view.previewFresh && <p className="ui-help">{t('previewFirst')}</p>}

      {view.errors.length > 0 && (
        <details className="hsync-bucket" data-testid="hubspot-sync-outbound-errors">
          <summary>
            <span>{t('errorsTitle')}</span>
            <span className="mono hsync-count">{nf.format(view.errors.length)}</span>
          </summary>
          <ul className="hsync-list">
            {view.errors.map((e, i) => (
              <li key={`${e.at}:${e.code}:${i}`}>
                <LocalText>{formatDate(e.at, locale)}</LocalText>
                {' · '}
                {e.object && t.has(`objects.${e.object}`) ? `${t(`objects.${e.object as OutboundObjectName}`)} · ` : ''}
                {t.has(`codes.${e.code}`) ? t(`codes.${e.code}`) : t('codes.other')}
                {e.count > 1 ? ` (${nf.format(e.count)})` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
      <details className="hsync-bucket" data-testid="hubspot-sync-outbound-rules">
        <summary>{t('rules.title')}</summary>
        <ul className="hsync-list">
          {(['what', 'conflict', 'echo', 'create', 'associations', 'deletes', 'pause'] as const).map((k) => (
            <li key={k}>{t(`rules.${k}`)}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
