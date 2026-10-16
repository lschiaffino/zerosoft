'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { TrackIssueLink } from '@/lib/track-github';

export interface GithubData {
  branchName: string;
  /** El workspace tiene GitHub conectado. */
  connected: boolean;
  rows: TrackIssueLink[];
}

/** PRs y commits vinculados: se pide una sola vez por issue y se comparte. */
export function useIssueGithub(issueId: string): GithubData | null {
  const [data, setData] = useState<GithubData | null>(null);
  useEffect(() => {
    let alive = true;
    void fetch(`/api/track/issues/${issueId}/github`)
      .then((r) => (r.ok ? (r.json() as Promise<GithubData>) : null))
      .then((d) => alive && setData(d))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [issueId]);
  return data;
}

/** PRs y commits de GitHub vinculados al issue: solo con GitHub conectado o con vínculos. */
export function IssueGithubPanel({ data }: { data: GithubData | null }) {
  const t = useTranslations('track');
  if (!data || (!data.connected && data.rows.length === 0)) return null;
  return (
    <section className="track-detail-section" data-testid="track-issue-github">
      <h2 className="track-section-title">{t('github.linked')}</h2>
      {data.rows.length === 0 ? (
        <p className="ui-help">{t('github.noLinks')}</p>
      ) : (
        <ul className="track-gh-list">
          {data.rows.map((l) => (
            <li key={l.id} className="track-gh-item">
              <span className="track-gh-kind data">{l.kind === 'pr' ? `#${l.ref}` : l.ref.slice(0, 7)}</span>
              <a href={l.url} target="_blank" rel="noreferrer" className="track-gh-title">
                {l.title || l.url}
              </a>
              <span className={`badge track-gh-state is-${l.state}`}>{t(`github.states.${l.state}`)}</span>
              <span className="track-gh-repo data">{l.repo}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
