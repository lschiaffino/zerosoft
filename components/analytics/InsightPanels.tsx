'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { AlertDto, CorrelationResult, FunnelQuery, InsightResult } from '@/lib/analytics/types';
import { csvLines, resultRows } from '@/lib/analytics/compute-more';
import { ApiError, api, fmtNumber, notifyChanged } from './client';

interface ShareRowDto {
  id: string;
  token: string;
  created_at: string;
  options: { theme?: 'system' | 'light' | 'dark'; legend?: boolean };
  passwords: Array<{ id: string; note: string; createdAt: string }>;
}
interface ShareLogDto {
  action: string;
  personId: string | null;
  createdAt: string;
}

/** Link público de un insight o un tablero: crear, copiar, código para embeber y revocar. Solo admins. */
export function ShareDialog({ open, onClose, projectId, target }: { open: boolean; onClose: () => void; projectId: string; target: { insightId?: string; dashboardId?: string } }) {
  const t = useTranslations('analytics.share');
  const tc = useTranslations('analytics.common');
  const locale = useLocale();
  const ref = useRef<HTMLDialogElement>(null);
  const [shares, setShares] = useState<ShareRowDto[] | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [log, setLog] = useState<ShareLogDto[]>([]);
  const [dependsOn, setDependsOn] = useState<Array<{ kind: 'cohort' | 'action'; name: string }>>([]);
  const [note, setNote] = useState('');
  const [shown, setShown] = useState<{ share: string; password: string } | null>(null);
  const param = target.insightId ? `insight=${encodeURIComponent(target.insightId)}` : `dashboard=${encodeURIComponent(target.dashboardId ?? '')}`;

  useEffect(() => {
    setOrigin(window.location.origin);
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setError(false);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId, param]);

  const load = () =>
    api<{ shares: ShareRowDto[]; log: ShareLogDto[]; dependsOn: Array<{ kind: 'cohort' | 'action'; name: string }> }>(`/api/analytics/shares?project=${encodeURIComponent(projectId)}&${param}`)
      .then((r) => {
        setShares(r.shares);
        setLog(r.log);
        setDependsOn(r.dependsOn);
      })
      .catch(() => setError(true));
  /** Un cambio en un link y volver a leer: las opciones, las contraseñas y el historial. */
  const change = async (id: string, body: { options?: ShareRowDto['options'] } & Record<string, unknown>) => {
    setBusy(true);
    setError(false);
    // La opción se ve cambiada al toque; si falla, load() la vuelve a como está guardada.
    if (body.options) setShares((list) => (list ?? []).map((x) => (x.id === id ? { ...x, options: { ...x.options, ...body.options } } : x)));
    try {
      const r = await api<{ password?: { password: string } }>(`/api/analytics/shares/${id}`, { method: 'PATCH', body });
      if (r.password) setShown({ share: id, password: r.password.password });
      await load();
    } catch {
      setError(true);
      await load();
    } finally {
      setBusy(false);
    }
  };
  const create = async () => {
    setBusy(true);
    setError(false);
    try {
      const r = await api<{ share: ShareRowDto }>('/api/analytics/shares', { body: { projectId, ...target } });
      setShares((s) => [r.share, ...(s ?? [])]);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (id: string) => {
    setBusy(true);
    try {
      await api(`/api/analytics/shares/${id}`, { method: 'DELETE' });
      setShares((s) => (s ?? []).filter((x) => x.id !== id));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const copy = (text: string, key: string) => {
    void navigator.clipboard?.writeText(text);
    setCopied(key);
  };

  return (
    <dialog
      ref={ref}
      className="ui-modal an-share-dialog"
      aria-labelledby="an-share-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ui-modal-head">
        <h2 id="an-share-title" className="ui-modal-title">
          {t('title')}
        </h2>
      </div>
      <div className="ui-modal-body an-form">
        <p className="an-note">{t('warning')}</p>
        {error && (
          <p className="ui-error" role="alert">
            {tc('error')}
          </p>
        )}
        {shares === null && !error && <span className="ui-skeleton ui-skeleton-block" />}
        {shares?.length === 0 && <p className="an-muted">{t('none')}</p>}
        {shares?.map((s) => {
          const url = `${origin}/${locale}/stats/a/${s.token}`;
          const embed = `<iframe name="zs-${s.id}" src="${url}?embed=1" width="100%" height="480" style="border:0" title="zerosoft Pulse"></iframe>\n<script>addEventListener('message',function(e){if(e.data&&e.data.event==='zs:dimensions'&&e.data.name==='zs-${s.id}')document.querySelector('iframe[name="zs-${s.id}"]').height=e.data.height})</script>`;
          return (
            <div key={s.id} className="an-share-row" data-testid="an-share-row">
              <input className="input an-mono" readOnly value={url} aria-label={t('link')} onFocus={(e) => e.currentTarget.select()} />
              <div className="an-row an-wrap">
                <button type="button" className="btn btn-sm" onClick={() => copy(url, `${s.id}:u`)}>
                  {copied === `${s.id}:u` ? tc('copied') : t('copyLink')}
                </button>
                <button type="button" className="btn btn-sm" onClick={() => copy(embed, `${s.id}:e`)}>
                  {copied === `${s.id}:e` ? tc('copied') : t('copyEmbed')}
                </button>
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void change(s.id, { rotateToken: true })}>
                  {t('rotate')}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void revoke(s.id)}>
                  {t('revoke')}
                </button>
              </div>
              <div className="an-row an-wrap">
                <label className="ui-field an-inline-field">
                  <span className="label">{t('theme')}</span>
                  <select className="select" value={s.options.theme ?? 'system'} disabled={busy} onChange={(e) => void change(s.id, { options: { theme: e.target.value as 'system' | 'light' | 'dark' } })}>
                    <option value="system">{t('themeSystem')}</option>
                    <option value="light">{t('themeLight')}</option>
                    <option value="dark">{t('themeDark')}</option>
                  </select>
                </label>
                <label className="ui-check">
                  <input type="checkbox" checked={s.options.legend !== false} disabled={busy} onChange={(e) => void change(s.id, { options: { legend: e.target.checked } })} /> {t('showLegend')}
                </label>
              </div>
              <div className="an-form-tight">
                <span className="label">{t('passwords')}</span>
                <p className="ui-help">{s.passwords.length ? t('passwordsOn') : t('passwordsOff')}</p>
                {s.passwords.map((p) => (
                  <div key={p.id} className="an-row an-wrap">
                    <span className="an-small">{p.note || t('passwordNoNote')}</span>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void change(s.id, { removePassword: p.id })}>
                      {t('passwordRemove')}
                    </button>
                  </div>
                ))}
                <div className="an-row an-wrap">
                  <input className="input an-filter-key" aria-label={t('passwordNote')} placeholder={t('passwordNote')} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={busy}
                    onClick={() => {
                      void change(s.id, { addPassword: { note } });
                      setNote('');
                    }}
                  >
                    {t('passwordAdd')}
                  </button>
                </div>
                {shown?.share === s.id && (
                  <p className="an-note" role="status">
                    {t('passwordOnce')} <code className="an-mono" data-testid="an-share-password">{shown.password}</code>
                  </p>
                )}
              </div>
            </div>
          );
        })}
        {shares && shares.length > 0 && dependsOn.length > 0 && (
          <p className="an-note" data-testid="an-share-depends">
            {t('dependsOn', { list: dependsOn.map((d) => d.name).join(', ') })}
          </p>
        )}
        {log.length > 0 && (
          <details className="an-more">
            <summary>{t('history')}</summary>
            <ul className="an-share-log" role="list">
              {log.map((l, i) => (
                <li key={i} className="an-small">
                  {t(`logActions.${l.action}`)} · {new Date(l.createdAt).toLocaleString(locale)}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <div className="ui-modal-foot">
        <button type="button" className="btn btn-sm" onClick={onClose}>
          {tc('close')}
        </button>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void create()}>
          {t('create')}
        </button>
      </div>
    </dialog>
  );
}

/** Descarga un resultado de insight como CSV (sin ir al servidor: es lo que ya se está viendo). */
export function downloadCsv(result: InsightResult, name: string): void {
  const blob = new Blob([csvLines(resultRows(result))], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name.replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 80) || 'insight'}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

const CONDITIONS = ['above', 'below', 'increase_pct', 'decrease_pct'] as const;

/** Alertas de un insight de tendencias guardado: cuándo avisar y estado actual. */
export function AlertsPanel({ projectId, insightId, insightName, seriesLabels }: { projectId: string; insightId: string; insightName: string; seriesLabels: string[] }) {
  const t = useTranslations('analytics.alerts');
  const tc = useTranslations('analytics.common');
  const locale = useLocale();
  const id = useId();
  const [alerts, setAlerts] = useState<AlertDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [condition, setCondition] = useState<(typeof CONDITIONS)[number]>('above');
  const [threshold, setThreshold] = useState('100');
  const [frequency, setFrequency] = useState<'hourly' | 'daily'>('daily');
  const [seriesIndex, setSeriesIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<AlertDto | null>(null);

  const load = () =>
    api<{ alerts: AlertDto[] }>(`/api/analytics/alerts?project=${encodeURIComponent(projectId)}&insight=${encodeURIComponent(insightId)}`)
      .then((r) => setAlerts(r.alerts))
      .catch(() => setError(tc('error')));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, insightId]);

  const add = async () => {
    const value = Number(threshold);
    if (!Number.isFinite(value)) {
      setError(t('invalidThreshold'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('/api/analytics/alerts', {
        body: { projectId, insightId, name: t('defaultName', { insight: insightName.slice(0, 120), condition: t(`conditions.${condition}`), value }), seriesIndex, condition, threshold: value, frequency },
      });
      await load();
      notifyChanged();
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'too_many_alerts' ? t('tooMany') : tc('error'));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (a: AlertDto) => {
    try {
      await api(`/api/analytics/alerts/${a.id}`, { method: 'PATCH', body: { enabled: !a.enabled } });
      await load();
    } catch {
      setError(tc('error'));
    }
  };

  return (
    <section className="an-panel an-form" aria-labelledby={id} data-testid="an-alerts-panel">
      <h2 id={id} className="an-h3">
        {t('title')}
      </h2>
      <p className="an-note">{t('help')}</p>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {alerts === null && !error && <span className="ui-skeleton ui-skeleton-block" />}
      {alerts?.length === 0 && <p className="an-muted an-small">{t('none')}</p>}
      {alerts && alerts.length > 0 && (
        <ul className="an-alert-list" role="list">
          {alerts.map((a) => (
            <li key={a.id}>
              <span className={`an-alert-state is-${a.enabled ? a.state : 'off'}`}>{a.enabled ? t(`states.${a.state}`) : t('states.off')}</span>
              <span className="an-alert-text">
                {t('line', { condition: t(`conditions.${a.condition}`), value: fmtNumber(a.threshold, locale), frequency: t(`frequencies.${a.frequency}`) })}
                {a.lastValue !== null && <span className="an-muted"> · {t('lastValue', { value: fmtNumber(a.lastValue, locale) })}</span>}
              </span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void toggle(a)}>
                {a.enabled ? t('pause') : t('resume')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleting(a)} aria-label={`${tc('delete')}: ${a.name}`}>
                {tc('delete')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="an-row an-wrap"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        {seriesLabels.length > 1 && (
          <select className="select" aria-label={t('series')} value={seriesIndex} onChange={(e) => setSeriesIndex(Number(e.target.value))}>
            {seriesLabels.map((l, i) => (
              <option key={i} value={i}>
                {l.slice(0, 60)}
              </option>
            ))}
          </select>
        )}
        <select className="select" aria-label={t('condition')} value={condition} onChange={(e) => setCondition(e.target.value as (typeof CONDITIONS)[number])}>
          {CONDITIONS.map((c) => (
            <option key={c} value={c}>
              {t(`conditions.${c}`)}
            </option>
          ))}
        </select>
        <input className="input an-num-input" type="number" aria-label={t('threshold')} value={threshold} onChange={(e) => setThreshold(e.target.value)} required />
        <select className="select" aria-label={t('frequency')} value={frequency} onChange={(e) => setFrequency(e.target.value as 'hourly' | 'daily')}>
          <option value="hourly">{t('frequencies.hourly')}</option>
          <option value="daily">{t('frequencies.daily')}</option>
        </select>
        <button type="submit" className="btn btn-sm" disabled={busy}>
          {t('add')}
        </button>
      </form>
      <ConfirmDialog
        open={deleting !== null}
        title={t('deleteTitle', { name: deleting?.name ?? '' })}
        body={t('deleteBody')}
        confirmLabel={tc('delete')}
        cancelLabel={tc('cancel')}
        danger
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          setBusy(true);
          try {
            await api(`/api/analytics/alerts/${deleting.id}`, { method: 'DELETE' });
            setDeleting(null);
            await load();
            notifyChanged();
          } catch {
            setError(tc('error'));
          } finally {
            setBusy(false);
          }
        }}
      />
    </section>
  );
}

/** Correlación de un embudo: qué eventos o propiedades acercan o alejan de convertir. */
export function CorrelationPanel({ projectId, funnel }: { projectId: string; funnel: FunnelQuery }) {
  const t = useTranslations('analytics.correlation');
  const tc = useTranslations('analytics.common');
  const locale = useLocale();
  const [source, setSource] = useState<'events' | 'properties'>('events');
  const [result, setResult] = useState<CorrelationResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(false);

  const run = async (src = source) => {
    setRunning(true);
    setError(false);
    try {
      const r = await api<{ result: CorrelationResult }>('/api/analytics/correlation', { body: { projectId, query: { kind: 'correlation', funnel, source: src } } });
      setResult(r.result);
    } catch {
      setError(true);
      setResult(null);
    } finally {
      setRunning(false);
    }
  };

  const rows = result ? [...result.positive, ...result.negative] : [];
  return (
    <section className="an-panel an-form" aria-label={t('title')} data-testid="an-correlation">
      <div className="an-row an-wrap an-between">
        <h2 className="an-h3 an-flush">{t('title')}</h2>
        <div className="an-row an-wrap">
          <select
            className="select"
            aria-label={t('source')}
            value={source}
            onChange={(e) => {
              const s = e.target.value as 'events' | 'properties';
              setSource(s);
              if (result) void run(s);
            }}
          >
            <option value="events">{t('sources.events')}</option>
            <option value="properties">{t('sources.properties')}</option>
          </select>
          <button type="button" className="btn btn-sm" disabled={running} onClick={() => void run()}>
            {running ? tc('loading') : t('run')}
          </button>
        </div>
      </div>
      <p className="an-note">{t('help')}</p>
      {error && (
        <p className="ui-error" role="alert">
          {tc('error')}
        </p>
      )}
      {result && (
        <p className="an-note">{t('compared', { converted: fmtNumber(result.convertedPeople, locale), dropped: fmtNumber(result.droppedPeople, locale) })}</p>
      )}
      {result && rows.length === 0 && <p className="an-muted">{t('nothing')}</p>}
      {result && rows.length > 0 && (
        <div className="table-wrap">
          <table className="table table-compact an-table">
            <thead>
              <tr>
                <th scope="col">{t('signal')}</th>
                <th scope="col" className="num">
                  {t('odds')}
                </th>
                <th scope="col" className="num">
                  {t('converted', { total: fmtNumber(result.convertedPeople, locale) })}
                </th>
                <th scope="col" className="num">
                  {t('dropped', { total: fmtNumber(result.droppedPeople, locale) })}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <td className="an-wrap-cell">
                    <span className={r.odds >= 1 ? 'an-delta is-up' : 'an-delta is-down'} aria-hidden="true">
                      {r.odds >= 1 ? '↑' : '↓'}
                    </span>{' '}
                    {r.name}
                    {!r.significant && <span className="an-muted an-small"> · {t('weak')}</span>}
                  </td>
                  <td className="num">{r.odds >= 1 ? `×${fmtNumber(r.odds, locale)}` : `÷${fmtNumber(1 / Math.max(r.odds, 0.001), locale)}`}</td>
                  <td className="num">{fmtNumber(r.converted, locale)}</td>
                  <td className="num">{fmtNumber(r.dropped, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result?.truncated && <p className="an-note">{t('truncated')}</p>}
    </section>
  );
}
