import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { listProjectOverview, type TrackProjectOverview } from '@/lib/track-data';
import { formatDay, toIsoDay } from '@/lib/track-tasks';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import EmptyState from '@/components/ui/EmptyState';
import QuickProjectButton from './QuickProjectButton';
import { teamPath } from '@/lib/track-routes';

/**
 * Resumen de Track: una fila por proyecto con el ciclo en curso y su avance,
 * lo vencido y lo que espera triage. La lista completa vive en Proyectos.
 */
export default async function TrackOverview({ locale }: { locale: string }) {
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'track' });
  const today = toIsoDay(new Date());
  const rows = await listProjectOverview(user.team?.id ?? null, user.id, today);

  const cycleCell = (p: TrackProjectOverview) => {
    if (!p.cycle_id) return <span className="track-cell-dim">{t('overview.noCycle')}</span>;
    const pct = p.cycle_total > 0 ? Math.round((p.cycle_done / p.cycle_total) * 100) : 0;
    return (
      <span className="track-overview-cycle">
        <span className="track-overview-cycle-name">{p.cycle_name}</span>
        <span
          className="track-cycle-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={p.cycle_total}
          aria-valuenow={p.cycle_done}
          aria-label={t('cycles.progress', { done: p.cycle_done, total: p.cycle_total })}
        >
          <span style={{ width: `${pct}%` }} />
        </span>
        <span className="track-overview-cycle-meta">
          {t('overview.cycleMeta', {
            done: p.cycle_done,
            total: p.cycle_total,
            end: formatDay((p.cycle_end ?? '').slice(0, 10), locale, today),
          })}
        </span>
      </span>
    );
  };

  const count = (n: number, strong: boolean) => (
    <span className={n > 0 && strong ? 'track-overview-alert' : n === 0 ? 'track-cell-dim' : undefined}>{n}</span>
  );

  return (
    <div className="app-page track-page ui-page">
      <PageHeader
        title={t('overview.title')}
        description={t('overview.subtitle')}
        actions={rows.length > 0 ? <QuickProjectButton listenParam /> : null}
      />
      {rows.length === 0 ? (
        <EmptyState
          title={t('overview.emptyTitle')}
          body={t('overview.emptySub')}
          action={<QuickProjectButton testId="track-new-project-empty" listenParam />}
          secondary={t('overview.emptySecondary')}
        />
      ) : (
        <DataTable
          caption={t('overview.title')}
          className="track-overview"
          rows={rows}
          rowKey={(p) => p.id}
          rowHref={(p) => teamPath(p)}
          columns={[
            {
              key: 'name',
              header: t('projects.column.project'),
              width: '22%',
              cell: (p) => (
                <>
                  {p.icon ? <span className="track-project-icon">{p.icon}</span> : null}
                  {p.name}
                </>
              ),
            },
            { key: 'cycle', header: t('overview.cycle'), cell: cycleCell },
            { key: 'overdue', header: t('myTasks.overdue'), numeric: true, width: '110px', cell: (p) => count(p.overdue, true) },
            { key: 'triage', header: t('overview.triage'), numeric: true, width: '110px', cell: (p) => count(p.triage, true) },
            { key: 'open', header: t('projects.column.open'), numeric: true, width: '110px', cell: (p) => count(p.open_issues, false) },
          ]}
        />
      )}
    </div>
  );
}
