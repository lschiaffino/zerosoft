'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { DashboardDto, InsightDto, InsightResult } from '@/lib/analytics/types';
import { ApiError, apiErrorText, api, notifyChanged, runQuery } from './client';
import InsightResultView from './InsightResultView';
import NameDialog from './NameDialog';

function Tile({ projectId, insight, onRemove }: { projectId: string; insight: InsightDto; onRemove: () => void }) {
  const t = useTranslations('analytics.dashboards');
  const te = useTranslations('analytics.editor');
  const [result, setResult] = useState<InsightResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const c = new AbortController();
    runQuery(projectId, insight.query, c.signal)
      .then(setResult)
      .catch((err) => {
        if (!c.signal.aborted) setError(err instanceof ApiError && te.has(`errors.${err.code}`) ? te(`errors.${err.code}`) : te('errors.request_failed'));
      });
    return () => c.abort();
  }, [projectId, insight, te]);
  return (
    <article className="an-tile an-panel" aria-label={insight.name}>
      <header className="an-tile-head">
        <Link href={`/app/analytics/insights/${insight.id}`} className="an-tile-title">
          {insight.name}
        </Link>
        <span className="an-muted an-small">{te(`kinds.${insight.kind}`)}</span>
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
      {result && <InsightResultView result={result} display={insight.query.kind === 'trends' ? insight.query.display : 'line'} />}
    </article>
  );
}

/** Un tablero: sus insights en grilla, renombrar, sumar o sacar insights y borrar. */
export default function DashboardView({ projectId, dashboard, insights, allInsights }: { projectId: string; dashboard: DashboardDto; insights: InsightDto[]; allInsights: Array<{ id: string; name: string }> }) {
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

  return (
    <div className="app-page ui-page an-page">
      <PageHeader
        back={{ href: '/app/analytics/dashboards', label: t('title') }}
        title={dashboard.name}
        description={dashboard.description || undefined}
        actions={
          <>
            {available.length > 0 && (
              <select
                className="select"
                aria-label={t('addInsight')}
                value=""
                onChange={(e) => e.target.value && void patch({ insightIds: [...dashboard.insightIds, e.target.value] })}
              >
                <option value="">{t('addInsight')}</option>
                {available.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            )}
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
            <Tile key={i.id} projectId={projectId} insight={i} onRemove={() => void patch({ insightIds: dashboard.insightIds.filter((x) => x !== i.id) })} />
          ))}
        </div>
      )}
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
