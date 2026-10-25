'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import EmptyState from '@/components/ui/EmptyState';
import type { CycleListItem, CycleMetricsResult } from '@/lib/track-cycle-metrics';
import { api, fmtDay, LoadingRows, ProgressBar } from './shared';
import { LineChart } from './charts';
import { encodeFilter } from '@/lib/track-filter';
import { TEAMS_PATH, teamPath } from '@/lib/track-routes';

const localToday = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** Cycles de todos los equipos: en curso, próximos y pasados, con avance. */
export function CyclesIndex() {
  const t = useTranslations('trackPlanning');
  const locale = useLocale();
  // ?team=<id>: los cycles de un team (sidebar › team › Cycles).
  const team = useSearchParams().get('team');
  const [allRows, setRows] = useState<CycleListItem[] | null>(null);
  const rows = allRows && team ? allRows.filter((r) => r.project_id === team) : allRows;
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    const res = await api<{ rows: CycleListItem[] }>(`/api/track/cycles?today=${localToday()}`);
    setFailed(!res.ok);
    setRows(res.ok ? res.data.rows : []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (rows === null) return <LoadingRows />;
  if (failed)
    return (
      <EmptyState
        quiet
        title={t('common.loadError')}
        action={
          <button type="button" className="btn btn-primary" onClick={() => void load()}>
            {t('common.retry')}
          </button>
        }
      />
    );
  if (!rows.length) return <EmptyState title={t('cycles.emptyTitle')} body={t('cycles.emptyBody')} action={{ label: t('cycles.goTeams'), href: TEAMS_PATH }} />;
  const sections = (['active', 'upcoming', 'past'] as const).map((s) => ({
    key: s,
    rows: rows.filter((r) => r.state === s).sort((a, b) => (s === 'upcoming' ? a.start_at.localeCompare(b.start_at) : b.start_at.localeCompare(a.start_at))),
  }));
  return (
    <div className="tp-list" data-testid="tp-cycles">
      {sections
        .filter((s) => s.rows.length)
        .map((s) => (
          <section key={s.key} className="tp-group" aria-label={t(`cycles.${s.key}`)}>
            <h2 className="tp-group-head">
              <span>{t(`cycles.${s.key}`)}</span>
              <span className="tp-group-count">{s.rows.length}</span>
            </h2>
            <ul className="tp-rows" role="list">
              {s.rows.map((c) => (
                <li key={c.id} className="tp-row">
                  <Link href={`/app/track/cycles/${c.id}`} className="tp-row-link">
                    <span className="tp-row-icon" aria-hidden="true">
                      {c.project_icon ?? ''}
                    </span>
                    <span className="tp-row-name">{c.name}</span>
                    <span className="tp-row-summary">{c.project_name}</span>
                  </Link>
                  <span className="tp-row-cell tp-row-date tp-row-wide">
                    {fmtDay(c.start_at, locale)} – {fmtDay(c.end_at, locale)}
                  </span>
                  <span className="tp-row-cell tp-row-lead">{t('cycles.doneOf', { done: c.done, total: c.total })}</span>
                  <span className="tp-row-cell tp-row-progress">
                    <ProgressBar percent={c.total ? (c.done / c.total) * 100 : 0} />
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}

type MetricsResponse = CycleMetricsResult & { project: { id: string; name: string; icon: string | null } };

/** Detalle de un cycle (como Linear): burn-up, alcance, scope creep, rollover, velocidad y capacidad. */
export function CycleDetail({ cycleId }: { cycleId: string }) {
  const t = useTranslations('trackPlanning');
  const locale = useLocale();
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'missing' | 'error'>('loading');
  const load = useCallback(async () => {
    const res = await api<MetricsResponse>(`/api/track/cycles/${cycleId}/metrics?today=${localToday()}`);
    if (res.status === 404) return setState('missing');
    if (!res.ok) return setState('error');
    setData(res.data);
    setState('ok');
  }, [cycleId]);
  useEffect(() => {
    void load();
  }, [load]);

  if (state === 'loading') return <LoadingRows rows={5} />;
  if (state === 'missing') return <EmptyState title={t('cycles.notFound')} action={{ label: t('cycles.back'), href: '/app/track/cycles' }} />;
  if (state === 'error' || !data)
    return (
      <EmptyState
        title={t('common.loadError')}
        action={
          <button type="button" className="btn btn-primary" onClick={() => void load()}>
            {t('common.retry')}
          </button>
        }
      />
    );
  const unit = data.byPoints ? t('cycles.points') : t('cycles.issues');
  const cap = data.capacityPercent;
  const days = data.points.map((p) => fmtDay(p.day, locale));
  const ideal = data.points.map((_, i) => (data.points.length <= 1 ? data.scope : Math.round(((data.initialScope || data.scope) * i) / (data.points.length - 1))));
  return (
    <div className="tp-cycle" data-testid="tp-cycle-detail">
      <nav className="tp-crumbs" aria-label={t('cycles.title')}>
        <Link href="/app/track/cycles">{t('cycles.title')}</Link>
        <span aria-hidden="true">›</span>
        <Link href={teamPath(data.project)}>{data.project.name}</Link>
        <span aria-hidden="true">›</span>
        <span>{data.cycle.name}</span>
      </nav>
      <div className="tp-cycle-head">
        <h2 className="tp-cycle-title">{data.cycle.name}</h2>
        <span className="badge badge-outline">{t(`cycles.${data.state}`)}</span>
        <span className="ui-help">
          {fmtDay(data.cycle.start_at, locale, true)} – {fmtDay(data.cycle.end_at, locale, true)}
        </span>
      </div>

      <div className="tp-stats" role="list">
        <Stat label={t('cycles.scope')} value={`${data.scope}`} hint={unit} />
        <Stat label={t('cycles.started')} value={`${data.started}`} hint={unit} />
        <Stat label={t('cycles.completed')} value={`${data.completed}`} hint={`${data.completionPercent}%`} testId="tp-stat-completed" />
        <Stat label={t('cycles.scopeCreep')} value={`+${data.added}`} hint={t('cycles.scopeCreepHint', { percent: data.scopeCreepPercent, removed: data.removed })} testId="tp-stat-creep" />
        <Stat label={t('cycles.carried')} value={`${data.carriedOver}`} hint={t('cycles.carriedHint')} />
        <Stat
          label={t('cycles.velocity')}
          value={data.velocity === null ? '—' : String(data.velocity)}
          hint={data.velocity === null ? t('cycles.noVelocity') : t('cycles.velocityHint', { count: data.history.length })}
        />
        <Stat
          label={t('cycles.capacity')}
          value={cap === null ? '—' : `${cap}%`}
          hint={cap === null ? t('cycles.noVelocity') : cap > 100 ? t('cycles.overCapacity') : t('cycles.underCapacity')}
          tone={cap !== null && cap > 100 ? 'bad' : undefined}
          testId="tp-stat-capacity"
        />
      </div>

      <section className="tp-card" aria-labelledby="tp-burnup-h">
        <h3 id="tp-burnup-h" className="tp-card-title">
          {t('cycles.burnup')}
        </h3>
        {data.points.length === 0 ? (
          <p className="ui-help">{t('cycles.notStarted')}</p>
        ) : (
          <LineChart
            label={t('cycles.burnup')}
            labels={days}
            series={[
              { key: 'scope', label: t('cycles.legendScope'), color: 'var(--ink)', values: data.points.map((p) => p.scope) },
              { key: 'started', label: t('cycles.legendStarted'), color: 'var(--c-notes)', values: data.points.map((p) => p.started + p.completed), area: true },
              { key: 'completed', label: t('cycles.legendCompleted'), color: 'var(--accent)', values: data.points.map((p) => p.completed), area: true },
              { key: 'ideal', label: t('cycles.legendIdeal'), color: 'var(--brand-gray-3)', values: ideal, dashed: true },
            ]}
          />
        )}
      </section>

      {data.history.length > 0 && (
        <section className="tp-card" aria-labelledby="tp-hist-h">
          <h3 id="tp-hist-h" className="tp-card-title">
            {t('cycles.history')}
          </h3>
          <div className="table-wrap">
            <table className="table table-compact">
              <thead>
                <tr>
                  <th scope="col">{t('cycles.title')}</th>
                  <th scope="col" className="num">
                    {t('cycles.scope')}
                  </th>
                  <th scope="col" className="num">
                    {t('cycles.completed')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.history.map((h) => (
                  <tr key={h.id}>
                    <td>
                      <Link href={`/app/track/cycles/${h.id}`} className="cell-link">
                        {h.name}
                      </Link>
                    </td>
                    <td className="num">{h.scope}</td>
                    <td className="num">{h.completed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <p className="ui-help">{t('cycles.rolloverHelp')}</p>
      <Link
        href={`${teamPath(data.project)}?filter=${encodeURIComponent(encodeFilter({ match: 'and', rules: [{ field: 'cycle', op: 'is', values: [data.cycle.id] }] }))}`}
        className="btn btn-sm"
      >
        {t('cycles.viewIssues')}
      </Link>
    </div>
  );
}

function Stat({ label, value, hint, tone, testId }: { label: string; value: string; hint?: string; tone?: 'bad'; testId?: string }) {
  return (
    <div className={`tp-stat${tone ? ` tp-stat-${tone}` : ''}`} role="listitem" data-testid={testId}>
      <span className="tp-stat-label">{label}</span>
      <span className="tp-stat-value">{value}</span>
      {hint && <span className="tp-stat-hint">{hint}</span>}
    </div>
  );
}
