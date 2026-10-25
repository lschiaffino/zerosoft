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

const REVIEW_STATES = ['approved', 'changes_requested', 'commented', 'requested'] as const;

/** Reviews del PR (login → estado) en el orden en que llegaron. */
function reviewsOf(l: TrackIssueLink): Array<[string, (typeof REVIEW_STATES)[number]]> {
  try {
    const v = JSON.parse(l.reviews ?? '{}') as Record<string, string>;
    return Object.entries(v).filter((e): e is [string, (typeof REVIEW_STATES)[number]] =>
      (REVIEW_STATES as readonly string[]).includes(e[1]),
    );
  } catch {
    return [];
  }
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
              <span className="track-gh-badges">
                <span className={`badge track-gh-state is-${l.state}`}>{t(`github.states.${l.state}`)}</span>
                {l.kind === 'pr' && l.checks ? (
                  <span
                    className={`badge track-gh-checks ${l.checks === 'success' ? 'badge-ok' : l.checks === 'failure' ? 'badge-bad' : 'badge-warn'}`}
                    data-testid="track-gh-checks"
                  >
                    {t(`github.checks.${l.checks}`)}
                  </span>
                ) : null}
              </span>
              <span className="track-gh-repo data">{l.repo}</span>
              {l.kind === 'pr' && reviewsOf(l).length > 0 ? (
                <span className="track-gh-reviews" data-testid="track-gh-reviews">
                  {reviewsOf(l).map(([login, st]) => (
                    <span key={login} className={`track-gh-review is-${st}`}>
                      {login} · {t(`github.reviews.${st}`)}
                    </span>
                  ))}
                </span>
              ) : null}
              {l.kind === 'pr' && l.closes === 0 ? <span className="st-muted track-gh-ref">{t('github.refOnly')}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
