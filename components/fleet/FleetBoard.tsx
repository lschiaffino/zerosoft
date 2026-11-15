'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { RealtimeMode } from '@/lib/realtime-client';
import type { BoardData } from '@/lib/fleet/board';
import { groupKey, type SessionStatus } from '@/lib/fleet/types';
import SessionCard from './SessionCard';
import { Ago, ChecksMark, DeployMark, Ext } from './ui';
import { useBoard } from './useBoard';
import SyncButton from './SyncButton';

type Filter = 'all' | SessionStatus | 'active';

/**
 * "Ahora": cuántos agentes trabajan, cuántos te esperan, PRs abiertos y con el CI en rojo, deploys en curso; las
 * sesiones en tarjetas agrupadas por proyecto, con filtros; y lo último de PRs y deploys.
 */
export default function FleetBoard({ initial, realtimeMode }: { initial: BoardData; realtimeMode?: RealtimeMode }) {
  const t = useTranslations('fleet');
  const { board, sync, syncing, error } = useBoard(initial, realtimeMode);
  const [status, setStatus] = useState<Filter>('all');
  const [project, setProject] = useState('');
  const [q, setQ] = useState('');

  const projects = useMemo(() => [...new Set(board.sessions.map((s) => groupKey(s)).filter(Boolean))].sort(), [board.sessions]);
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return board.sessions.filter((s) => {
      if (status === 'active' ? !(s.status === 'working' || s.status === 'waiting') : status !== 'all' && s.status !== status) return false;
      if (project && groupKey(s) !== project) return false;
      if (needle && !`${s.title} ${s.project} ${s.branch} ${s.lastText}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [board.sessions, status, project, q]);
  const groups = useMemo(() => {
    const map = new Map<string, typeof visible>();
    for (const s of visible) {
      const k = groupKey(s);
      map.set(k, [...(map.get(k) ?? []), s]);
    }
    return [...map.entries()];
  }, [visible]);

  const s = board.summary;
  const pullsSorted = useMemo(
    () => [...board.pulls].sort((a, b) => rankChecks(a.checks) - rankChecks(b.checks) || String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 8),
    [board.pulls],
  );
  const deploys = board.deploys.slice(0, 8);
  const nothing = board.sessions.length === 0 && board.connections.length === 0;

  const tiles: Array<{ key: string; value: number; label: string; onClick?: () => void; href?: string; tone?: string; pressed?: boolean }> = [
    { key: 'working', value: s.working, label: t('now.working'), onClick: () => setStatus(status === 'working' ? 'all' : 'working'), pressed: status === 'working' },
    { key: 'waiting', value: s.waiting, label: t('now.waiting'), onClick: () => setStatus(status === 'waiting' ? 'all' : 'waiting'), tone: s.waiting ? 'warn' : '', pressed: status === 'waiting' },
    { key: 'prs', value: s.prsOpen, label: t('now.prsOpen'), href: '/app/fleet/prs' },
    { key: 'failing', value: s.failingChecks, label: t('now.failing'), href: '/app/fleet/prs?checks=failure', tone: s.failingChecks ? 'bad' : '' },
    { key: 'deploying', value: s.deploying, label: t('now.deploying'), href: '/app/fleet/deploys' },
  ];

  return (
    <div className="app-page ui-page flt-page" data-testid="fleet-board">
      <PageHeader title={t('now.title')} description={t('now.desc')} actions={<SyncButton onSync={sync} syncing={syncing} error={error} connections={board.connections} />} />
      {nothing ? (
        <EmptyState
          product="fleet"
          title={t('empty.title')}
          body={t('empty.body')}
          action={{ label: t('empty.action'), href: '/app/fleet/settings' }}
        />
      ) : (
        <>
          <ul className="flt-tiles" aria-label={t('now.summary')}>
            {tiles.map((tile) => (
              <li key={tile.key}>
                {tile.href ? (
                  <Link href={tile.href} className="flt-tile" data-tone={tile.tone || undefined} data-testid={`fleet-tile-${tile.key}`}>
                    <span className="flt-tile-n">{tile.value}</span>
                    <span className="flt-tile-l">{tile.label}</span>
                  </Link>
                ) : (
                  <button type="button" className="flt-tile" data-tone={tile.tone || undefined} aria-pressed={tile.pressed} onClick={tile.onClick} data-testid={`fleet-tile-${tile.key}`}>
                    <span className="flt-tile-n">{tile.value}</span>
                    <span className="flt-tile-l">{tile.label}</span>
                  </button>
                )}
              </li>
            ))}
          </ul>

          <section className="flt-section" aria-labelledby="flt-agents-h">
            <div className="flt-section-head">
              <h2 id="flt-agents-h" className="flt-h2">
                {t('now.agents')} <span className="flt-count">{board.sessions.length}</span>
              </h2>
              <div className="flt-filters">
                <input
                  type="search"
                  className="input flt-search"
                  placeholder={t('filters.search')}
                  aria-label={t('filters.search')}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  data-testid="fleet-filter-q"
                />
                <select className="select" aria-label={t('filters.status')} value={status} onChange={(e) => setStatus(e.target.value as Filter)} data-testid="fleet-filter-status">
                  <option value="all">{t('filters.allStatuses')}</option>
                  <option value="active">{t('filters.active')}</option>
                  {(['waiting', 'working', 'failed', 'done', 'idle'] as const).map((st) => (
                    <option key={st} value={st}>
                      {t(`status.${st}`)}
                    </option>
                  ))}
                </select>
                {projects.length > 1 && (
                  <select className="select" aria-label={t('filters.project')} value={project} onChange={(e) => setProject(e.target.value)} data-testid="fleet-filter-project">
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
            {board.sessions.length === 0 ? (
              <EmptyState compact quiet body={t('empty.noAgents')} action={{ label: t('empty.connectAgents'), href: '/app/fleet/settings#agents' }} />
            ) : visible.length === 0 ? (
              <EmptyState compact quiet body={t('empty.noMatch')} />
            ) : (
              groups.map(([key, list]) => (
                <div key={key || '-'} className="flt-group" data-testid="fleet-group">
                  <h3 className="flt-h3">
                    {key || t('now.noProject')} <span className="flt-count">{list.length}</span>
                  </h3>
                  <div className="flt-cards">
                    {list.map((sess) => (
                      <SessionCard key={sess.id} s={sess} />
                    ))}
                  </div>
                </div>
              ))
            )}
          </section>

          <div className="flt-split">
            <section className="flt-section" aria-labelledby="flt-prs-h">
              <div className="flt-section-head">
                <h2 id="flt-prs-h" className="flt-h2">
                  {t('nav.prs')} <span className="flt-count">{board.pulls.length}</span>
                </h2>
                <Link href="/app/fleet/prs" className="flt-more">
                  {t('now.seeAll')}
                </Link>
              </div>
              {pullsSorted.length === 0 ? (
                <EmptyState compact quiet body={board.connections.some((c) => c.kind === 'github') ? t('empty.noPrs') : t('empty.noGithub')} />
              ) : (
                <ul className="flt-rows">
                  {pullsSorted.map((p) => (
                    <li key={p.id} className="flt-row" data-testid="fleet-now-pr">
                      <ChecksMark state={p.checks} />
                      <Ext href={p.url} className="flt-row-title">
                        {p.title}
                      </Ext>
                      <span className="flt-meta flt-nowrap">
                        {p.repo.split('/')[1]} #{p.number}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="flt-section" aria-labelledby="flt-dp-h">
              <div className="flt-section-head">
                <h2 id="flt-dp-h" className="flt-h2">
                  {t('nav.deploys')} <span className="flt-count">{board.deploys.length}</span>
                </h2>
                <Link href="/app/fleet/deploys" className="flt-more">
                  {t('now.seeAll')}
                </Link>
              </div>
              {deploys.length === 0 ? (
                <EmptyState compact quiet body={board.connections.some((c) => c.kind === 'vercel') ? t('empty.noDeploys') : t('empty.noVercel')} />
              ) : (
                <ul className="flt-rows">
                  {deploys.map((d) => (
                    <li key={d.id} className="flt-row" data-testid="fleet-now-deploy">
                      <DeployMark state={d.state} showLabel={false} />
                      <Ext href={d.inspectorUrl || d.url} className="flt-row-title">
                        {d.project}
                        {d.branch ? ` · ${d.branch}` : ''}
                      </Ext>
                      {d.serving && <span className="flt-meta">{t('deploys.serving')}</span>}
                      <Ago iso={d.at} className="flt-meta flt-nowrap" />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function rankChecks(c: string): number {
  return c === 'failure' ? 0 : c === 'pending' ? 1 : 2;
}
