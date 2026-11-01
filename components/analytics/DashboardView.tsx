'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { DashboardDto, DateRange, InsightDto, InsightQuery, InsightResult } from '@/lib/analytics/types';
import { ShareDialog } from './InsightPanels';
import { DateRangePicker } from './RangeSelect';
import { ApiError, apiErrorText, api, notifyChanged, runQuery } from './client';
import InsightResultView from './InsightResultView';
import NameDialog from './NameDialog';

/** El rango del tablero pisa el de cada insight que tiene rango (retención y SQL van con el suyo). */
function withRange(q: InsightQuery, range: DateRange | null): InsightQuery {
  if (!range || q.kind === 'retention' || q.kind === 'sql') return q;
  return { ...q, dateRange: range };
}

function Tile({
  projectId,
  insight,
  onRemove,
  onMove,
  range,
  refreshKey,
  annotations,
}: {
  projectId: string;
  insight: InsightDto;
  onRemove: () => void;
  onMove: (delta: -1 | 1) => void;
  range: DateRange | null;
  refreshKey: number;
  annotations: Array<{ date: string; content: string }>;
}) {
  const t = useTranslations('analytics.dashboards');
  const te = useTranslations('analytics.editor');
  const [result, setResult] = useState<InsightResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rangeKey = JSON.stringify(range);
  useEffect(() => {
    const c = new AbortController();
    setError(null);
    runQuery(projectId, withRange(insight.query, range), c.signal)
      .then(setResult)
      .catch((err) => {
        if (!c.signal.aborted) setError(err instanceof ApiError && te.has(`errors.${err.code}`) ? te(`errors.${err.code}`) : te('errors.request_failed'));
      });
    return () => c.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, insight, te, rangeKey, refreshKey]);
  return (
    <article className="an-tile an-panel" aria-label={insight.name}>
      <header className="an-tile-head">
        <Link href={`/app/analytics/insights/${insight.id}`} className="an-tile-title">
          {insight.name}
        </Link>
        <span className="an-muted an-small an-hide-sm">{te(`kinds.${insight.kind}`)}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onMove(-1)} aria-label={t('moveUp', { name: insight.name })} title={t('moveUp', { name: insight.name })}>
          ↑
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onMove(1)} aria-label={t('moveDown', { name: insight.name })} title={t('moveDown', { name: insight.name })}>
          ↓
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove} aria-label={t('removeTile', { name: insight.name })}>
          {t('remove')}
        </button>
      </header>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {!result && !error && <span className="ui-skeleton ui-skeleton-block" />}
      {result && <InsightResultView result={result} display={insight.query.kind === 'trends' ? insight.query.display : 'line'} annotations={annotations} />}
    </article>
  );
}

/** Un tablero: sus insights en grilla, renombrar, sumar o sacar insights y borrar. */
export default function DashboardView({
  projectId,
  dashboard,
  insights,
  allInsights,
  canShare = false,
  annotations = [],
}: {
  projectId: string;
  dashboard: DashboardDto;
  insights: InsightDto[];
  allInsights: Array<{ id: string; name: string }>;
  canShare?: boolean;
  annotations?: Array<{ date: string; content: string }>;
}) {
  const t = useTranslations('analytics.dashboards');
  const tc = useTranslations('analytics.common');
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/analytics/dashboards/${dashboard.id}`, { method: 'PATCH', body });
      notifyChanged();
      router.refresh();
      return true;
    } catch (err) {
      setError(apiErrorText(err, tc));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const available = allInsights.filter((i) => !dashboard.insightIds.includes(i.id));
  const [range, setRange] = useState<DateRange | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sharing, setSharing] = useState(false);
  const noInsightOption = !allInsights.length ? t('noInsightsYet') : t('allAdded');

  const move = (id: string, delta: -1 | 1) => {
    const ids = [...dashboard.insightIds];
    const i = ids.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void patch({ insightIds: ids });
  };

  const duplicate = async () => {
    setBusy(true);
    setError(null);
    try {
      const { dashboard: created } = await api<{ dashboard: { id: string } }>('/api/analytics/dashboards', { body: { projectId, name: t('copyName', { name: dashboard.name.slice(0, 180) }), description: dashboard.description } });
      await api(`/api/analytics/dashboards/${created.id}`, { method: 'PATCH', body: { insightIds: dashboard.insightIds } });
      notifyChanged();
      router.push(`/app/analytics/dashboards/${created.id}`);
    } catch (err) {
      setError(apiErrorText(err, tc));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-page ui-page an-page">
      <PageHeader
        back={{ href: '/app/analytics/dashboards', label: t('title') }}
        title={dashboard.name}
        description={dashboard.description || undefined}
        actions={
          <>
            <select
              className="select"
              aria-label={t('addInsight')}
              value=""
              disabled={!available.length}
              onChange={(e) => e.target.value && void patch({ insightIds: [...dashboard.insightIds, e.target.value] })}
            >
              <option value="">{available.length ? t('addInsight') : noInsightOption}</option>
              {available.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
            <button type="button" className="btn" disabled={!canShare} title={canShare ? undefined : t('shareAdminsOnly')} onClick={() => setSharing(true)}>
              {t('share')}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => void duplicate()}>
              {t('duplicate')}
            </button>
            <button type="button" className="btn" onClick={() => setRenaming(true)}>
              {tc('rename')}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setDeleting(true)}>
              {tc('delete')}
            </button>
          </>
        }
      />
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {insights.length > 0 && (
        <div className="an-toolbar">
          <label className="ui-check">
            <input type="checkbox" checked={range !== null} onChange={(e) => setRange(e.target.checked ? { from: '-30d' } : null)} /> {t('overrideRange')}
          </label>
          {range && <DateRangePicker value={range} onChange={setRange} />}
          <button type="button" className="btn btn-sm" onClick={() => setRefreshKey((k) => k + 1)}>
            {t('refresh')}
          </button>
        </div>
      )}
      {insights.length === 0 ? (
        <EmptyState
          product="analytics"
          title={t('tileEmptyTitle')}
          body={allInsights.length ? t('tileEmptyBody') : t('tileEmptyBodyNoInsights')}
          action={{ label: t('newInsight'), href: '/app/analytics/insights/new' }}
        />
      ) : (
        <div className="an-tiles">
          {insights.map((i) => (
            <Tile
              key={i.id}
              projectId={projectId}
              insight={i}
              range={range}
              refreshKey={refreshKey}
              annotations={annotations}
              onMove={(d) => move(i.id, d)}
              onRemove={() => void patch({ insightIds: dashboard.insightIds.filter((x) => x !== i.id) })}
            />
          ))}
        </div>
      )}
      <ShareDialog open={sharing} onClose={() => setSharing(false)} projectId={projectId} target={{ dashboardId: dashboard.id }} />
      <NameDialog
        open={renaming}
        title={tc('rename')}
        label={t('name')}
        initial={dashboard.name}
        submitLabel={tc('save')}
        busy={busy}
        error={error}
        onClose={() => setRenaming(false)}
        onSubmit={async (name) => {
          if (await patch({ name })) setRenaming(false);
        }}
      />
      <ConfirmDialog
        open={deleting}
        title={t('deleteTitle', { name: dashboard.name })}
        body={t('deleteBody')}
        confirmLabel={tc('delete')}
        cancelLabel={tc('cancel')}
        danger
        busy={busy}
        onCancel={() => setDeleting(false)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api(`/api/analytics/dashboards/${dashboard.id}`, { method: 'DELETE' });
            notifyChanged();
            router.replace('/app/analytics/dashboards');
          } catch {
            setError(tc('error'));
            setBusy(false);
          }
        }}
      />
    </div>
  );
}
