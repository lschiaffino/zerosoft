'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { branchNameFor } from '@/lib/track-branch';
import type { TrackIssueLink } from '@/lib/track-github';

export interface GithubData {
  branchName: string;
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

/**
 * Botón "Copiar nombre de branch" (zer-123-titulo-del-issue). Se calcula en el
 * cliente para que siga al título si se renombra el issue.
 */
export function CopyBranchButton({ identifier, title }: { identifier: string; title: string }) {
  const t = useTranslations('track');
  const [copied, setCopied] = useState(false);
  const branchName = branchNameFor(identifier, title);
  return (
    <button
      type="button"
      className="btn btn-outline"
      title={branchName}
      data-testid="track-copy-branch"
      data-branch={branchName}
      onClick={() => {
        void navigator.clipboard?.writeText(branchName).catch(() => undefined);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? t('github.copied') : t('github.copyBranch')}
    </button>
  );
}

/** PRs y commits de GitHub vinculados al issue. */
export function IssueGithubPanel({ data }: { data: GithubData | null }) {
  const t = useTranslations('track');
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
