'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import type {
  FunnelQuery,
  InsightDto,
  InsightKind,
  InsightQuery,
  InsightResult,
  PathsQuery,
  RetentionQuery,
  SqlQuery,
  TrendsQuery,
} from '@/lib/analytics/types';
import { ApiError, api, notifyChanged, runQuery } from './client';
import { EventInput, FilterList, cleanFilters, useProjectMeta, type ProjectMeta } from './Filters';
import InsightResultView from './InsightResultView';
import NameDialog from './NameDialog';
import RangeSelect from './RangeSelect';

const DEFAULTS: { trends: TrendsQuery; funnel: FunnelQuery; retention: RetentionQuery; paths: PathsQuery; sql: SqlQuery } = {
  trends: {
    kind: 'trends',
    series: [{ event: '$pageview', math: 'total', filters: [] }],
    interval: 'day',
    dateRange: { from: '-7d' },
    breakdown: null,
    compare: false,
    filters: [],
    cohortId: null,
    display: 'line',
  },
  funnel: {
    kind: 'funnel',
    steps: [
      { event: '$pageview', filters: [] },
      { event: '$autocapture', filters: [] },
    ],
    windowDays: 14,
    dateRange: { from: '-30d' },
    filters: [],
    cohortId: null,
  },
  retention: { kind: 'retention', startEvent: '$pageview', returnEvent: '$pageview', period: 'week', periods: 8, filters: [], cohortId: null },
  paths: { kind: 'paths', dateRange: { from: '-7d' }, startPath: null, steps: 4 },
  sql: { kind: 'sql', sql: "SELECT event, count() AS n FROM events WHERE timestamp > (strftime('%s','now') - 7*86400) * 1000 GROUP BY event ORDER BY n DESC" },
};

/** Lo que se manda: filtros sin clave vacía. */
function clean(q: InsightQuery): InsightQuery {
  switch (q.kind) {
    case 'trends':
      return {
        ...q,
        filters: cleanFilters(q.filters),
        series: q.series.map((s) => ({ ...s, event: s.event.trim() || '*', filters: cleanFilters(s.filters) })),
        breakdown: q.breakdown && q.breakdown.key.trim() ? { ...q.breakdown, key: q.breakdown.key.trim() } : null,
      };
    case 'funnel':
      return { ...q, filters: cleanFilters(q.filters), steps: q.steps.map((s) => ({ ...s, event: s.event.trim() || '*', filters: cleanFilters(s.filters) })) };
    case 'retention':
      return { ...q, filters: cleanFilters(q.filters), startEvent: q.startEvent.trim() || '$pageview', returnEvent: q.returnEvent.trim() || '$pageview' };
    default:
      return q;
  }
}

function CohortSelect({ value, onChange, cohorts }: { value: string | null | undefined; onChange: (v: string | null) => void; cohorts: Array<{ id: string; name: string }> }) {
  const t = useTranslations('analytics.editor');
  if (!cohorts.length) return null;
  return (
    <label className="ui-field an-inline-field">
      <span className="label">{t('cohort')}</span>
      <select className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{t('everyone')}</option>
        {cohorts.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function TrendsForm({ q, set, meta, cohorts }: { q: TrendsQuery; set: (q: TrendsQuery) => void; meta: ProjectMeta; cohorts: Array<{ id: string; name: string }> }) {
  const t = useTranslations('analytics.editor');
  const letters = 'ABCDE';
  return (
    <div className="an-form">
      {q.series.map((s, i) => (
        <fieldset key={i} className="an-series">
          <legend className="an-series-legend">
            <span className={`an-s${i % 6}`}>
              <i className="an-swatch" aria-hidden="true" />
            </span>{' '}
            {t('seriesN', { n: letters[i] })}
          </legend>
          <div className="an-row">
            <EventInput value={s.event} onChange={(event) => set({ ...q, series: q.series.map((x, j) => (j === i ? { ...x, event } : x)) })} meta={meta} label={t('event')} />
            <select
              className="select"
              aria-label={t('math')}
              value={s.math}
              onChange={(e) => set({ ...q, series: q.series.map((x, j) => (j === i ? { ...x, math: e.target.value as 'total' | 'unique' } : x)) })}
            >
              <option value="total">{t('mathTotal')}</option>
              <option value="unique">{t('mathUnique')}</option>
            </select>
            {q.series.length > 1 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => set({ ...q, series: q.series.filter((_, j) => j !== i) })}>
                {t('removeSeries')}
              </button>
            )}
          </div>
          <FilterList filters={s.filters} onChange={(filters) => set({ ...q, series: q.series.map((x, j) => (j === i ? { ...x, filters } : x)) })} meta={meta} />
        </fieldset>
      ))}
      {q.series.length < 5 && (
        <button type="button" className="btn btn-sm" onClick={() => set({ ...q, series: [...q.series, { event: '$pageview', math: 'total', filters: [] }] })}>
          + {t('addSeries')}
        </button>
      )}
      <div className="an-row an-wrap">
        <RangeSelect value={q.dateRange.from} onChange={(from) => set({ ...q, dateRange: { from } })} />
        <select className="select" aria-label={t('interval')} value={q.interval} onChange={(e) => set({ ...q, interval: e.target.value as TrendsQuery['interval'] })}>
          {(['hour', 'day', 'week', 'month'] as const).map((iv) => (
            <option key={iv} value={iv}>
              {t(`intervals.${iv}`)}
            </option>
          ))}
        </select>
        <select className="select" aria-label={t('display')} value={q.display} onChange={(e) => set({ ...q, display: e.target.value as TrendsQuery['display'] })}>
          {(['line', 'bar', 'number', 'table'] as const).map((d) => (
            <option key={d} value={d}>
              {t(`displays.${d}`)}
            </option>
          ))}
        </select>
        <label className="ui-check">
          <input type="checkbox" checked={q.compare} onChange={(e) => set({ ...q, compare: e.target.checked })} /> {t('compare')}
        </label>
      </div>
      <div className="an-row an-wrap">
        <span className="label">{t('breakdown')}</span>
        <select
          className="select"
          aria-label={t('breakdownType')}
          value={q.breakdown?.type ?? 'event'}
          onChange={(e) => set({ ...q, breakdown: { key: q.breakdown?.key ?? '', type: e.target.value as 'event' | 'person' } })}
        >
          <option value="event">{t('eventProperty')}</option>
          <option value="person">{t('personProperty')}</option>
        </select>
        <input
          className="input an-filter-key"
          aria-label={t('breakdownKey')}
          placeholder={t('breakdownPlaceholder')}
          value={q.breakdown?.key ?? ''}
          list="an-breakdown-keys"
          onChange={(e) => set({ ...q, breakdown: e.target.value ? { key: e.target.value, type: q.breakdown?.type ?? 'event' } : null })}
        />
        <datalist id="an-breakdown-keys">
          {['$pathname', '$browser', '$os', '$device_type', '$geoip_country_code', '$referring_domain', 'utm_source', ...(q.breakdown?.type === 'person' ? meta.personProperties : meta.eventProperties)].map((k) => (
            <option key={k} value={k} />
          ))}
        </datalist>
      </div>
      <details className="an-more">
        <summary>{t('globalFilters')}</summary>
        <FilterList filters={q.filters} onChange={(filters) => set({ ...q, filters })} meta={meta} />
        <CohortSelect value={q.cohortId} onChange={(cohortId) => set({ ...q, cohortId })} cohorts={cohorts} />
      </details>
    </div>
  );
}

function FunnelForm({ q, set, meta, cohorts }: { q: FunnelQuery; set: (q: FunnelQuery) => void; meta: ProjectMeta; cohorts: Array<{ id: string; name: string }> }) {
  const t = useTranslations('analytics.editor');
  return (
    <div className="an-form">
      <ol className="an-steps" role="list">
        {q.steps.map((s, i) => (
          <li key={i} className="an-series">
            <div className="an-row">
              <span className="an-step-n">{i + 1}</span>
              <EventInput value={s.event} onChange={(event) => set({ ...q, steps: q.steps.map((x, j) => (j === i ? { ...x, event } : x)) })} meta={meta} label={t('stepN', { n: i + 1 })} />
              {q.steps.length > 2 && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => set({ ...q, steps: q.steps.filter((_, j) => j !== i) })}>
                  {t('removeStep')}
                </button>
              )}
            </div>
            <FilterList filters={s.filters} onChange={(filters) => set({ ...q, steps: q.steps.map((x, j) => (j === i ? { ...x, filters } : x)) })} meta={meta} />
          </li>
        ))}
      </ol>
      {q.steps.length < 10 && (
        <button type="button" className="btn btn-sm" onClick={() => set({ ...q, steps: [...q.steps, { event: '$pageview', filters: [] }] })}>
          + {t('addStep')}
        </button>
      )}
      <div className="an-row an-wrap">
        <RangeSelect value={q.dateRange.from} onChange={(from) => set({ ...q, dateRange: { from } })} />
        <label className="ui-field an-inline-field">
          <span className="label">{t('window')}</span>
          <input
            className="input an-num-input"
            type="number"
            min={1}
            max={90}
            value={q.windowDays}
            onChange={(e) => set({ ...q, windowDays: Math.min(90, Math.max(1, Number(e.target.value) || 1)) })}
          />
        </label>
      </div>
      <details className="an-more">
        <summary>{t('globalFilters')}</summary>
        <FilterList filters={q.filters} onChange={(filters) => set({ ...q, filters })} meta={meta} />
        <CohortSelect value={q.cohortId} onChange={(cohortId) => set({ ...q, cohortId })} cohorts={cohorts} />
      </details>
    </div>
  );
}

function RetentionForm({ q, set, meta, cohorts }: { q: RetentionQuery; set: (q: RetentionQuery) => void; meta: ProjectMeta; cohorts: Array<{ id: string; name: string }> }) {
  const t = useTranslations('analytics.editor');
  return (
    <div className="an-form">
      <div className="an-row an-wrap">
        <label className="ui-field an-inline-field">
          <span className="label">{t('startEvent')}</span>
          <EventInput value={q.startEvent} onChange={(startEvent) => set({ ...q, startEvent })} meta={meta} label={t('startEvent')} />
        </label>
        <label className="ui-field an-inline-field">
          <span className="label">{t('returnEvent')}</span>
          <EventInput value={q.returnEvent} onChange={(returnEvent) => set({ ...q, returnEvent })} meta={meta} label={t('returnEvent')} />
        </label>
      </div>
      <div className="an-row an-wrap">
        <select className="select" aria-label={t('period')} value={q.period} onChange={(e) => set({ ...q, period: e.target.value as 'day' | 'week' })}>
          <option value="day">{t('intervals.day')}</option>
          <option value="week">{t('intervals.week')}</option>
        </select>
        <label className="ui-field an-inline-field">
          <span className="label">{t('periods')}</span>
          <input className="input an-num-input" type="number" min={2} max={16} value={q.periods} onChange={(e) => set({ ...q, periods: Math.min(16, Math.max(2, Number(e.target.value) || 2)) })} />
        </label>
      </div>
      <details className="an-more">
        <summary>{t('globalFilters')}</summary>
        <FilterList filters={q.filters} onChange={(filters) => set({ ...q, filters })} meta={meta} />
        <CohortSelect value={q.cohortId} onChange={(cohortId) => set({ ...q, cohortId })} cohorts={cohorts} />
      </details>
    </div>
  );
}

function PathsForm({ q, set }: { q: PathsQuery; set: (q: PathsQuery) => void }) {
  const t = useTranslations('analytics.editor');
  return (
    <div className="an-form">
      <div className="an-row an-wrap">
        <RangeSelect value={q.dateRange.from} onChange={(from) => set({ ...q, dateRange: { from } })} />
        <label className="ui-field an-inline-field">
          <span className="label">{t('startPath')}</span>
          <input className="input" placeholder="/pricing" value={q.startPath ?? ''} onChange={(e) => set({ ...q, startPath: e.target.value || null })} maxLength={500} />
        </label>
        <label className="ui-field an-inline-field">
          <span className="label">{t('pathSteps')}</span>
          <input className="input an-num-input" type="number" min={2} max={6} value={q.steps} onChange={(e) => set({ ...q, steps: Math.min(6, Math.max(2, Number(e.target.value) || 2)) })} />
        </label>
      </div>
      <p className="an-note">{t('pathsNote')}</p>
    </div>
  );
}

export function SqlForm({ q, set, onRun }: { q: SqlQuery; set: (q: SqlQuery) => void; onRun?: () => void }) {
  const t = useTranslations('analytics.sql');
  return (
    <div className="an-form">
      <label className="ui-field">
        <span className="label">{t('query')}</span>
        <textarea
          className="textarea an-sql"
          rows={8}
          spellCheck={false}
          value={q.sql}
          onChange={(e) => set({ ...q, sql: e.target.value })}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              onRun?.();
            }
          }}
        />
      </label>
      <p className="an-note">{t('help')}</p>
    </div>
  );
}

const KINDS: InsightKind[] = ['trends', 'funnel', 'retention', 'paths', 'sql'];

/**
 * Editor de un insight (como "New insight" de PostHog): tipo, definición,
 * resultado al instante y guardar con nombre, sumar a un tablero.
 */
export default function InsightEditor({
  projectId,
  insight,
  initialKind,
  dashboards,
  cohorts,
}: {
  projectId: string;
  insight: InsightDto | null;
  initialKind?: InsightKind;
  dashboards: Array<{ id: string; name: string; insightIds: string[] }>;
  cohorts: Array<{ id: string; name: string }>;
}) {
  const t = useTranslations('analytics.editor');
  const tc = useTranslations('analytics.common');
  const router = useRouter();
  const meta = useProjectMeta(projectId);
  const [drafts, setDrafts] = useState(() => (insight ? { ...DEFAULTS, [insight.kind]: insight.query } : DEFAULTS));
  const [kind, setKind] = useState<InsightKind>(insight?.kind ?? initialKind ?? 'trends');
  const [result, setResult] = useState<InsightResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [askName, setAskName] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [name, setName] = useState(insight?.name ?? '');
  const query = drafts[kind] as InsightQuery;
  const cleaned = useMemo(() => clean(query), [query]);
  const key = JSON.stringify(cleaned);
  const ctl = useRef<AbortController | null>(null);

  const run = async () => {
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setRunning(true);
    setError(null);
    try {
      setResult(await runQuery(projectId, cleaned, c.signal));
    } catch (err) {
      if (c.signal.aborted) return;
      setResult(null);
      if (err instanceof ApiError) {
        const base = t.has(`errors.${err.code}`) ? t(`errors.${err.code}`) : t('errors.request_failed');
        setError(err.detail ? `${base} (${err.detail})` : base);
      } else setError(t('errors.request_failed'));
    } finally {
      if (!c.signal.aborted) setRunning(false);
    }
  };

  // Se corre solo al cambiar la definición (menos SQL, que corre con el botón o ⌘↵).
  useEffect(() => {
    if (kind === 'sql') return;
    const id = setTimeout(() => void run(), 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, kind]);

  const set = (q: InsightQuery) => setDrafts((d) => ({ ...d, [q.kind]: q }));

  const save = async (newName?: string) => {
    setSaving(true);
    setError(null);
    try {
      if (insight) {
        await api(`/api/analytics/insights/${insight.id}`, { method: 'PATCH', body: { name: newName ?? (name || insight.name), query: cleaned } });
        setSaved(t('saved'));
        notifyChanged();
        router.refresh();
      } else {
        const { insight: created } = await api<{ insight: InsightDto }>('/api/analytics/insights', {
          body: { projectId, name: newName ?? t('untitled'), query: cleaned },
        });
        notifyChanged();
        router.replace(`/app/analytics/insights/${created.id}`);
      }
      setAskName(false);
    } catch (err) {
      setError(err instanceof ApiError ? tc('errorCode', { code: err.code }) : tc('error'));
    } finally {
      setSaving(false);
    }
  };

  const addToDashboard = async (dashboardId: string) => {
    if (!insight) return;
    const d = dashboards.find((x) => x.id === dashboardId);
    if (!d) return;
    try {
      await api(`/api/analytics/dashboards/${d.id}`, { method: 'PATCH', body: { insightIds: [...d.insightIds.filter((x) => x !== insight.id), insight.id] } });
      setSaved(t('addedTo', { name: d.name }));
      notifyChanged();
      router.refresh();
    } catch {
      setError(tc('error'));
    }
  };

  return (
    <div className="app-page ui-page an-page an-editor">
      <PageHeader
        back={{ href: '/app/analytics/insights', label: t('back') }}
        title={
          insight ? (
            <input
              className="an-title-input"
              aria-label={t('name')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => name.trim() && name !== insight.name && void save(name.trim())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              maxLength={200}
            />
          ) : (
            t('newTitle')
          )
        }
        actions={
          <>
            {insight && dashboards.length > 0 && (
              <select
                className="select"
                aria-label={t('addToDashboard')}
                value=""
                onChange={(e) => {
                  if (e.target.value) void addToDashboard(e.target.value);
                }}
              >
                <option value="">{t('addToDashboard')}</option>
                {dashboards.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            )}
            <button type="button" className="btn btn-primary" disabled={saving} onClick={() => (insight ? void save() : setAskName(true))}>
              {insight ? t('save') : t('saveAs')}
            </button>
          </>
        }
      />
      <div className="ui-tabs" role="tablist" aria-label={t('kind')}>
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            className="ui-tab"
            disabled={Boolean(insight) && insight!.kind !== k}
            onClick={() => {
              setKind(k);
              setResult(null);
            }}
          >
            {t(`kinds.${k}`)}
          </button>
        ))}
      </div>
      <div className="an-editor-grid">
        <section className="an-editor-def" aria-label={t('definition')}>
          {query.kind === 'trends' && <TrendsForm q={query} set={set} meta={meta} cohorts={cohorts} />}
          {query.kind === 'funnel' && <FunnelForm q={query} set={set} meta={meta} cohorts={cohorts} />}
          {query.kind === 'retention' && <RetentionForm q={query} set={set} meta={meta} cohorts={cohorts} />}
          {query.kind === 'paths' && <PathsForm q={query} set={set} />}
          {query.kind === 'sql' && <SqlForm q={query} set={set} onRun={() => void run()} />}
          {query.kind === 'sql' && (
            <button type="button" className="btn btn-sm" onClick={() => void run()} disabled={running}>
              {t('run')}
            </button>
          )}
        </section>
        <section className="an-editor-result an-panel" aria-label={t('result')} aria-busy={running} data-testid="an-result">
          {saved && (
            <p className="an-saved" role="status">
              {saved}
            </p>
          )}
          {error && (
            <p className="ui-error" role="alert">
              {error}
            </p>
          )}
          {running && !result && <span className="ui-skeleton ui-skeleton-block" />}
          {result && (
            <InsightResultView
              result={result}
              display={query.kind === 'trends' ? query.display : 'line'}
              peopleHref={(ids) => `/app/analytics/persons?ids=${encodeURIComponent(ids.join(','))}`}
            />
          )}
          {!running && !result && !error && kind === 'sql' && <p className="an-muted">{t('runHint')}</p>}
          {insight && (
            <p className="an-muted an-small">
              <Link href="/app/analytics/dashboards" className="an-link">
                {t('dashboardsLink')}
              </Link>
            </p>
          )}
        </section>
      </div>
      <NameDialog
        open={askName}
        title={t('saveAs')}
        label={t('name')}
        initial=""
        submitLabel={t('save')}
        busy={saving}
        error={error}
        onClose={() => setAskName(false)}
        onSubmit={(n) => void save(n)}
      />
    </div>
  );
}
