'use client';

import { useState } from 'react';
import type { DragEvent } from 'react';
import { Link } from '@/i18n/navigation';
import { formatDate } from '@/lib/utils';
import type { ProjectMember, TrackIssueWithStatus } from '@/lib/track-data';
import type { TrackStatusRow } from '@/lib/db';
import type { IssuePatch } from '@/lib/track-tasks';
import StatusBadge from './StatusBadge';
import {
  AssigneeMenu,
  DoneCheckbox,
  DueDateMenu,
  PriorityIcon,
  PriorityMenu,
  QuickAdd,
  StatusDot,
  StatusMenu,
} from './InlineEditors';
import { isPendingIssue } from './useIssueStore';
import type { TrackUiLabels } from './ui-labels';

interface IssuesBoardProps {
  issues: TrackIssueWithStatus[];
  statuses: TrackStatusRow[];
  locale: string;
  onStatusChange?: (issueId: string, statusId: string) => void;
  labels: {
    noAssignee: string;
    empty: string;
  };
  /** Edición inline en las cards (checkbox, prioridad, asignado, fecha). */
  editing?: {
    members: ProjectMember[];
    onUpdate: (issueId: string, patch: IssuePatch) => void;
    onToggleDone: (issue: TrackIssueWithStatus) => void;
    ui: TrackUiLabels;
    today: string;
  };
  /** "+ New task" al pie de cada columna, con ese status preseteado. */
  onQuickCreate?: (title: string, statusId: string) => void;
}

const DRAG_TYPE = 'application/x-track-issue';

export default function IssuesBoard({
  issues,
  statuses,
  locale,
  onStatusChange,
  labels,
  editing,
  onQuickCreate,
}: IssuesBoardProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStatusId, setOverStatusId] = useState<string | null>(null);

  const byStatus = statuses.map((status) => ({
    status,
    issues: issues.filter((i) => i.status_id === status.id),
  }));

  const canDrag = Boolean(onStatusChange);

  const onColumnDragOver = (e: DragEvent<HTMLDivElement>, statusId: string) => {
    if (!dragId && !e.dataTransfer.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (overStatusId !== statusId) setOverStatusId(statusId);
  };

  const onColumnDragLeave = (e: DragEvent<HTMLDivElement>, statusId: string) => {
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.contains(next)) return;
    if (overStatusId === statusId) setOverStatusId(null);
  };

  const onColumnDrop = (e: DragEvent<HTMLDivElement>, statusId: string) => {
    e.preventDefault();
    const id = dragId ?? e.dataTransfer.getData(DRAG_TYPE);
    setDragId(null);
    setOverStatusId(null);
    if (!id || !onStatusChange) return;
    const issue = issues.find((i) => i.id === id);
    if (issue && issue.status_id !== statusId) onStatusChange(id, statusId);
  };

  return (
    <div className={`track-board${dragId ? ' is-dragging' : ''}`}>
      {byStatus.map(({ status, issues: colIssues }) => {
        const isOver = overStatusId === status.id;
        const isSource = dragId !== null && colIssues.some((i) => i.id === dragId);
        return (
          <div
            key={status.id}
            className={`track-board-column${isOver && !isSource ? ' is-drop-target' : ''}`}
            onDragOver={canDrag ? (e) => onColumnDragOver(e, status.id) : undefined}
            onDragLeave={canDrag ? (e) => onColumnDragLeave(e, status.id) : undefined}
            onDrop={canDrag ? (e) => onColumnDrop(e, status.id) : undefined}
            aria-label={status.name}
          >
            <div className="track-board-header">
              {editing ? (
                <span className="track-board-title">
                  <StatusDot color={status.color} category={status.category} />
                  {status.name}
                </span>
              ) : (
                <StatusBadge name={status.name} color={status.color} />
              )}
              <span className="track-board-count">{colIssues.length}</span>
            </div>
            <div className="track-board-cards">
              {colIssues.length === 0 && !onQuickCreate && <p className="track-board-empty">{labels.empty}</p>}
              {colIssues.map((issue) => {
                const pending = isPendingIssue(issue);
                const draggable = canDrag && !pending;
                const completed = issue.status_category === 'done' || issue.status_category === 'cancelled';
                return (
                  <div
                    key={issue.id}
                    className={[
                      'track-board-card',
                      dragId === issue.id ? 'is-dragging' : '',
                      pending ? 'is-pending' : '',
                      editing && completed ? 'is-completed' : '',
                      draggable ? 'is-draggable' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    draggable={draggable}
                    title={draggable && editing ? editing.ui.inline.dragHint : undefined}
                    onDragStart={
                      draggable
                        ? (e) => {
                            e.dataTransfer.setData(DRAG_TYPE, issue.id);
                            e.dataTransfer.setData('text/plain', issue.identifier);
                            e.dataTransfer.effectAllowed = 'move';
                            setDragId(issue.id);
                          }
                        : undefined
                    }
                    onDragEnd={() => {
                      setDragId(null);
                      setOverStatusId(null);
                    }}
                  >
                    {editing ? (
                      <>
                        <div className="track-board-card-head">
                          <span className="track-board-card-id">
                            <DoneCheckbox
                              category={issue.status_category}
                              disabled={pending}
                              onToggle={() => editing.onToggleDone(issue)}
                              labels={editing.ui.inline}
                            />
                            <span className="track-identifier">{issue.identifier}</span>
                          </span>
                          <span className="track-board-card-tools">
                            <StatusMenu
                              compact
                              statusId={issue.status_id}
                              statusName={issue.status_name}
                              statusColor={issue.status_color}
                              statusCategory={issue.status_category}
                              statuses={statuses}
                              disabled={pending}
                              label={editing.ui.inline.status}
                              onChange={(statusId) => editing.onUpdate(issue.id, { statusId })}
                            />
                            <PriorityMenu
                              compact
                              priority={issue.priority}
                              priorities={editing.ui.priorities}
                              disabled={pending}
                              label={editing.ui.inline.priority}
                              onChange={(priority) => editing.onUpdate(issue.id, { priority })}
                            />
                          </span>
                        </div>
                        {pending ? (
                          <p className="track-board-card-title">{issue.title || '—'}</p>
                        ) : (
                          <Link href={`/app/track/issues/${issue.id}`} className="track-board-card-title" draggable={false}>
                            {issue.title || '—'}
                          </Link>
                        )}
                        <div className="track-board-card-meta">
                          <AssigneeMenu
                            compact
                            assigneeId={issue.assignee_id}
                            assigneeName={issue.assignee_name}
                            assigneeEmail={issue.assignee_email}
                            members={editing.members}
                            disabled={pending}
                            label={editing.ui.inline.assignee}
                            noAssignee={labels.noAssignee}
                            onChange={(assigneeId) => editing.onUpdate(issue.id, { assigneeId })}
                          />
                          <DueDateMenu
                            dueDate={issue.due_date}
                            locale={locale}
                            today={editing.today}
                            disabled={pending}
                            labels={editing.ui.inline}
                            onChange={(dueDate) => editing.onUpdate(issue.id, { dueDate })}
                          />
                          {issue.child_count > 0 && <span className="track-subtask-indicator">⊞ {issue.child_count}</span>}
                          {issue.cycle_name && <span className="track-board-cycle">{issue.cycle_name}</span>}
                        </div>
                      </>
                    ) : (
                      <>
                        <Link href={`/app/track/issues/${issue.id}`} className="track-board-card-link" draggable={false}>
                          <div className="track-board-card-head">
                            <span className="track-identifier">{issue.identifier}</span>
                            <PriorityIcon priority={issue.priority} />
                          </div>
                          <p className="track-board-card-title">{issue.title || '—'}</p>
                          <div className="track-board-card-meta">
                            <span>{issue.assignee_name ?? labels.noAssignee}</span>
                            {issue.child_count > 0 && (
                              <span className="track-subtask-indicator">⊞ {issue.child_count}</span>
                            )}
                            {issue.cycle_name && <span className="track-board-cycle">{issue.cycle_name}</span>}
                            {issue.due_date && (
                              <span className="track-board-due">{formatDate(issue.due_date, locale)}</span>
                            )}
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
                      </>
                    )}
                  </div>
                );
              })}
              {onQuickCreate && editing && (
                <QuickAdd
                  variant="card"
                  labels={editing.ui.quick}
                  onCreate={(title) => onQuickCreate(title, status.id)}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
