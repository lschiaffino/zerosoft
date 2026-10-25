'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import EmptyState from '@/components/ui/EmptyState';
import { insightCsv, type InsightResult } from '@/lib/track-planning-core';
import {
  INSIGHT_DIMENSIONS,
  INSIGHT_MEASURES,
  INSIGHT_SLICES,
  type InsightFilters,
  type InsightQuery,
} from '@/lib/track-planning-schema';
import { api, copyText, downloadFile, LoadingRows, Modal } from './shared';
import { BarChart, LineChart, SERIES } from './charts';

const TIME = new Set(['cycle_time', 'lead_time', 'issue_age']);

/** Etiqueta legible de una clave de bucket (status_type y priority se traducen). */
export function useBucketLabel() {
  const t = useTranslations('trackPlanning');
  return useCallback(
    (dim: string, key: string, label: string) => {
      if (key === 'none' && (label === 'none' || !label)) return t('common.none');
      if (dim === 'status_type') return t(`insights.categories.${key}`);
      if (dim === 'priority') return t(`priority.${key}`);
      return label || key;
    },
    [t],
  );
}

/** Un insight dibujado como gráfico, tabla o número (Insights y widgets de dashboards). */
export function InsightView({
  result,
  kind,
  selected,
  onSelect,
}: {
  result: InsightResult;
  kind: 'chart' | 'table' | 'metric';
  selected?: string | null;
  onSelect?: (key: string) => void;
}) {
  const t = useTranslations('trackPlanning');
  const bucketLabel = useBucketLabel();
  const unit = t(`insights.units.${result.unit}`);
  if (kind === 'metric') {
    return (
      <div className="tp-metric" data-testid="tp-metric">
        <span className="tp-metric-value">{result.total}</span>
        <span className="tp-metric-unit">
          {result.unit === 'days' ? t('insights.medianDays') : unit} · {t('insights.issueCount', { count: result.issueCount })}
        </span>
      </div>
    );
  }
  if (result.burnup) {
    if (kind === 'table') {
      return (
        <div className="table-wrap">
          <table className="table table-compact">
            <thead>
              <tr>
                <th scope="col">{t('insights.period')}</th>
                <th scope="col" className="num">{t('cycles.legendScope')}</th>
                <th scope="col" className="num">{t('cycles.legendStarted')}</th>
                <th scope="col" className="num">{t('cycles.legendCompleted')}</th>
              </tr>
            </thead>
            <tbody>
              {result.burnup.map((p) => (
                <tr key={p.key}>
                  <td className="data">{p.label}</td>
                  <td className="num">{p.scope}</td>
                  <td className="num">{p.started}</td>
                  <td className="num">{p.completed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    return (
      <LineChart
        label={t('insights.slices.burnup')}
        labels={result.burnup.map((p) => p.label.slice(5))}
        series={[
          { key: 'scope', label: t('cycles.legendScope'), color: 'var(--ink)', values: result.burnup.map((p) => p.scope) },
          { key: 'started', label: t('cycles.legendStarted'), color: 'var(--c-notes)', values: result.burnup.map((p) => p.started + p.completed), area: true },
          { key: 'completed', label: t('cycles.legendCompleted'), color: 'var(--accent)', values: result.burnup.map((p) => p.completed), area: true },
        ]}
      />
    );
  }
  const segs = result.segmentKeys.map((s) => ({ key: s.key, label: bucketLabel(result.segment, s.key, s.label) }));
  if (kind === 'table') {
    return (
      <div className="table-wrap">
        <table className="table table-compact" data-testid="tp-insight-table">
          <thead>
            <tr>
              <th scope="col">{t(`insights.slices.${result.slice}`)}</th>
              <th scope="col" className="num">{result.unit === 'days' ? t('insights.medianDays') : t(`insights.measures.${result.measure}`)}</th>
              <th scope="col" className="num">{t('insights.issues')}</th>
              {result.unit === 'days' && (
                <>
                  <th scope="col" className="num">{t('insights.avgDays')}</th>
                  <th scope="col" className="num">{t('insights.p90Days')}</th>
                </>
              )}
              {segs.map((s, i) => (
                <th key={s.key} scope="col" className="num">
                  <span className="tp-legend-swatch" style={{ background: SERIES[i % SERIES.length], borderColor: SERIES[i % SERIES.length] }} /> {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.buckets.map((b) => (
              <tr key={b.key} className={selected === b.key ? 'tp-row-on' : undefined}>
                <td>
                  {onSelect ? (
                    <button type="button" className="tp-link-btn" onClick={() => onSelect(b.key)}>
                      {bucketLabel(result.slice, b.key, b.label)}
                    </button>
                  ) : (
                    bucketLabel(result.slice, b.key, b.label)
                  )}
                </td>
                <td className="num">{b.value}</td>
                <td className="num">{b.count}</td>
                {result.unit === 'days' && (
                  <>
                    <td className="num">{b.avg}</td>
                    <td className="num">{b.p90}</td>
                  </>
                )}
                {segs.map((s) => (
                  <td key={s.key} className="num">
                    {b.segments.find((x) => x.key === s.key)?.value ?? 0}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <BarChart
      label={`${t(`insights.measures.${result.measure}`)} · ${t(`insights.slices.${result.slice}`)}`}
      unit={unit}
      data={result.buckets.map((b) => ({
        key: b.key,
        label: bucketLabel(result.slice, b.key, b.label),
        value: b.value,
        segments: b.segments.length ? segs.map((s) => ({ key: s.key, value: b.segments.find((x) => x.key === s.key)?.value ?? 0 })) : undefined,
      }))}
      segmentKeys={segs}
      selected={selected}
      onSelect={onSelect}
    />
  );
}

interface Meta {
  teams: Array<{ id: string; name: string }>;
  plans: Array<{ id: string; name: string }>;
  labels: Array<{ id: string; name: string }>;
}

function readQuery(sp: URLSearchParams): InsightQuery {
  const pick = <T extends string>(v: string | null, all: readonly T[], def: T): T => (v && (all as readonly string[]).includes(v) ? (v as T) : def);
  const filters: InsightFilters = {};
  const list = (k: string) => (sp.get(k) ? sp.get(k)!.split(',').filter(Boolean) : undefined);
  filters.teamIds = list('team');
  filters.planIds = list('plan');
  filters.labelIds = list('label');
  if (sp.get('from')) filters.createdAfter = sp.get('from')!;
  if (sp.get('to')) filters.createdBefore = sp.get('to')!;
  if (sp.get('archived') === '1') filters.includeArchived = true;
  return {
    measure: pick(sp.get('measure'), INSIGHT_MEASURES, 'count'),
    slice: pick(sp.get('slice'), INSIGHT_SLICES, 'status_type'),
    segment: pick(sp.get('segment'), [...INSIGHT_DIMENSIONS, 'none'] as const, 'none'),
    interval: sp.get('interval') === 'month' ? 'month' : 'week',
    filters,
  };
}

/** Insights (como el panel de Linear): medida, slice y segmento, filtros, gráfico, tabla, CSV y "Agregar a dashboard". */
export default function Insights() {
  const t = useTranslations('trackPlanning');
  const router = useRouter();
  const sp = useSearchParams();
  const query = useMemo(() => readQuery(new URLSearchParams(sp.toString())), [sp]);
  const [result, setResult] = useState<InsightResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<Meta>({ teams: [], plans: [], labels: [] });
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const bucketLabel = useBucketLabel();

  useEffect(() => {
    void Promise.all([
      api<{ rows: Array<{ id: string; name: string }>; teams: Array<{ id: string; name: string }> }>('/api/track/plans?meta=1'),
      api<{ rows: Array<{ id: string; name: string }> }>('/api/track/labels'),
    ]).then(([p, l]) => setMeta({ teams: p.ok ? p.data.teams : [], plans: p.ok ? p.data.rows : [], labels: l.ok ? l.data.rows : [] }));
  }, []);

  const run = useCallback(async () => {
    setLoading(true);
    const res = await api<InsightResult>('/api/track/insights', 'POST', query);
    setLoading(false);
    setFailed(!res.ok);
    setResult(res.ok ? res.data : null);
    setSelected(null);
  }, [query]);
  useEffect(() => {
    void run();
  }, [run]);

  const set = (k: string, v: string, def = '') => {
    const q = new URLSearchParams(sp.toString());
    if (!v || v === def) q.delete(k);
    else q.set(k, v);
    router.replace(`/app/track/insights${q.toString() ? `?${q}` : ''}`);
  };

  const isTime = TIME.has(query.measure);
  const bucket = result?.buckets.find((b) => b.key === selected) ?? null;

  return (
    <div className="tp-insights" data-testid="tp-insights">
      <div className="tp-insight-controls">
        <div className="ui-field">
          <label className="label" htmlFor="tp-measure">
            {t('insights.measure')}
          </label>
          <select id="tp-measure" className="select" value={query.measure} onChange={(e) => set('measure', e.target.value, 'count')} data-testid="tp-measure">
            {INSIGHT_MEASURES.map((m) => (
              <option key={m} value={m}>
                {t(`insights.measures.${m}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="ui-field">
          <label className="label" htmlFor="tp-slice">
            {t('insights.slice')}
          </label>
          <select id="tp-slice" className="select" value={query.slice} onChange={(e) => set('slice', e.target.value, 'status_type')} data-testid="tp-slice">
            {INSIGHT_SLICES.filter((s) => !(isTime && s === 'burnup')).map((s) => (
              <option key={s} value={s}>
                {t(`insights.slices.${s}`)}
              </option>
            ))}
          </select>
        </div>
        {query.slice === 'burnup' ? (
          <div className="ui-field">
            <label className="label" htmlFor="tp-interval">
              {t('insights.interval')}
            </label>
            <select id="tp-interval" className="select" value={query.interval} onChange={(e) => set('interval', e.target.value, 'week')}>
              <option value="week">{t('insights.weekly')}</option>
              <option value="month">{t('insights.monthly')}</option>
            </select>
          </div>
        ) : (
          <div className="ui-field">
            <label className="label" htmlFor="tp-segment">
              {t('insights.segment')}
            </label>
            <select
              id="tp-segment"
              className="select"
              value={isTime ? 'none' : query.segment}
              disabled={isTime}
              onChange={(e) => set('segment', e.target.value, 'none')}
              data-testid="tp-segment"
            >
              <option value="none">{t('common.none')}</option>
              {INSIGHT_DIMENSIONS.filter((d) => d !== query.slice).map((d) => (
                <option key={d} value={d}>
                  {t(`insights.slices.${d}`)}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="ui-field">
          <label className="label" htmlFor="tp-f-team">
            {t('insights.team')}
          </label>
          <select id="tp-f-team" className="select" value={query.filters.teamIds?.[0] ?? ''} onChange={(e) => set('team', e.target.value)}>
            <option value="">{t('common.all')}</option>
            {meta.teams.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </div>
        <div className="ui-field">
          <label className="label" htmlFor="tp-f-plan">
            {t('insights.plan')}
          </label>
          <select id="tp-f-plan" className="select" value={query.filters.planIds?.[0] ?? ''} onChange={(e) => set('plan', e.target.value)}>
            <option value="">{t('common.all')}</option>
            {meta.plans.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </div>
        <div className="ui-field">
          <label className="label" htmlFor="tp-f-label">
            {t('insights.label')}
          </label>
          <select id="tp-f-label" className="select" value={query.filters.labelIds?.[0] ?? ''} onChange={(e) => set('label', e.target.value)}>
            <option value="">{t('common.all')}</option>
            {meta.labels.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </div>
        <div className="ui-field">
          <label className="label" htmlFor="tp-f-from">
            {t('insights.createdFrom')}
          </label>
          <input id="tp-f-from" type="date" className="input" value={query.filters.createdAfter ?? ''} onChange={(e) => set('from', e.target.value)} />
        </div>
        <div className="ui-field">
          <label className="label" htmlFor="tp-f-to">
            {t('insights.createdTo')}
          </label>
          <input id="tp-f-to" type="date" className="input" value={query.filters.createdBefore ?? ''} onChange={(e) => set('to', e.target.value)} />
        </div>
        <label className="ui-check tp-check-inline">
          <input type="checkbox" checked={Boolean(query.filters.includeArchived)} onChange={(e) => set('archived', e.target.checked ? '1' : '')} />
          <span>{t('insights.includeArchived')}</span>
        </label>
      </div>

      <div className="tp-toolbar">
        {notice && (
          <span className="ui-help" role="status">
            {notice}
          </span>
        )}
        <span className="tp-toolbar-end" />
        <button
          type="button"
          className="btn btn-sm"
          onClick={async () => setNotice((await copyText(window.location.href)) ? t('common.linkCopied') : t('common.copyFailed'))}
        >
          {t('common.copyLink')}
        </button>
        <button type="button" className="btn btn-sm" disabled={!result} onClick={() => result && downloadFile('track-insights.csv', insightCsv(result))} data-testid="tp-export-csv">
          {t('insights.exportCsv')}
        </button>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => setAdding(true)} data-testid="tp-add-to-dashboard">
          {t('insights.addToDashboard')}
        </button>
      </div>

      {isTime && <p className="ui-help">{t('insights.timeNote')}</p>}

      {loading && !result ? (
        <LoadingRows />
      ) : failed ? (
        <EmptyState
          quiet
          title={t('common.loadError')}
          action={
            <button type="button" className="btn btn-primary" onClick={() => void run()}>
              {t('common.retry')}
            </button>
          }
        />
      ) : result && result.issueCount === 0 ? (
        <EmptyState quiet title={t('insights.emptyTitle')} body={t('insights.emptyBody')} />
      ) : result ? (
        <div className="tp-insight-out" aria-busy={loading}>
          <section className="tp-card">
            <InsightView result={result} kind="chart" selected={selected} onSelect={(k) => setSelected(k === selected ? null : k)} />
          </section>
          {bucket && (
            <section className="tp-card" aria-labelledby="tp-drill-h" data-testid="tp-drill">
              <div className="tp-card-head">
                <h3 id="tp-drill-h" className="tp-card-title">
                  {bucketLabel(result.slice, bucket.key, bucket.label)} · {t('insights.issueCount', { count: bucket.count })}
                </h3>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelected(null)}>
                  {t('common.close')}
                </button>
              </div>
              <ul className="tp-issue-rows" role="list">
                {bucket.issues.map((i) => (
                  <li key={i.id} className="tp-issue-row">
                    <Link href={`/app/track/issues/${i.id}`} className="tp-issue-link">
                      <span className="track-identifier">{i.identifier}</span>
                      <span className="tp-issue-title">{i.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {bucket.count > bucket.issues.length && <p className="ui-help">{t('insights.drillMore', { count: bucket.count - bucket.issues.length })}</p>}
            </section>
          )}
          <section className="tp-card">
            <InsightView result={result} kind="table" selected={selected} onSelect={(k) => setSelected(k === selected ? null : k)} />
          </section>
        </div>
      ) : null}

      <AddToDashboard open={adding} query={query} onClose={() => setAdding(false)} onAdded={(name) => setNotice(t('insights.added', { name }))} />
    </div>
  );
}

function AddToDashboard({ open, query, onClose, onAdded }: { open: boolean; query: InsightQuery; onClose: () => void; onAdded: (name: string) => void }) {
  const t = useTranslations('trackPlanning');
  const [rows, setRows] = useState<Array<{ id: string; name: string }> | null>(null);
  const [target, setTarget] = useState('new');
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<'chart' | 'table' | 'metric'>('chart');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setError(null);
    setTitle(`${t(`insights.measures.${query.measure}`)} · ${t(`insights.slices.${query.slice}`)}`);
    void api<{ rows: Array<{ id: string; name: string }> }>('/api/track/dashboards').then((r) => {
      const list = r.ok ? r.data.rows : [];
      setRows(list);
      setTarget(list[0]?.id ?? 'new');
    });
  }, [open, query.measure, query.slice, t]);
  const submit = async () => {
    let id = target;
    let dname = rows?.find((r) => r.id === target)?.name ?? '';
    if (target === 'new') {
      if (!name.trim()) return setError(t('dashboards.nameRequired'));
      const c = await api<{ id: string; name: string }>('/api/track/dashboards', 'POST', { name: name.trim() });
      if (!c.ok) return setError(t('common.saveError'));
      id = c.data.id;
      dname = c.data.name;
    }
    const res = await api(`/api/track/dashboards/${id}/widgets`, 'POST', { title, kind, width: kind === 'metric' ? 1 : 2, query });
    if (!res.ok) return setError(t('common.saveError'));
    onAdded(dname);
    onClose();
  };
  return (
    <Modal
      open={open}
      title={t('insights.addToDashboard')}
      onClose={onClose}
      testId="tp-add-dashboard-modal"
      footer={
        <>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => void submit()} data-testid="tp-add-dashboard-confirm">
            {t('common.add')}
          </button>
        </>
      }
    >
      <form
        className="ui-fields"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
        <div className="ui-field">
          <label className="label" htmlFor="tp-add-target">
            {t('dashboards.title')}
          </label>
          <select id="tp-add-target" className="select" value={target} onChange={(e) => setTarget(e.target.value)}>
            {rows?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
            <option value="new">{t('dashboards.new')}</option>
          </select>
        </div>
        {target === 'new' && (
          <div className="ui-field">
            <label className="label" htmlFor="tp-add-name">
              {t('dashboards.nameLabel')}
            </label>
            <input id="tp-add-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus data-testid="tp-add-dashboard-name" />
          </div>
        )}
        <div className="ui-field">
          <label className="label" htmlFor="tp-add-title">
            {t('dashboards.widgetTitle')}
          </label>
          <input id="tp-add-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </div>
        <div className="ui-field">
          <label className="label" htmlFor="tp-add-kind">
            {t('dashboards.widgetKind')}
          </label>
          <select id="tp-add-kind" className="select" value={kind} onChange={(e) => setKind(e.target.value as 'chart')}>
            {(['chart', 'table', 'metric'] as const).map((k) => (
              <option key={k} value={k}>
                {t(`dashboards.kinds.${k}`)}
              </option>
            ))}
          </select>
        </div>
      </form>
    </Modal>
  );
}
