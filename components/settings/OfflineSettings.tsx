'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import FormSection from '@/components/ui/FormSection';
import { docsDrafts, notesPending } from '@/components/app/OfflineStatus';
import { registerAppServiceWorker } from '@/lib/sw-client';
import { OFFLINE_APPS, OFFLINE_DAYS, OFFLINE_LIMITS, OFFLINE_SIZES, type OfflineApp, type OfflinePrefs } from '@/lib/offline-prefs';
import { readOfflinePrefs, writeOfflinePrefs } from '@/lib/offline-prefs-client';

type Usage = Record<OfflineApp | 'static', { pages: number; bytes: number }>;

/** "3,4 MB", "820 KB" en el idioma de la página. */
export function formatBytes(bytes: number, locale: string): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = Math.max(0, bytes);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 }).format(v)} ${units[i]}`;
}

/**
 * Ajustes › Sin conexión (este dispositivo): prendido o apagado, qué apps se
 * guardan, cuánto y por cuánto tiempo, lo que ocupa hoy (por app) y los
 * cambios que esperan red. Cada cambio vale al momento: se guarda en el
 * navegador y se le manda al service worker, que lo aplica (public/sw.js).
 * Apagarlo con cambios pendientes pide confirmar: esos cambios no se tocan
 * y se mandan igual cuando vuelve la red.
 */
export default function OfflineSettings({ owner }: { owner: string }) {
  const t = useTranslations('settings.offline');
  const locale = useLocale();
  const [prefs, setPrefs] = useState<OfflinePrefs | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);
  const [queue, setQueue] = useState({ count: 0, failed: 0 });
  const [local, setLocal] = useState({ docs: 0, notes: 0 });
  const [confirmOff, setConfirmOff] = useState(false);
  const [status, setStatus] = useState('');
  const [worker, setWorker] = useState<'loading' | 'ready' | 'none'>('loading');

  const post = useCallback(async (msg: Record<string, unknown>) => {
    const reg = await registerAppServiceWorker({ force: true });
    if (!reg) return false;
    const ready = await navigator.serviceWorker.ready;
    (navigator.serviceWorker.controller ?? ready.active)?.postMessage(msg);
    return true;
  }, []);

  const refreshEstimate = useCallback(async () => {
    try {
      const e = await navigator.storage?.estimate?.();
      if (e) setEstimate({ usage: e.usage ?? 0, quota: e.quota ?? 0 });
    } catch {
      /* sin la API: no se muestra el total */
    }
  }, []);

  useEffect(() => {
    const initial = readOfflinePrefs();
    setPrefs(initial);
    void refreshEstimate();
    if (!('serviceWorker' in navigator)) {
      setWorker('none');
      return;
    }
    function onMessage(e: MessageEvent) {
      const d = (e.data ?? {}) as { type?: string; usage?: Usage; count?: number; failed?: unknown[] };
      if (d.type === 'zs-offline-usage' && d.usage) {
        setUsage(d.usage);
        void refreshEstimate();
      } else if (d.type === 'zs-queue') {
        setQueue({ count: d.count ?? 0, failed: Array.isArray(d.failed) ? d.failed.length : 0 });
      }
    }
    navigator.serviceWorker.addEventListener('message', onMessage);
    void post({ type: 'zs-offline-prefs', prefs: initial })
      .then((ok) => {
        setWorker(ok ? 'ready' : 'none');
        if (ok) void post({ type: 'zs-count' });
      })
      .catch(() => setWorker('none'));
    let alive = true;
    void notesPending(owner).then((notes) => alive && setLocal({ docs: docsDrafts(owner), notes }));
    return () => {
      alive = false;
      navigator.serviceWorker.removeEventListener('message', onMessage);
    };
  }, [owner, post, refreshEstimate]);

  const pending = queue.count + queue.failed + local.docs + local.notes;

  function apply(next: OfflinePrefs, message = t('saved')) {
    setPrefs(next);
    writeOfflinePrefs(next);
    void post({ type: 'zs-offline-prefs', prefs: next });
    setStatus(message);
  }

  function toggleEnabled(on: boolean) {
    if (!prefs) return;
    if (!on && pending > 0) {
      setConfirmOff(true);
      return;
    }
    apply({ ...prefs, enabled: on }, on ? t('turnedOn') : t('turnedOff'));
  }

  if (!prefs) {
    return (
      <div className="ui-loading-stack" aria-busy="true" aria-label={t('loading')}>
        <div className="ui-skeleton ui-skeleton-title" />
        <div className="ui-skeleton ui-skeleton-block" />
      </div>
    );
  }

  const appUsage = (a: OfflineApp) =>
    usage ? t('appUsage', { pages: usage[a].pages, size: formatBytes(usage[a].bytes, locale) }) : worker === 'loading' ? t('measuring') : '';
  const totalSaved = usage ? Object.values(usage).reduce((n, u) => n + u.bytes, 0) : 0;

  return (
    <div className="st-stack" data-testid="offline-settings">
      <FormSection title={t('title')} description={t('desc')}>
        <label className="ui-switch st-offline-switch" htmlFor="offline-enabled">
          <input id="offline-enabled" type="checkbox" role="switch" checked={prefs.enabled} onChange={(e) => toggleEnabled(e.target.checked)} />
          <span>{t('enabled')}</span>
        </label>
        <p className="ui-help">{prefs.enabled ? t('enabledHelp') : t('disabledHelp')}</p>
        {confirmOff && (
          <div className="st-callout" role="alertdialog" aria-labelledby="offline-confirm-title" aria-describedby="offline-confirm-body">
            <p id="offline-confirm-title" className="st-strong">
              {t('confirmTitle', { n: pending })}
            </p>
            <p id="offline-confirm-body" className="ui-help">
              {t('confirmBody')}
            </p>
            <div className="st-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                autoFocus
                onClick={() => {
                  setConfirmOff(false);
                  apply({ ...prefs, enabled: false }, t('turnedOff'));
                }}
              >
                {t('confirmOff')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmOff(false)}>
                {t('keepOn')}
              </button>
            </div>
          </div>
        )}
        <fieldset className="st-fieldset st-offline-apps" disabled={!prefs.enabled}>
          <legend className="st-subtitle">{t('appsTitle')}</legend>
          {OFFLINE_APPS.map((a) => (
            <label key={a} className="ui-check st-email-pref" htmlFor={`offline-app-${a}`}>
              <input
                id={`offline-app-${a}`}
                type="checkbox"
                checked={prefs.apps[a]}
                onChange={(e) => apply({ ...prefs, apps: { ...prefs.apps, [a]: e.target.checked } })}
              />
              <span>
                <span className="st-email-pref-label">{t(`apps.${a}`)}</span>
                <span className="ui-help st-email-pref-help">
                  {t(`appsHelp.${a}`)}
                  {appUsage(a) ? ` · ${appUsage(a)}` : ''}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <fieldset className="st-fieldset st-offline-size" disabled={!prefs.enabled}>
          <legend className="st-subtitle">{t('sizeTitle')}</legend>
          {OFFLINE_SIZES.map((size) => (
            <label key={size} className="ui-check st-email-pref st-radio" htmlFor={`offline-size-${size}`}>
              <input id={`offline-size-${size}`} type="radio" name="offline-size" checked={prefs.size === size} onChange={() => apply({ ...prefs, size })} />
              <span>
                <span className="st-email-pref-label">{t(`sizes.${size}`)}</span>
                <span className="ui-help st-email-pref-help">
                  {t('sizeHelp', { pages: OFFLINE_LIMITS[size].pages, size: formatBytes(OFFLINE_LIMITS[size].mb * 1024 * 1024, locale) })}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="ui-field st-offline-days">
          <label className="label" htmlFor="offline-days">
            {t('daysLabel')}
          </label>
          <select
            id="offline-days"
            className="select"
            value={prefs.days}
            disabled={!prefs.enabled}
            onChange={(e) => apply({ ...prefs, days: Number(e.target.value) as OfflinePrefs['days'] })}
          >
            {OFFLINE_DAYS.map((d) => (
              <option key={d} value={d}>
                {t('days', { n: d })}
              </option>
            ))}
          </select>
          <p className="ui-help">{t('daysHelp')}</p>
        </div>
        <p className="ui-help st-offline-status" role="status" aria-live="polite">
          {status}
        </p>
      </FormSection>

      <FormSection title={t('storageTitle')} description={t('storageDesc')}>
        {worker === 'none' ? (
          <p className="ui-help">{t('noWorker')}</p>
        ) : (
          <dl className="st-facts st-offline-usage" data-testid="offline-usage">
            <div>
              <dt>{t('savedHere')}</dt>
              <dd className="data">{usage ? formatBytes(totalSaved, locale) : t('measuring')}</dd>
            </div>
            <div>
              <dt>{t('appFiles')}</dt>
              <dd className="data">{usage ? formatBytes(usage.static.bytes, locale) : t('measuring')}</dd>
            </div>
            {estimate && (
              <div>
                <dt>{t('browserTotal')}</dt>
                <dd className="data">{t('ofQuota', { used: formatBytes(estimate.usage, locale), quota: formatBytes(estimate.quota, locale) })}</dd>
              </div>
            )}
          </dl>
        )}
        <div className="st-actions">
          <button
            type="button"
            className="btn btn-sm"
            disabled={worker !== 'ready'}
            onClick={async () => {
              await post({ type: 'zs-offline-clear' });
              setStatus(t('cleared'));
            }}
          >
            {t('clear')}
          </button>
          <span className="ui-help">{t('clearHelp')}</span>
        </div>
      </FormSection>

      <FormSection title={t('pendingTitle')} description={t('pendingDesc')}>
        <p className="st-offline-pending" data-testid="offline-pending">
          <span className="data st-strong">{pending}</span> {t('pendingCount', { n: pending })}
        </p>
        {pending > 0 && (
          <ul className="st-offline-pending-list">
            {queue.count > 0 && <li>{t('pendingQueue', { n: queue.count })}</li>}
            {queue.failed > 0 && <li>{t('pendingFailed', { n: queue.failed })}</li>}
            {local.docs > 0 && <li>{t('pendingDocs', { n: local.docs })}</li>}
            {local.notes > 0 && <li>{t('pendingNotes', { n: local.notes })}</li>}
          </ul>
        )}
      </FormSection>
    </div>
  );
}
