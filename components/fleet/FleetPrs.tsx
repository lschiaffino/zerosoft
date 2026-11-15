'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { RealtimeMode } from '@/lib/realtime-client';
import type { BoardData } from '@/lib/fleet/board';
import type { ChecksState, PullDto } from '@/lib/fleet/types';
import { Ago, ChecksMark, Ext } from './ui';
import { useBoard } from './useBoard';
import SyncButton from './SyncButton';

/** PRs abiertos de todas las cuentas de GitHub, por repo, con CI, auto-merge y si se puede mergear; corridas y releases. */
export default function FleetPrs({ initial, realtimeMode, initialChecks = '' }: { initial: BoardData; realtimeMode?: RealtimeMode; initialChecks?: string }) {
  const t = useTranslations('fleet');
  const { board, sync, syncing, error } = useBoard(initial, realtimeMode);
  const [checks, setChecks] = useState<ChecksState | 'all'>((['success', 'failure', 'pending'].includes(initialChecks) ? initialChecks : 'all') as ChecksState | 'all');
  const [repo, setRepo] = useState('');
  const repos = useMemo(() => [...new Set(board.pulls.map((p) => p.repo))].sort(), [board.pulls]);
  const list = board.pulls.filter((p) => (checks === 'all' || p.checks === checks) && (!repo || p.repo === repo));
  const byRepo = useMemo(() => {
    const m = new Map<string, PullDto[]>();
    for (const p of list) m.set(p.repo, [...(m.get(p.repo) ?? []), p]);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [list]);
  const hasGithub = board.connections.some((c) => c.kind === 'github');

  return (
    <div className="app-page ui-page flt-page" data-testid="fleet-prs">
      <PageHeader title={t('nav.prs')} description={t('prs.desc')} actions={<SyncButton onSync={sync} syncing={syncing} error={error} connections={board.connections} />} />
      {!hasGithub ? (
        <EmptyState product="fleet" title={t('prs.emptyTitle')} body={t('empty.noGithub')} action={{ label: t('settings.connectGithub'), href: '/app/fleet/settings#github' }} />
      ) : (
        <>
          <div className="flt-filters flt-filters-bar">
            <select className="select" aria-label={t('filters.checks')} value={checks} onChange={(e) => setChecks(e.target.value as ChecksState | 'all')} data-testid="fleet-filter-checks">
              <option value="all">{t('filters.allChecks')}</option>
              <option value="failure">{t('checks.failure')}</option>
              <option value="pending">{t('checks.pending')}</option>
              <option value="success">{t('checks.success')}</option>
            </select>
            {repos.length > 1 && (
              <select className="select" aria-label={t('filters.repo')} value={repo} onChange={(e) => setRepo(e.target.value)} data-testid="fleet-filter-repo">
                <option value="">{t('filters.allRepos')}</option>
                {repos.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            )}
          </div>
          {list.length === 0 ? (
            <EmptyState compact quiet body={board.pulls.length ? t('empty.noMatch') : t('empty.noPrs')} />
          ) : (
            byRepo.map(([name, prs]) => (
              <section key={name} className="flt-section" data-testid="fleet-repo">
                <h2 className="flt-h3">
                  {name} <span className="flt-count">{prs.length}</span>
                </h2>
                <ul className="flt-rows flt-rows-lg">
                  {prs.map((p) => (
                    <li key={p.id} className="flt-row flt-pr" data-testid="fleet-pr" data-checks={p.checks || 'none'}>
                      <ChecksMark state={p.checks} />
                      <div className="flt-row-main">
                        <Ext href={p.url} className="flt-row-title">
                          {p.title}
                        </Ext>
                        <span className="flt-row-sub">
                          <span>#{p.number}</span>
                          {p.author && <span>{p.author}</span>}
                          {p.branch && <span className="flt-mono">{p.branch}</span>}
                          {p.draft && <span>{t('prs.draft')}</span>}
                          {p.autoMerge && <span data-testid="fleet-pr-automerge">{t('prs.autoMerge')}</span>}
                          {p.mergeable === 'CONFLICTING' && <span className="flt-bad">{t('prs.conflicts')}</span>}
                          {p.mergeState === 'behind' && <span>{t('prs.behind')}</span>}
                        </span>
                      </div>
                      <Ago iso={p.updatedAt} className="flt-meta flt-nowrap" />
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
          <div className="flt-split">
            <section className="flt-section">
              <h2 className="flt-h2">{t('prs.runs')}</h2>
              {board.runs.length === 0 ? (
                <EmptyState compact quiet body={t('prs.noRuns')} />
              ) : (
                <ul className="flt-rows">
                  {board.runs.slice(0, 12).map((r) => (
                    <li key={r.id} className="flt-row" data-testid="fleet-run">
                      <ChecksMark state={r.status !== 'completed' ? 'pending' : r.conclusion === 'success' ? 'success' : r.conclusion === 'failure' || r.conclusion === 'timed_out' ? 'failure' : ''} />
                      <Ext href={r.url} className="flt-row-title">
                        {r.name} · {r.branch}
                      </Ext>
                      <span className="flt-meta flt-nowrap">{r.repo.split('/')[1]}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="flt-section">
              <h2 className="flt-h2">{t('prs.releases')}</h2>
              {board.releases.length === 0 ? (
                <EmptyState compact quiet body={t('prs.noReleases')} />
              ) : (
                <ul className="flt-rows">
                  {board.releases.map((r) => (
                    <li key={r.id} className="flt-row" data-testid="fleet-release">
                      <Ext href={r.url} className="flt-row-title">
                        {r.name}
                      </Ext>
                      <span className="flt-meta flt-nowrap">{r.repo.split('/')[1]}</span>
                      <Ago iso={r.at} className="flt-meta flt-nowrap" />
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
