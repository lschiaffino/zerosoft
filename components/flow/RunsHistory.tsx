'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import DataTable from '@/components/ui/DataTable';
import EmptyState from '@/components/ui/EmptyState';
import PageHeader from '@/components/ui/PageHeader';
import type { FlowStats, GlobalRunDto } from '@/lib/flow-monitor';
import { RUN_FILTER_STATUSES, RUN_RANGES } from '@/lib/flow-monitor-shared';
import { parseDbUtc } from '@/lib/utils';
import { i18nKey, RUN_BADGE, stepErrorInfo } from './flow-ui';

interface Props {
  flows: Array<{ id: string; name: string }>;
  initialStats: FlowStats;
  /** Filtros de la URL (?status=&flow=&q=&days=). */
  initial: { status: string; flow: string; q: string; days: number };
}

function durationLabel(ms: number | null): string {
  if (ms === null) return '';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

/**
 * Historial de corridas de todos los flows (/app/flow/runs): tablero de uso
 * y fallas, la cola de ahora, búsqueda con filtros y exportación.
 */
export default function RunsHistory({ flows, initialStats, initial }: Props) {
  const t = useTranslations('flow');
  const format = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  const [status, setStatus] = useState(initial.status);
  const [flowId, setFlowId] = useState(initial.flow);
  const [q, setQ] = useState(initial.q);
  const [days, setDays] = useState(initial.days);
  const [stats, setStats] = useState<FlowStats>(initialStats);
  const [runs, setRuns] = useState<GlobalRunDto[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState(false);
  const seq = useRef(0);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (status) p.set('status', status);
    if (flowId) p.set('flow', flowId);
    if (q.trim()) p.set('q', q.trim());
    p.set('days', String(days));
    return p;
  }, [status, flowId, q, days]);

  const load = useCallback(
    async (before?: string) => {
      const id = ++seq.current;
      if (before) setMore(true);
      else setLoading(true);
      setError(false);
      const p = new URLSearchParams(query);
      if (before) p.set('before', before);
      const res = await fetch(`/api/flow/runs?${p.toString()}`).catch(() => null);
      const data = (await res?.json().catch(() => null)) as { runs?: GlobalRunDto[]; nextBefore?: string | null } | null;
      if (id !== seq.current) return;
      setLoading(false);
      setMore(false);
      if (!res?.ok || !data?.runs) {
        setError(true);
        return;
      }
      setRuns((list) => (before ? [...(list ?? []), ...data.runs!] : data.runs!));
      setNext(data.nextBefore ?? null);
    },
    [query],
  );

  // Búsqueda con texto: espera a que se deje de escribir.
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), q ? 300 : 0);
    // La URL refleja los filtros (se puede compartir o volver atrás).
    const url = new URL(window.location.href);
    url.search = query.toString();
    window.history.replaceState(window.history.state, '', url);
    return () => window.clearTimeout(timer);
  }, [load, q, query]);

  useEffect(() => {
    if (days === initialStats.days) return;
    let alive = true;
    void fetch(`/api/flow/stats?days=${days}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { stats?: FlowStats } | null) => {
        if (alive && d?.stats) setStats(d.stats);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [days, initialStats.days]);

  const maxDay = Math.max(1, ...stats.perDay.map((d) => d.success + d.failed + d.other));
  const exportHref = (fmt: 'csv' | 'json') => `/api/flow/runs/export?format=${fmt}&${query.toString()}`;
  const filtered = Boolean(status || flowId || q.trim());
  /** Error legible ("classify: ai_disabled" → el texto de stepErrors); el código queda en el title. */
  const errorLabel = (raw: string | null) => {
    if (!raw) return '';
    const code = raw.replace(/^[A-Za-z0-9_-]+: /, '');
    const info = stepErrorInfo(code);
    if (info) return t(`stepErrors.${info.key}`, info.values ?? {});
    return t.has(`errors.${code}`) ? t(`errors.${code}`) : code;
  };

  return (
    <div className="ui-page flow-page">
      <PageHeader
        back={{ href: '/app/flow', label: t('title') }}
        title={t('history.title')}
        description={t('history.subtitle')}
        actions={
          <span className="flow-row-actions">
            <a className="btn btn-secondary" href={exportHref('csv')} download>
              {t('history.exportCsv')}
            </a>
            <a className="btn btn-ghost" href={exportHref('json')} download>
              {t('history.exportJson')}
            </a>
          </span>
        }
      />

      <section className="flow-block" aria-labelledby="flow-usage-title">
        <div className="flow-block-head flow-usage-head">
          <h2 id="flow-usage-title" className="flow-block-title">
            {t('history.usage')}
          </h2>
          <label className="flow-inline-field">
            <span className="sr-only">{t('history.range')}</span>
            <select className="select" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label={t('history.range')}>
              {RUN_RANGES.map((d) => (
                <option key={d} value={d}>
                  {t('history.lastDays', { n: d })}
                </option>
              ))}
            </select>
          </label>
        </div>
        <dl className="flow-kpis">
          <div className="flow-kpi">
            <dt>{t('history.kpiRuns')}</dt>
            <dd>{format.number(stats.total)}</dd>
          </div>
          <div className="flow-kpi">
            <dt>{t('history.kpiSuccess')}</dt>
            <dd>{stats.successRate === null ? '–' : format.number(stats.successRate, { style: 'percent', maximumFractionDigits: 1 })}</dd>
          </div>
          <div className="flow-kpi">
            <dt>{t('history.kpiFailed')}</dt>
            <dd className={stats.byStatus.failed ? 'is-bad' : undefined}>{format.number(stats.byStatus.failed ?? 0)}</dd>
          </div>
          <div className="flow-kpi">
            <dt>{t('history.kpiSteps')}</dt>
            <dd>{format.number(stats.steps)}</dd>
          </div>
          <div className="flow-kpi">
            <dt>{t('history.kpiDuration')}</dt>
            <dd>{durationLabel(stats.avgDurationMs) || '–'}</dd>
          </div>
        </dl>
        <div className="flow-chart" role="img" aria-label={t('history.chartLabel', { n: stats.total, days: stats.days })}>
          {stats.perDay.map((d) => {
            const total = d.success + d.failed + d.other;
            return (
              <div className="flow-chart-col" key={d.day} title={`${d.day}: ${total}`}>
                <div className="flow-chart-bar" style={{ height: `${(total / maxDay) * 100}%` }}>
                  {d.failed > 0 && <span className="is-failed" style={{ flexGrow: d.failed }} />}
                  {d.other > 0 && <span className="is-other" style={{ flexGrow: d.other }} />}
                  {d.success > 0 && <span className="is-success" style={{ flexGrow: d.success }} />}
                </div>
              </div>
            );
          })}
        </div>
        <p className="flow-chart-legend ui-help">
          <span className="flow-dot is-success" /> {t('runs.status.success')} <span className="flow-dot is-failed" /> {t('runs.status.failed')}{' '}
          <span className="flow-dot is-other" /> {t('history.other')}
        </p>
        <div className="flow-usage-grid">
          <div>
            <h3 className="flow-usage-sub">{t('history.queue')}</h3>
            <ul className="flow-queue">
              {(['queued', 'held', 'running', 'waiting'] as const).map((k) => (
                <li key={k}>
                  <button
                    type="button"
                    className="flow-link"
                    onClick={() => setStatus(k)}
                    aria-label={`${t(`history.status.${k}`)}: ${stats.queue[k]}`}
                  >
                    <span className={`flow-dot is-q-${k}`} aria-hidden="true" /> {t(`history.status.${k}`)} <strong className="data">{stats.queue[k]}</strong>
                  </button>
                </li>
              ))}
            </ul>
            {stats.topErrors.length > 0 && (
              <>
                <h3 className="flow-usage-sub">{t('history.topErrors')}</h3>
                <ul className="flow-errors-list">
                  {stats.topErrors.map((e) => (
                    <li key={e.error}>
                      <button type="button" className="flow-link" title={e.error} onClick={() => setQ(e.error)}>
                        {errorLabel(e.error)}
                      </button>{' '}
                      <span className="flow-muted">× {e.count}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <div>
            <h3 className="flow-usage-sub">{t('history.byFlow')}</h3>
            {stats.perFlow.length === 0 ? (
              <p className="ui-help">{t('history.noRunsRange')}</p>
            ) : (
              <table className="flow-mini-table">
                <thead>
                  <tr>
                    <th scope="col">{t('list.name')}</th>
                    <th scope="col" className="num">
                      {t('history.kpiRuns')}
                    </th>
                    <th scope="col" className="num">
                      {t('history.kpiFailed')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {stats.perFlow.slice(0, 8).map((f) => (
                    <tr key={f.flowId}>
                      <td>
                        <button type="button" className="flow-link flow-ellipsis" onClick={() => setFlowId(f.flowId)}>
                          {f.name}
                        </button>
                      </td>
                      <td className="num">{f.runs}</td>
                      <td className={`num${f.failed ? ' is-bad' : ''}`}>{f.failed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </section>

      <section className="flow-block" aria-labelledby="flow-history-title">
        <h2 id="flow-history-title" className="flow-block-title">
          {t('history.runs')}
        </h2>
        <div className="flow-filters" role="search">
          <input
            type="search"
            className="input flow-filter-q"
            placeholder={t('history.search')}
            aria-label={t('history.search')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('history.statusFilter')}>
            <option value="">{t('history.allStatuses')}</option>
            {RUN_FILTER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`history.status.${s}`)}
              </option>
            ))}
          </select>
          <select className="select" value={flowId} onChange={(e) => setFlowId(e.target.value)} aria-label={t('history.flowFilter')}>
            <option value="">{t('history.allFlows')}</option>
            {flows.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          {filtered && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setStatus('');
                setFlowId('');
                setQ('');
              }}
            >
              {t('history.clear')}
            </button>
          )}
        </div>
        <p className="ui-help">{t('history.searchHint')}</p>
        {error ? (
          <div className="ui-error" role="alert">
            {t('runs.loadError')}{' '}
            <button type="button" className="flow-link" onClick={() => void load()}>
              {t('editor.retry')}
            </button>
          </div>
        ) : loading && !runs ? (
          <div className="ui-loading-stack" aria-busy="true" aria-label={t('runs.loading')}>
            <div className="ui-skeleton ui-skeleton-row" />
            <div className="ui-skeleton ui-skeleton-row" />
            <div className="ui-skeleton ui-skeleton-row" />
          </div>
        ) : (
          <div aria-busy={loading || undefined}>
            <DataTable
              caption={t('history.runs')}
              className="flow-table flow-table-history"
              rows={runs ?? []}
              rowKey={(r) => r.id}
              rowHref={(r) => `/app/flow/${r.flowId}?run=${r.id}`}
              empty={
                <EmptyState
                  title={filtered ? t('history.noMatchTitle') : t('history.emptyTitle')}
                  body={filtered ? t('history.noMatchBody') : t('history.emptyBody')}
                />
              }
              columns={[
                {
                  key: 'flow',
                  header: t('history.flow'),
                  cell: (r) => <span className="flow-ellipsis">{r.flowName}</span>,
                },
                {
                  key: 'status',
                  header: t('list.status'),
                  width: '110px',
                  cell: (r) => (
                    <span className={`badge ${RUN_BADGE[r.held ? 'held' : r.status] ?? ''}`}>
                      {r.held ? t('history.status.held') : t(`runs.status.${r.status}`)}
                    </span>
                  ),
                },
                {
                  key: 'trigger',
                  header: t('list.trigger'),
                  cell: (r) => (
                    <span className="flow-muted flow-ellipsis">
                      {t.has(`runs.triggers.${i18nKey(r.triggerType)}`) ? t(`runs.triggers.${i18nKey(r.triggerType)}`) : r.triggerType}
                    </span>
                  ),
                },
                {
                  key: 'when',
                  header: t('history.when'),
                  cell: (r) => (
                    <span className="flow-muted" suppressHydrationWarning title={parseDbUtc(r.createdAt).toLocaleString()}>
                      {format.relativeTime(parseDbUtc(r.createdAt), now)}
                    </span>
                  ),
                },
                { key: 'duration', header: t('history.duration'), numeric: true, cell: (r) => durationLabel(r.durationMs) },
                {
                  key: 'error',
                  header: t('history.error'),
                  data: true,
                  cell: (r) => (
                    <span className="flow-ellipsis flow-error-cell" title={r.error ?? undefined}>
                      {errorLabel(r.error)}
                    </span>
                  ),
                },
              ]}
            />
            {next && (
              <button type="button" className="btn btn-secondary btn-sm flow-more" aria-busy={more || undefined} onClick={() => void load(next)}>
                {t('history.more')}
              </button>
            )}
          </div>
        )}
      </section>
      <p className="ui-help">
        <Link href="/app/flow">{t('history.backToFlows')}</Link>
      </p>
    </div>
  );
}
