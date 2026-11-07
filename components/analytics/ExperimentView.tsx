'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { ExperimentDto, ExperimentMetric, ExperimentResults } from '@/lib/analytics/types';
import { ApiError, api, fmtNumber, fmtPercent, fmtTime, notifyChanged } from './client';
import { EventInput, FilterList, cleanFilters, useProjectMeta } from './Filters';
import { useMounted } from '@/components/ui/useMounted';

/**
 * Un experimento: hipótesis, flag, métricas y resultados (chance de ser la
 * mejor, cambio contra control e intervalo). Se edita en borrador; empieza y
 * termina con un botón; al terminar se puede llevar a todos a la ganadora.
 */
export default function ExperimentView({ projectId, experiment, flags, canManage = false }: { projectId: string; experiment: ExperimentDto; flags: Array<{ id: string; key: string; variants: number }>; canManage?: boolean }) {
  const t = useTranslations('analytics.experiments');
  const tc = useTranslations('analytics.common');
  const locale = useLocale();
  const router = useRouter();
  const mounted = useMounted();
  const meta = useProjectMeta(projectId);
  const [name, setName] = useState(experiment.name);
  const [hypothesis, setHypothesis] = useState(experiment.hypothesis);
  const [metrics, setMetrics] = useState<ExperimentMetric[]>(experiment.metrics);
  const [results, setResults] = useState<ExperimentResults | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [shipping, setShipping] = useState<string | null>(null);
  const draft = experiment.status === 'draft';

  useEffect(() => {
    if (draft) return;
    setLoadError(false);
    api<{ results: ExperimentResults }>(`/api/analytics/experiments/${experiment.id}`)
      .then((r) => setResults(r.results))
      .catch(() => setLoadError(true));
  }, [experiment.id, experiment.status, draft]);

  const patch = async (body: Record<string, unknown>, ok = t('saved')) => {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/analytics/experiments/${experiment.id}`, { method: 'PATCH', body });
      setMsg({ ok: true, text: ok });
      notifyChanged();
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError && t.has(`errors.${err.code}`) ? t(`errors.${err.code}`) : tc('error') });
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    patch({ name, hypothesis, metrics: metrics.map((m) => ({ ...m, event: m.event.trim() || '$pageview', filters: cleanFilters(m.filters), mathProperty: m.mathProperty || null })) });

  return (
    <div className="app-page ui-page an-page">
      <PageHeader
        back={{ href: '/app/analytics/experiments', label: t('title') }}
        title={experiment.name}
        description={t(`status.${experiment.status}`)}
        actions={
          <>
            {experiment.status === 'draft' && (
              <button type="button" className="btn btn-primary" disabled={busy || !canManage} title={canManage ? undefined : t('adminsOnly')} onClick={() => void patch({ action: 'start' }, t('started'))}>
                {t('start')}
              </button>
            )}
            {experiment.status === 'running' && (
              <button type="button" className="btn" disabled={busy || !canManage} title={canManage ? undefined : t('adminsOnly')} onClick={() => void patch({ action: 'stop' }, t('stopped'))}>
                {t('stop')}
              </button>
            )}
            <button type="button" className="btn btn-ghost" disabled={!canManage} title={canManage ? undefined : t('adminsOnly')} onClick={() => setDeleting(true)}>
              {tc('delete')}
            </button>
          </>
        }
      />
      {msg && (
        <p className={msg.ok ? 'an-saved' : 'ui-error'} role={msg.ok ? 'status' : 'alert'}>
          {msg.text}
        </p>
      )}
      <form
        className="an-form an-panel"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="ui-field">
          <span className="label">{t('name')}</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required />
        </label>
        <label className="ui-field">
          <span className="label">{t('hypothesis')}</span>
          <textarea className="textarea" rows={2} value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} maxLength={2000} placeholder={t('hypothesisPlaceholder')} />
        </label>
        <div className="ui-field">
          <span className="label">{t('flag')}</span>
          {draft ? (
            <select className="select" value={experiment.flagId} disabled={busy} onChange={(e) => void patch({ flagId: e.target.value })}>
              {flags.map((f) => (
                <option key={f.id} value={f.id} disabled={f.variants < 2}>
                  {f.key}
                  {f.variants < 2 ? ` (${t('flagNotMulti')})` : ''}
                </option>
              ))}
            </select>
          ) : (
            <p className="an-mono an-flush">{experiment.flagKey}</p>
          )}
          <span className="ui-help">
            <Link className="an-link" href={`/app/analytics/flags/${experiment.flagId}`}>
              {t('openFlag')}
            </Link>{' '}
            {t('flagHelp')}
          </span>
        </div>
        {metrics.map((m, i) => (
          <fieldset key={i} className="an-series">
            <legend className="an-series-legend">{t('metricN', { n: i + 1 })}</legend>
            <div className="an-row an-wrap">
              <EventInput value={m.event} onChange={(event) => setMetrics(metrics.map((x, j) => (j === i ? { ...x, event } : x)))} meta={meta} label={t('metricEvent')} />
              <select className="select" aria-label={t('metricType')} value={m.type} onChange={(e) => setMetrics(metrics.map((x, j) => (j === i ? { ...x, type: e.target.value as ExperimentMetric['type'] } : x)))}>
                <option value="conversion">{t('types.conversion')}</option>
                <option value="mean">{t('types.mean')}</option>
              </select>
              {m.type === 'mean' && (
                <input
                  className="input"
                  aria-label={t('metricProperty')}
                  placeholder={t('metricProperty')}
                  value={m.mathProperty ?? ''}
                  onChange={(e) => setMetrics(metrics.map((x, j) => (j === i ? { ...x, mathProperty: e.target.value || null } : x)))}
                />
              )}
              {metrics.length > 1 && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMetrics(metrics.filter((_, j) => j !== i))}>
                  {tc('remove')}
                </button>
              )}
            </div>
            <FilterList filters={m.filters} onChange={(filters) => setMetrics(metrics.map((x, j) => (j === i ? { ...x, filters } : x)))} meta={meta} />
          </fieldset>
        ))}
        <div className="an-row an-wrap">
          <button type="button" className="btn btn-sm" disabled={metrics.length >= 3} title={metrics.length >= 3 ? t('metricsMax') : undefined} onClick={() => setMetrics([...metrics, { event: '$pageview', filters: [], type: 'conversion', mathProperty: null }])}>
            + {t('addMetric')}
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
            {tc('save')}
          </button>
        </div>
      </form>

      <section className="an-panel an-form" aria-label={t('results')} data-testid="an-experiment-results">
        <h2 className="an-h3 an-flush">{t('results')}</h2>
        {draft && <p className="an-muted">{t('resultsDraft')}</p>}
        {!draft && (
          <p className="an-note">
            {experiment.startedAt && mounted ? t('since', { date: fmtTime(experiment.startedAt, locale) }) : ''}
            {experiment.endedAt && mounted ? ` · ${t('until', { date: fmtTime(experiment.endedAt, locale) })}` : ''}
          </p>
        )}
        {loadError && (
          <p className="ui-error" role="alert">
            {tc('error')}
          </p>
        )}
        {!draft && !results && !loadError && <span className="ui-skeleton ui-skeleton-block" />}
        {results && results.exposedTotal === 0 && <p className="an-muted">{t('noExposures', { key: experiment.flagKey })}</p>}
        {results && results.exposedTotal > 0 && (
          <>
            <p className="an-note">
              {t('exposed', { count: results.exposedTotal })}
              {results.multipleVariants > 0 && ` · ${t('multiple', { count: results.multipleVariants })}`}
            </p>
            {results.sampleMismatch && (
              <p className="ui-error" role="alert">
                {t('mismatch')}
              </p>
            )}
            {results.metrics.map((m, i) => (
              <div key={i} className="an-form">
                <h3 className="an-h4">
                  {m.metric.event} · {t(`types.${m.metric.type}`)}
                  {m.winner ? ` · ${t('winner', { key: m.winner })}` : ` · ${t('noWinner')}`}
                </h3>
                <div className="table-wrap">
                  <table className="table table-compact an-table">
                    <thead>
                      <tr>
                        <th scope="col">{t('variant')}</th>
                        <th scope="col" className="num">
                          {t('exposedHead')}
                        </th>
                        <th scope="col" className="num">
                          {m.metric.type === 'conversion' ? t('rate') : t('mean')}
                        </th>
                        <th scope="col" className="num">
                          {t('interval')}
                        </th>
                        <th scope="col" className="num">
                          {t('uplift')}
                        </th>
                        <th scope="col" className="num">
                          {t('chance')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.variants.map((v) => {
                        const fmt = (x: number) => (m.metric.type === 'conversion' ? fmtPercent(x, locale) : fmtNumber(x, locale));
                        return (
                          <tr key={v.key}>
                            <th scope="row" className="an-mono">
                              {v.key}
                            </th>
                            <td className="num">{fmtNumber(v.exposed, locale)}</td>
                            <td className="num">{fmt(v.rate)}</td>
                            <td className="num an-nowrap">
                              {fmt(v.low)} – {fmt(v.high)}
                            </td>
                            <td className="num">{v.uplift === null ? '–' : fmtPercent(v.uplift, locale)}</td>
                            <td className="num">{fmtPercent(v.chanceBest, locale)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
            {results.truncated && <p className="an-note">{t('truncated')}</p>}
            {experiment.status === 'stopped' && (
              <div className="an-row an-wrap">
                <span className="label">{t('shipLabel')}</span>
                {(results.metrics[0]?.variants ?? []).map((v) => (
                  <button key={v.key} type="button" className="btn btn-sm" disabled={!canManage} title={canManage ? undefined : t('adminsOnly')} onClick={() => setShipping(v.key)}>
                    {t('ship', { key: v.key })}
                  </button>
                ))}
                {experiment.conclusion && <span className="an-saved">{t('shipped', { key: experiment.conclusion })}</span>}
              </div>
            )}
          </>
        )}
      </section>
      <ConfirmDialog
        open={shipping !== null}
        title={t('shipTitle', { key: shipping ?? '' })}
        body={t('shipBody', { flag: experiment.flagKey })}
        confirmLabel={t('ship', { key: shipping ?? '' })}
        cancelLabel={tc('cancel')}
        busy={busy}
        onCancel={() => setShipping(null)}
        onConfirm={async () => {
          if (shipping) await patch({ ship: shipping }, t('shipped', { key: shipping }));
          setShipping(null);
        }}
      />
      <ConfirmDialog
        open={deleting}
        title={t('deleteTitle', { name: experiment.name })}
        body={t('deleteBody')}
        confirmLabel={tc('delete')}
        cancelLabel={tc('cancel')}
        danger
        busy={busy}
        onCancel={() => setDeleting(false)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api(`/api/analytics/experiments/${experiment.id}`, { method: 'DELETE' });
            notifyChanged();
            router.replace('/app/analytics/experiments');
          } catch {
            setBusy(false);
            setDeleting(false);
            setMsg({ ok: false, text: tc('error') });
          }
        }}
      />
    </div>
  );
}
