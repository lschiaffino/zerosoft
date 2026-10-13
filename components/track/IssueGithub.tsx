'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { TrackIssueLink } from '@/lib/track-github';

interface GithubData {
  branchName: string;
  rows: TrackIssueLink[];
}

function useIssueGithub(issueId: string): GithubData | null {
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

/** Botón "Copiar nombre de branch" (zer-123-titulo-del-issue). */
export function CopyBranchButton({ issueId }: { issueId: string }) {
  const t = useTranslations('track');
  const data = useIssueGithub(issueId);
  const [copied, setCopied] = useState(false);
  if (!data) return null;
  return (
    <button
      type="button"
      className="btn btn-outline"
      title={data.branchName}
      data-testid="track-copy-branch"
      data-branch={data.branchName}
      onClick={() => {
        void navigator.clipboard?.writeText(data.branchName).catch(() => undefined);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? t('github.copied') : t('github.copyBranch')}
    </button>
  );
}

/** PRs y commits de GitHub vinculados al issue. */
export function IssueGithubPanel({ issueId }: { issueId: string }) {
  const t = useTranslations('track');
  const data = useIssueGithub(issueId);
  if (!data) return null;
  return (
    <section className="panel" data-testid="track-issue-github">
      <p className="section-label">{t('github.linked')}</p>
      {data.rows.length === 0 ? (
        <p className="muted">{t('github.noLinks')}</p>
      ) : (
        <ul className="track-gh-list">
          {data.rows.map((l) => (
            <li key={l.id} className="track-gh-item">
              <span className="track-gh-kind mono">{l.kind === 'pr' ? `#${l.ref}` : l.ref.slice(0, 7)}</span>
              <a href={l.url} target="_blank" rel="noreferrer" className="track-gh-title">
                {l.title || l.url}
              </a>
              <span className={`track-gh-state is-${l.state} mono`}>{t(`github.states.${l.state}`)}</span>
              <span className="track-gh-repo muted mono">{l.repo}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
