'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { RealtimeMode } from '@/lib/realtime-client';
import type { BoardData } from '@/lib/fleet/board';
import type { DeployState } from '@/lib/fleet/types';
import { Ago, DeployMark, Ext } from './ui';
import { useBoard } from './useBoard';
import SyncButton from './SyncButton';

/** Deploys de todas las cuentas de Vercel: qué sirve producción en cada proyecto y los últimos, con rama, commit y PR. */
export default function FleetDeploys({ initial, realtimeMode }: { initial: BoardData; realtimeMode?: RealtimeMode }) {
  const t = useTranslations('fleet');
  const { board, sync, syncing, error } = useBoard(initial, realtimeMode);
  const [state, setState] = useState<DeployState | 'all'>('all');
  const [project, setProject] = useState('');
  const projects = useMemo(() => [...new Set(board.deploys.map((d) => d.project))].sort(), [board.deploys]);
  const serving = useMemo(() => {
    const m = new Map<string, (typeof board.deploys)[number]>();
    for (const d of board.deploys) if (d.serving && !m.has(d.project)) m.set(d.project, d);
    return [...m.values()].sort((a, b) => a.project.localeCompare(b.project));
  }, [board]);
  const list = board.deploys.filter((d) => (state === 'all' || d.state === state) && (!project || d.project === project));
  const hasVercel = board.connections.some((c) => c.kind === 'vercel');

  return (
    <div className="app-page ui-page flt-page" data-testid="fleet-deploys">
      <PageHeader title={t('nav.deploys')} description={t('deploys.desc')} actions={<SyncButton onSync={sync} syncing={syncing} error={error} connections={board.connections} />} />
      {!hasVercel ? (
        <EmptyState product="fleet" title={t('deploys.emptyTitle')} body={t('empty.noVercel')} action={{ label: t('settings.connectVercel'), href: '/app/fleet/settings#vercel' }} />
      ) : (
        <>
          {serving.length > 0 && (
            <section className="flt-section">
              <h2 className="flt-h2">{t('deploys.production')}</h2>
              <ul className="flt-prod">
                {serving.map((d) => (
                  <li key={d.id} className="flt-prod-item" data-testid="fleet-serving">
                    <span className="flt-prod-name">{d.project}</span>
                    <Ext href={d.url} className="flt-row-title">
                      {d.commitMessage || d.sha.slice(0, 7)}
                    </Ext>
                    <span className="flt-meta">
                      <Ago iso={d.readyAt ?? d.at} />
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="flt-section">
            <div className="flt-section-head">
              <h2 className="flt-h2">
                {t('deploys.latest')} <span className="flt-count">{board.deploys.length}</span>
              </h2>
              <div className="flt-filters">
                <select className="select" aria-label={t('filters.state')} value={state} onChange={(e) => setState(e.target.value as DeployState | 'all')} data-testid="fleet-filter-state">
                  <option value="all">{t('filters.allStates')}</option>
                  {(['building', 'queued', 'ready', 'error', 'canceled'] as const).map((s) => (
                    <option key={s} value={s}>
                      {t(`deployState.${s}`)}
                    </option>
                  ))}
                </select>
                {projects.length > 1 && (
                  <select className="select" aria-label={t('filters.project')} value={project} onChange={(e) => setProject(e.target.value)}>
                    <option value="">{t('filters.allProjects')}</option>
                    {projects.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
            {list.length === 0 ? (
              <EmptyState compact quiet body={board.deploys.length ? t('empty.noMatch') : t('empty.noDeploys')} />
            ) : (
              <ul className="flt-rows flt-rows-lg">
                {list.map((d) => (
                  <li key={d.id} className="flt-row" data-testid="fleet-deploy" data-state={d.state}>
                    <DeployMark state={d.state} showLabel={false} />
                    <div className="flt-row-main">
                      <Ext href={d.inspectorUrl || d.url} className="flt-row-title">
                        {d.commitMessage || d.url}
                      </Ext>
                      <span className="flt-row-sub">
                        <span>{d.project}</span>
                        <span>{t(`deployState.${d.state}`)}</span>
                        <span>{d.target === 'production' ? t('deploys.production') : t('deploys.preview')}</span>
                        {d.serving && <span className="flt-ok">{t('deploys.serving')}</span>}
                        {d.branch && <span className="flt-mono">{d.branch}</span>}
                        {d.prNumber && <span>{t('card.pr', { n: d.prNumber })}</span>}
                        {d.creator && <span>{d.creator}</span>}
                      </span>
                    </div>
                    <Ago iso={d.at} className="flt-meta flt-nowrap" />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
