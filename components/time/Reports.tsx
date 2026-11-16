'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { ProjectDto } from '@/lib/time/core';
import { addDays, formatMinutes, isIsoDate, monthRange, weekStart, type ReportGroup, type ReportRow, type ReportTotals } from '@/lib/time/types';
import { api, localToday, useMoney } from './ui';

type Preset = 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth' | 'custom';
const PRESETS: Preset[] = ['thisWeek', 'lastWeek', 'thisMonth', 'lastMonth', 'custom'];

function presetRange(preset: Exclude<Preset, 'custom'>, today: string): { from: string; to: string } {
  switch (preset) {
    case 'thisWeek': {
      const from = weekStart(today);
      return { from, to: addDays(from, 6) };
    }
    case 'lastWeek': {
      const from = addDays(weekStart(today), -7);
      return { from, to: addDays(from, 6) };
    }
    case 'thisMonth':
      return monthRange(today);
    case 'lastMonth':
      return monthRange(addDays(monthRange(today).from, -1));
  }
}

interface ReportData {
  rows: ReportRow[];
  totals: ReportTotals;
  currency: string;
  count: number;
}

/** Reportes: rango, agrupación, filtro por proyecto, totales y CSV. */
export default function Reports({ admin, projects, initialProjectId }: { admin: boolean; projects: ProjectDto[]; initialProjectId: string | null }) {
  const t = useTranslations('time');
  const locale = useLocale();
  const [today, setToday] = useState<string | null>(null);
  const [preset, setPreset] = useState<Preset>('thisMonth');
  const [custom, setCustom] = useState<{ from: string; to: string }>({
    from: '',
    to: '',
  });
  const [group, setGroup] = useState<ReportGroup>('project');
  const [projectId, setProjectId] = useState(initialProjectId && projects.some((p) => p.id === initialProjectId) ? initialProjectId : '');
  const [data, setData] = useState<ReportData | null>(null);
  const [failed, setFailed] = useState(false);
  const money = useMoney(data?.currency ?? 'USD');

  useEffect(() => {
    const d = localToday();
    setToday(d);
    setCustom(monthRange(d));
  }, []);

  const range = useMemo(() => {
    if (!today) return null;
    if (preset !== 'custom') return presetRange(preset, today);
    return isIsoDate(custom.from) && isIsoDate(custom.to) && custom.from <= custom.to ? custom : null;
  }, [preset, custom, today]);

  const query = range ? `from=${range.from}&to=${range.to}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ''}` : '';

  const load = useCallback(async () => {
    if (!query) return;
    setFailed(false);
    setData(null);
    const r = await api<ReportData>(`/api/time/report?${query}&group=${group}`);
    if (!r.ok) return setFailed(true);
    setData(r.data);
  }, [query, group]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups: ReportGroup[] = admin ? ['project', 'client', 'task', 'person'] : ['project', 'client', 'task'];
  const total = data?.totals.minutes ?? 0;

  return (
    <div className="app-page ui-page tm-page">
      <PageHeader
        title={t('nav.reports')}
        description={admin ? t('reports.desc') : `${t('reports.desc')} ${t('reports.onlyYours')}`}
        actions={
          query ? (
            <a className="btn btn-secondary" href={`/api/time/report?${query}&format=csv&locale=${locale}`} download data-testid="time-report-export">
              {t('reports.export')}
            </a>
          ) : undefined
        }
      />

      <div className="tm-filters">
        <label className="ui-field tm-filter">
          <span className="label">{t('reports.range')}</span>
          <select className="input" value={preset} onChange={(e) => setPreset(e.target.value as Preset)} data-testid="time-report-range">
            {PRESETS.map((p) => (
              <option key={p} value={p}>
                {t(`reports.${p}`)}
              </option>
            ))}
          </select>
        </label>
        {preset === 'custom' && (
          <>
            <label className="ui-field tm-filter">
              <span className="label">{t('reports.from')}</span>
              <input className="input" type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
            </label>
            <label className="ui-field tm-filter">
              <span className="label">{t('reports.to')}</span>
              <input className="input" type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
            </label>
          </>
        )}
        <label className="ui-field tm-filter">
          <span className="label">{t('sheet.project')}</span>
          <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)} data-testid="time-report-project">
            <option value="">{t('reports.allProjects')}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="tm-stats">
        <div className="tm-stat">
          <span className="tm-stat-label">{t('reports.hours')}</span>
          <strong className="tm-stat-value num" data-testid="time-report-hours">
            {data ? formatMinutes(data.totals.minutes) : '–'}
          </strong>
        </div>
        <div className="tm-stat">
          <span className="tm-stat-label">{t('reports.billableHours')}</span>
          <strong className="tm-stat-value num">{data ? formatMinutes(data.totals.billableMinutes) : '–'}</strong>
        </div>
        <div className="tm-stat">
          <span className="tm-stat-label">{t('reports.amount')}</span>
          <strong className="tm-stat-value num" data-testid="time-report-amount">
            {data ? money(data.totals.amountCents) : '–'}
          </strong>
        </div>
      </div>

      <div className="ui-tabs tm-tabs" role="tablist" aria-label={t('reports.groupBy')}>
        {groups.map((g) => (
          <button key={g} type="button" role="tab" className="ui-tab" aria-selected={group === g} onClick={() => setGroup(g)} data-testid={`time-report-group-${g}`}>
            {t(`reports.group.${g}`)}
          </button>
        ))}
      </div>

      {failed ? (
        <EmptyState
          compact
          title={t('reports.loadError')}
          action={
            <button type="button" className="btn btn-secondary" onClick={() => void load()}>
              {t('common.retry')}
            </button>
          }
        />
      ) : !data ? (
        <div className="ui-loading-stack" aria-busy="true">
          <span className="sr-only" role="status">
            {t('common.loading')}
          </span>
          {[0, 1, 2].map((i) => (
            <span key={i} className="ui-skeleton ui-skeleton-row" />
          ))}
        </div>
      ) : data.rows.length === 0 ? (
        <EmptyState compact title={t('reports.emptyTitle')} body={t('reports.emptyBody')} />
      ) : (
        <div className="table-wrap">
          <table className="table tm-table" data-testid="time-report-table">
            <thead>
              <tr>
                <th scope="col">{t(`reports.group.${group}`)}</th>
                <th scope="col" className="tm-num">
                  {t('reports.hours')}
                </th>
                <th scope="col" className="tm-num tm-hide-sm">
                  {t('reports.billableHours')}
                </th>
                <th scope="col" className="tm-num">
                  {t('reports.amount')}
                </th>
                <th scope="col" className="tm-num tm-hide-sm">
                  {t('reports.share')}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.key} data-testid="time-report-row">
                  <th scope="row">{r.label || <span className="tm-muted">{t('reports.noClient')}</span>}</th>
                  <td className="tm-num num">{formatMinutes(r.minutes)}</td>
                  <td className="tm-num num tm-hide-sm">{formatMinutes(r.billableMinutes)}</td>
                  <td className="tm-num num">{money(r.amountCents)}</td>
                  <td className="tm-num num tm-muted tm-hide-sm">{total ? `${Math.round((r.minutes / total) * 100)}%` : ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">{t('reports.total')}</th>
                <td className="tm-num num">{formatMinutes(data.totals.minutes)}</td>
                <td className="tm-num num tm-hide-sm">{formatMinutes(data.totals.billableMinutes)}</td>
                <td className="tm-num num">{money(data.totals.amountCents)}</td>
                <td className="tm-hide-sm" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
