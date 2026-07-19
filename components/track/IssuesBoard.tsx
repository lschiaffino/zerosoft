'use client';

import { Link } from '@/i18n/navigation';
import { formatDate } from '@/lib/utils';
import type { TrackIssueWithStatus } from '@/lib/track-data';
import type { TrackStatusRow } from '@/lib/db';
import StatusBadge from './StatusBadge';

interface IssuesBoardProps {
  issues: TrackIssueWithStatus[];
  statuses: TrackStatusRow[];
  locale: string;
  onStatusChange?: (issueId: string, statusId: string) => void;
  labels: {
    noAssignee: string;
    empty: string;
  };
}

function PriorityDot({ priority }: { priority: string }) {
  const color =
    priority === 'urgent' ? '#000000' : priority === 'high' ? '#444444' : priority === 'medium' ? '#888888' : '#bbbbbb';
  return <span className="track-priority-dot" style={{ background: color }} aria-hidden />;
}

function Avatar({ name }: { name: string | null }) {
  const initial = name?.[0]?.toUpperCase() ?? '?';
  return <span className="track-avatar">{initial}</span>;
}

export default function IssuesBoard({ issues, statuses, locale, onStatusChange, labels }: IssuesBoardProps) {
  const byStatus = statuses.map((status) => ({
    status,
    issues: issues.filter((i) => i.status_id === status.id),
  }));

  return (
    <div className="track-board">
      {byStatus.map(({ status, issues: colIssues }) => (
        <div key={status.id} className="track-board-column">
          <div className="track-board-header">
            <StatusBadge name={status.name} color={status.color} />
            <span className="track-board-count">{colIssues.length}</span>
          </div>
          <div className="track-board-cards">
            {colIssues.length === 0 && <p className="track-board-empty">{labels.empty}</p>}
            {colIssues.map((issue) => (
              <div key={issue.id} className="track-board-card">
                <Link href={`/${locale}/app/track/issues/${issue.id}`} className="track-board-card-link">
                  <div className="track-board-card-head">
                    <span className="track-identifier">{issue.identifier}</span>
                    <PriorityDot priority={issue.priority} />
                  </div>
                  <p className="track-board-card-title">{issue.title || '—'}</p>
                  <div className="track-board-card-meta">
                    <span>{issue.assignee_name ?? labels.noAssignee}</span>
                    {issue.child_count > 0 && (
                      <span className="track-subtask-indicator" title="Has subtasks">
                        ⊞ {issue.child_count}
                      </span>
                    )}
                    {issue.cycle_name && <span className="track-board-cycle">{issue.cycle_name}</span>}
                    {issue.due_date && <span className="track-board-due">{formatDate(issue.due_date, locale)}</span>}
                  </div>
                </Link>
                {onStatusChange && (
                  <div className="track-board-card-actions">
                    <select
                      aria-label="Change status"
                      value={issue.status_id ?? ''}
                      onChange={(e) => onStatusChange(issue.id, e.target.value)}
                    >
                      {statuses.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
