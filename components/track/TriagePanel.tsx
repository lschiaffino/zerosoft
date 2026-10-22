'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { relDate } from '@/lib/utils';
import EmptyState from '@/components/ui/EmptyState';
import type { TrackStatusRow } from '@/lib/db';
import type { TrackIssueWithStatus } from '@/lib/track-data';
import { defaultIssueStatus } from '@/lib/track-tasks';

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

/**
 * Aceptar / rechazar / duplicado de un issue en triage. Se usa en la cola y en
 * el banner del detalle.
 */
export function TriageActions({
  issue,
  statuses,
  onResolved,
}: {
  issue: Pick<TrackIssueWithStatus, 'id'>;
  statuses: TrackStatusRow[];
  onResolved: () => void;
}) {
  const t = useTranslations('track');
  const defaultStatus = defaultIssueStatus(statuses);
  const [statusId, setStatusId] = useState(defaultStatus?.id ?? '');
  const [dupOpen, setDupOpen] = useState(false);
  const [dupOf, setDupOf] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const res = await resolve(issue.id, body);
    setBusy(false);
    if (res.ok) onResolved();
    else if (body.action === 'duplicate' && res.error === 'invalid_duplicate') setError(t('triage.duplicateNotFound'));
    else if (res.error === 'not_in_triage') {
      // Otra persona lo resolvió antes: avisar y recargar la cola.
      setError(t('triage.alreadyResolved'));
      onResolved();
    } else setError(t('triage.error'));
  };

  const markDuplicate = async () => {
    const ident = dupOf.trim().toUpperCase();
    if (!ident) return;
    // El servidor busca el identifier exacto en todo el workspace.
    await act({ action: 'duplicate', duplicateOfIdentifier: ident });
  };

  return (
    <>
      <div className="track-triage-actions">
        <label className="track-triage-accept-in" htmlFor={`accept-${issue.id}`}>
          {t('triage.acceptAs')}
        </label>
        <select
          id={`accept-${issue.id}`}
          className="select"
          value={statusId}
          onChange={(e) => setStatusId(e.target.value)}
          disabled={busy}
        >
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
          className="btn btn-sm btn-primary"
          disabled={busy}
          onClick={() => void act({ action: 'accept', statusId: statusId || undefined })}
          data-testid="track-triage-accept"
        >
          {t('triage.accept')}
        </button>
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void act({ action: 'decline' })}>
          {t('triage.decline')}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setDupOpen((v) => !v)} aria-expanded={dupOpen}>
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
          <label className="sr-only" htmlFor={`dup-${issue.id}`}>
            {t('triage.duplicateOf')}
          </label>
          <input
            className="input data"
            id={`dup-${issue.id}`}
            value={dupOf}
            onChange={(e) => setDupOf(e.target.value)}
            placeholder={t('triage.duplicatePlaceholder')}
            maxLength={80}
          />
          <button type="submit" className="btn btn-sm" disabled={busy || !dupOf.trim()}>
            {t('triage.duplicateOf')}
          </button>
        </form>
      )}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function TriageRow({
  issue,
  statuses,
  locale,
  onResolved,
}: { issue: TrackIssueWithStatus } & Omit<TriagePanelProps, 'issues' | 'projectId'>) {
  const t = useTranslations('track');
  const source = issue.source && issue.source !== 'app' ? issue.source : 'api';

  return (
    <li className="track-triage-item" data-testid="track-triage-item">
      <div className="track-triage-main">
        <Link href={`/app/track/issues/${issue.id}`} className="track-triage-title">
          <span className="track-identifier">{issue.identifier}</span> {issue.title || t('issues.untitled')}
        </Link>
        <span className="track-triage-meta">
          {t('triage.from', { source: t(`triage.sources.${source}`) })} · {relDate(issue.created_at, locale)}
        </span>
      </div>
      <TriageActions issue={issue} statuses={statuses} onResolved={onResolved} />
    </li>
  );
}

/** Aviso en el detalle de un issue que sigue en triage, con las mismas acciones. */
export function TriageBanner({
  issue,
  statuses,
  onResolved,
}: {
  issue: Pick<TrackIssueWithStatus, 'id'>;
  statuses: TrackStatusRow[];
  onResolved: () => void;
}) {
  const t = useTranslations('track');
  return (
    <div className="track-triage-item track-triage-banner" role="status" data-testid="track-triage-banner">
      <div className="track-triage-main">
        <span>{t('triage.banner')}</span>
      </div>
      <TriageActions issue={issue} statuses={statuses} onResolved={onResolved} />
    </div>
  );
}

/** Cola de triage del proyecto. */
export default function TriagePanel(props: TriagePanelProps) {
  const t = useTranslations('track');
  if (props.issues.length === 0) {
    return <EmptyState quiet title={t('triage.empty')} body={t('triage.emptyBody')} />;
  }
  return (
    <ul className="track-triage-list" data-testid="track-triage-list">
      {props.issues.map((issue) => (
        <TriageRow key={issue.id} issue={issue} {...props} />
      ))}
    </ul>
  );
}
