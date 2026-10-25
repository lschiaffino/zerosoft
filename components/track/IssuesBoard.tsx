'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { DragEvent } from 'react';
import { Link } from '@/i18n/navigation';
import { formatDate } from '@/lib/utils';
import type { ProjectMember, TrackIssueWithStatus } from '@/lib/track-data';
import type { TrackStatusRow } from '@/lib/db';
import type { IssuePatch } from '@/lib/track-tasks';
import { groupIssues, groupPreset, type BoardGroupBy } from '@/lib/track-views';
import type { IssueDraft } from './useIssueStore';
import StatusBadge from './StatusBadge';
import TrackIcon from './TrackIcon';
import { openCommandMenu } from '@/lib/cmdk-context';
import { AssigneeMenu, DueDateMenu, PriorityIcon, PriorityMenu, QuickAdd, StatusDot, StatusToggle } from './InlineEditors';
import { isPendingIssue } from './useIssueStore';
import { safeHexColor } from '@/lib/track-color';
import { DEFAULT_DISPLAY_PROPS, type DisplayProp } from './IssueDisplayOptions';
import type { TrackUiLabels } from './ui-labels';

interface IssuesBoardProps {
  issues: TrackIssueWithStatus[];
  statuses: TrackStatusRow[];
  locale: string;
  /** Mover una card a otra columna (o cambiar su status desde el select). */
  onMove?: (issueId: string, patch: IssuePatch) => void;
  /** Campo que define las columnas (por defecto status). */
  groupBy?: BoardGroupBy;
  /** Nombres de proyecto por id (agrupar por proyecto). */
  projectNames?: Record<string, string>;
  labels: {
    noAssignee: string;
    empty: string;
    /** Columnas "sin valor" al agrupar por cycle / label. */
    noCycle?: string;
    noLabel?: string;
  };
  /** Edición inline en las cards (checkbox, prioridad, asignado, fecha). */
  editing?: {
    members: ProjectMember[];
    onUpdate: (issueId: string, patch: IssuePatch) => void;
    onToggleDone: (issue: TrackIssueWithStatus) => void;
    ui: TrackUiLabels;
    today: string;
  };
  /** "+ New task" al pie de cada columna, con el valor de la columna preseteado. */
  onQuickCreate?: (title: string, preset: Partial<IssueDraft>) => void;
  /** Propiedades visibles de Display: las cards muestran solo esas (y ocultan las vacías). */
  show?: readonly DisplayProp[];
}

function cardLabels(raw: string): Array<{ id: string; name: string; color: string }> {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((l) => l && typeof l.id === 'string') : [];
  } catch {
    return [];
  }
}

const DRAG_TYPE = 'application/x-track-issue';

export default function IssuesBoard({
  issues,
  statuses,
  locale,
  onMove,
  groupBy = 'status',
  projectNames,
  labels,
  editing,
  onQuickCreate,
  show: showProps = DEFAULT_DISPLAY_PROPS,
}: IssuesBoardProps) {
  const t = useTranslations('track');
  const show = new Set<DisplayProp>(showProps);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStatusId, setOverStatusId] = useState<string | null>(null);

  // Status y prioridad muestran todas sus columnas aunque estén vacías; el
  // resto, solo los valores que tienen issues (más "sin valor" al final).
  const columns = groupIssues(issues, groupBy, {
    statuses,
    projectNames,
    includeEmpty: groupBy === 'status' || groupBy === 'priority',
  }).filter((g) => groupBy !== 'status' || g.key !== '' || g.issues.length > 0);

  /** Patch que aplica soltar en una columna (o null si ese agrupado no se puede mover). */
  const dropPatch = (key: string): IssuePatch | null => groupPreset(groupBy, key, { movable: true });
  const presetFor = (key: string): Partial<IssueDraft> | null => groupPreset(groupBy, key);
  const sameColumn = (issue: TrackIssueWithStatus, key: string) =>
    groupBy === 'status'
      ? issue.status_id === key
      : groupBy === 'priority'
        ? issue.priority === key
        : (issue.assignee_id ?? '') === key;

  const canDrag = Boolean(onMove) && (groupBy === 'status' || groupBy === 'priority' || groupBy === 'assignee');
  const priorityName = (key: string) => editing?.ui.priorities.find((p) => p.value === key)?.label ?? key;
  const columnName = (key: string, name: string) => {
    if (groupBy === 'priority') return priorityName(key);
    if (key) return name;
    if (groupBy === 'assignee') return labels.noAssignee;
    if (groupBy === 'cycle') return labels.noCycle ?? '';
    if (groupBy === 'label') return labels.noLabel ?? '';
    return name;
  };

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
    if (!id || !onMove) return;
    const issue = issues.find((i) => i.id === id);
    const patch = dropPatch(statusId);
    if (issue && patch && !sameColumn(issue, statusId)) onMove(id, patch);
  };

  return (
    <div className={`track-board${dragId ? ' is-dragging' : ''}`}>
      {columns.map((column) => {
        const colIssues = column.issues;
        const colKey = column.key;
        const title = columnName(colKey, column.name);
        const isOver = overStatusId === colKey;
        const isSource = dragId !== null && colIssues.some((i) => i.id === dragId);
        const preset = presetFor(colKey);
        return (
          <div
            key={colKey || 'none'}
            className={`track-board-column${isOver && !isSource ? ' is-drop-target' : ''}`}
            onDragOver={canDrag ? (e) => onColumnDragOver(e, colKey) : undefined}
            onDragLeave={canDrag ? (e) => onColumnDragLeave(e, colKey) : undefined}
            onDrop={canDrag ? (e) => onColumnDrop(e, colKey) : undefined}
            aria-label={title}
          >
            <div className="track-board-header">
              {groupBy === 'status' && !editing ? (
                <StatusBadge name={title} color={column.color ?? null} category={column.category ?? null} />
              ) : (
                <span className="track-board-title">
                  {groupBy === 'status' && (
                    <StatusDot color={column.color ?? null} category={column.category ?? null} />
                  )}
                  {groupBy === 'priority' && <PriorityIcon priority={colKey as TrackIssueWithStatus['priority']} />}
                  {groupBy === 'label' && column.color && (
                    <span className="track-label-tag-dot" style={{ background: column.color }} aria-hidden />
                  )}
                  {title}
                </span>
              )}
              <span className="track-board-count">{colIssues.length}</span>
            </div>
            <div className="track-board-cards">
              {colIssues.length === 0 && !(onQuickCreate && preset) && <p className="track-board-empty">{labels.empty}</p>}
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
                    data-issue-key={pending ? undefined : issue.id}
                    data-issue-row={pending ? undefined : ''}
                    data-href={pending ? undefined : `/app/track/issues/${issue.id}`}
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
                            {show.has('status') && (
                              <StatusToggle
                                color={issue.status_color}
                                category={issue.status_category}
                                disabled={pending}
                                onToggle={() => editing.onToggleDone(issue)}
                                labels={editing.ui.inline}
                              />
                            )}
                            {show.has('id') && <span className="track-identifier">{issue.identifier}</span>}
                          </span>
                          {show.has('priority') && issue.priority !== 'none' && (
                            <span className="track-board-card-tools">
                              <PriorityMenu
                                compact
                                priority={issue.priority}
                                priorities={editing.ui.priorities}
                                disabled={pending}
                                label={editing.ui.inline.priority}
                                onChange={(priority) => editing.onUpdate(issue.id, { priority })}
                              />
                            </span>
                          )}
                        </div>
                        {issue.parent_identifier && (
                          <p className="track-board-card-parent" title={issue.parent_title ?? undefined}>
                            <TrackIcon name="parent" size={11} />
                            <span className="track-identifier">{issue.parent_identifier}</span>
                            <span className="track-board-card-parent-title">{issue.parent_title}</span>
                          </p>
                        )}
                        {pending ? (
                          <p className="track-board-card-title">{issue.title || t('issues.untitled')}</p>
                        ) : (
                          <Link href={`/app/track/issues/${issue.id}`} className="track-board-card-title" draggable={false}>
                            {issue.title || t('issues.untitled')}
                          </Link>
                        )}
                        {show.has('labels') && cardLabels(issue.labels).length > 0 && (
                          <div className="track-board-card-labels">
                            {cardLabels(issue.labels).map((l) => (
                              <span key={l.id} className="track-label-tag">
                                <span className="track-label-tag-dot" style={{ background: safeHexColor(l.color, '#767676') }} aria-hidden />
                                {l.name}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="track-board-card-meta">
                          {show.has('assignee') && (
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
                          )}
                          {show.has('due') && issue.due_date && (
                            <DueDateMenu
                              dueDate={issue.due_date}
                              locale={locale}
                              today={editing.today}
                              disabled={pending}
                              labels={editing.ui.inline}
                              onChange={(dueDate) => editing.onUpdate(issue.id, { dueDate })}
                            />
                          )}
                          {issue.child_count > 0 && (
                            <span className="track-subtask-indicator">
                              <TrackIcon name="subtasks" size={12} />
                              {issue.child_done ?? 0}/{issue.child_count}
                            </span>
                          )}
                          {show.has('cycle') && issue.cycle_name && <span className="track-board-cycle">{issue.cycle_name}</span>}
                          {show.has('project') && issue.plan_name && (
                            <span className="track-board-cycle">
                              <TrackIcon name="plans" size={11} /> {issue.plan_name}
                            </span>
                          )}
                        </div>
                      </>
                    ) : (
                      <>
                        <Link href={`/app/track/issues/${issue.id}`} className="track-board-card-link" draggable={false}>
                          <div className="track-board-card-head">
                            <span className="track-identifier">{issue.identifier}</span>
                            <PriorityIcon priority={issue.priority} />
                          </div>
                          <p className="track-board-card-title">{issue.title || t('issues.untitled')}</p>
                          <div className="track-board-card-meta">
                            <span>{issue.assignee_name ?? labels.noAssignee}</span>
                            {issue.child_count > 0 && (
                              <span className="track-subtask-indicator">
                                <TrackIcon name="subtasks" size={12} />
                                {issue.child_count}
                              </span>
                            )}
                            {issue.cycle_name && <span className="track-board-cycle">{issue.cycle_name}</span>}
                            {issue.due_date && (
                              <span className="track-board-due">{formatDate(issue.due_date, locale)}</span>
                            )}
                          </div>
                        </Link>
                        {onMove && (
                          <div className="track-board-card-actions">
                            {/* Mover sin arrastrar: el mismo menú de estado que S (filtro, flechas, 1–9). */}
                            <button
                              type="button"
                              className="track-board-status-btn"
                              aria-label={`${t('issues.changeStatus')}: ${issue.status_name ?? ''}`}
                              title={`${t('issues.changeStatus')} · S`}
                              onClick={(e) => openCommandMenu('status', { anchor: e.currentTarget, targetId: issue.id })}
                            >
                              <StatusDot color={issue.status_color} category={issue.status_category} />
                              <span>{issue.status_name}</span>
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
              {onQuickCreate && editing && preset && (
                <QuickAdd
                  variant="card"
                  labels={editing.ui.quick}
                  onCreate={(title) => onQuickCreate(title, preset)}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
