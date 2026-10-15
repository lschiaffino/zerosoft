'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { relDate } from '@/lib/utils';
import type { TrackStatusRow } from '@/lib/db';
import type { TrackIssueWithStatus } from '@/lib/track-data';

interface TriagePanelProps {
  projectId: string;
  issues: TrackIssueWithStatus[];
  statuses: TrackStatusRow[];
  locale: string;
  onResolved: () => void;
}

async function resolve(issueId: string, body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/track/issues/${issueId}/triage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (res?.ok) return { ok: true };
  const data = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : {};
  return { ok: false, error: data.error };
}

function TriageRow({
  issue,
  statuses,
  locale,
  onResolved,
}: { issue: TrackIssueWithStatus } & Omit<TriagePanelProps, 'issues' | 'projectId'>) {
  const t = useTranslations('track');
  const defaultStatus = statuses.find((s) => s.category === 'todo') ?? statuses[0];
  const [statusId, setStatusId] = useState(defaultStatus?.id ?? '');
  const [dupOpen, setDupOpen] = useState(false);
  const [dupOf, setDupOf] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const source = issue.source && issue.source !== 'app' ? issue.source : 'api';

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const res = await resolve(issue.id, body);
    setBusy(false);
    if (res.ok) onResolved();
    else if (body.action === 'duplicate' && res.error === 'invalid_duplicate') setError(t('triage.duplicateNotFound'));
    else setError(t('triage.error'));
  };

  const markDuplicate = async () => {
    const ident = dupOf.trim().toUpperCase();
    if (!ident) return;
    // El servidor busca el identifier exacto en todo el workspace.
    await act({ action: 'duplicate', duplicateOfIdentifier: ident });
  };

  return (
    <li className="track-triage-item" data-testid="track-triage-item">
      <div className="track-triage-main">
        <Link href={`/app/track/issues/${issue.id}`} className="track-triage-title">
          <span className="track-identifier">{issue.identifier}</span> {issue.title || '—'}
        </Link>
        <span className="muted mono track-triage-meta">
          {t('triage.from', { source: t(`triage.sources.${source}`) })} · {relDate(issue.created_at, locale)}
        </span>
      </div>
      <div className="track-triage-actions">
        <select value={statusId} onChange={(e) => setStatusId(e.target.value)} aria-label={t('triage.acceptAs')} disabled={busy}>
          {statuses
            .filter((s) => s.category !== 'cancelled')
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </select>
        <button
          type="button"
          className="btn btn-small btn-solid"
          disabled={busy}
          onClick={() => void act({ action: 'accept', statusId: statusId || undefined })}
          data-testid="track-triage-accept"
        >
          {t('triage.accept')}
        </button>
        <button type="button" className="btn btn-small" disabled={busy} onClick={() => void act({ action: 'decline' })}>
          {t('triage.decline')}
        </button>
        <button type="button" className="btn btn-small" disabled={busy} onClick={() => setDupOpen((v) => !v)} aria-expanded={dupOpen}>
          {t('triage.duplicate')}
        </button>
      </div>
      {dupOpen && (
        <form
          className="track-triage-dup"
          onSubmit={(e) => {
            e.preventDefault();
            void markDuplicate();
          }}
        >
          <label className="track-sr-only" htmlFor={`dup-${issue.id}`}>
            {t('triage.duplicateOf')}
          </label>
          <input
            id={`dup-${issue.id}`}
            value={dupOf}
            onChange={(e) => setDupOf(e.target.value)}
            placeholder={t('triage.duplicatePlaceholder')}
            maxLength={80}
          />
          <button type="submit" className="btn btn-small" disabled={busy || !dupOf.trim()}>
            {t('triage.duplicateOf')}
          </button>
        </form>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

/** Cola de triage del proyecto. */
export default function TriagePanel(props: TriagePanelProps) {
  const t = useTranslations('track');
  if (props.issues.length === 0) {
    return (
      <div className="track-empty">
        <p>{t('triage.empty')}</p>
      </div>
    );
  }
  return (
    <ul className="track-triage-list" data-testid="track-triage-list">
      {props.issues.map((issue) => (
        <TriageRow key={issue.id} issue={issue} {...props} />
      ))}
    </ul>
  );
}
