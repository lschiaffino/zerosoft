'use client';

import { useCallback, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { formatDate, relDate } from '@/lib/utils';
import StatusBadge from './StatusBadge';
import IssuePropertiesPanel from './IssuePropertiesPanel';
import IssueActivityTimeline from './IssueActivityTimeline';
import QuickIssueModal from './QuickIssueModal';
import { CopyBranchButton, IssueGithubPanel } from './IssueGithub';
import { useToday } from './InlineEditors';
import type { IssueDraft } from './useIssueStore';
import type { TrackUiLabels } from './ui-labels';
import type { TrackCycleRow, TrackStatusRow } from '@/lib/db';
import type {
  IssueParentSummary,
  ProjectMember,
  TrackIssueAttachmentWithAuthor,
  TrackIssueActivityWithAuthor,
  TrackIssueRelationWithTarget,
  TrackIssueWithStatus,
} from '@/lib/track-data';

interface DetailLabels {
  back: string;
  properties: {
    status: string;
    priority: string;
    assignee: string;
    cycle: string;
    estimate: string;
    dueDate: string;
    labels: string;
    noAssignee: string;
    none: string;
  };
  priorities: Array<{ value: string; label: string }>;
  subtasks: {
    title: string;
    add: string;
    empty: string;
    hasSubtasks: string;
  };
  attachments: {
    title: string;
    upload: string;
    drop: string;
    empty: string;
    delete: string;
    size: string;
  };
  activity: {
    title: string;
    created: string;
    statusChange: string;
    assigneeChange: string;
    priorityChange: string;
    cycleChange: string;
    dueDateChange: string;
    estimateChange: string;
    titleChange: string;
    descriptionChange: string;
    relationAdded: string;
    relationRemoved: string;
    attachmentAdded: string;
    subtaskAdded: string;
    closed: string;
    reopened: string;
    commented: string;
    from: string;
    to: string;
    unassigned: string;
    addComment: string;
    submitComment: string;
    empty: string;
  };
  relations: {
    title: string;
    outgoing: string;
    incoming: string;
    blocks: string;
    blockedBy: string;
    related: string;
    duplicates: string;
    duplicatedBy: string;
    add: string;
    remove: string;
    empty: string;
    selectIssue: string;
    selectType: string;
  };
  actions: {
    close: string;
    reopen: string;
  };
  description: string;
}

interface IssueDetailClientProps {
  locale: string;
  userId: string;
  initialIssue: TrackIssueWithStatus;
  initialProjectName: string;
  initialStatuses: TrackStatusRow[];
  initialCycles: TrackCycleRow[];
  initialMembers: ProjectMember[];
  initialChildren: TrackIssueWithStatus[];
  initialParentChain: IssueParentSummary[];
  initialAttachments: TrackIssueAttachmentWithAuthor[];
  initialActivities: TrackIssueActivityWithAuthor[];
  initialRelations: TrackIssueRelationWithTarget[];
  labels: DetailLabels;
  /** Labels del quick-create (modal de sub-issue). */
  ui: TrackUiLabels;
}

function parseLabels(raw: string): Array<{ id: string; name: string; color: string }> {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseDescription(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((b: { text?: string }) => b.text ?? '').join('\n');
    return raw;
  } catch {
    return raw;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function PriorityDot({ priority }: { priority: string }) {
  const color =
    priority === 'urgent' ? 'var(--bad)' : priority === 'high' ? 'var(--c-track)' : priority === 'medium' ? 'var(--warn)' : '#bbbbbb';
  return <span className="track-priority-dot" style={{ background: color }} aria-hidden />;
}

const RELATION_TYPES = ['blocks', 'related', 'duplicates'] as const;

export default function IssueDetailClient({
  locale,
  userId,
  initialIssue,
  initialProjectName,
  initialStatuses,
  initialCycles,
  initialMembers,
  initialChildren,
  initialParentChain,
  initialAttachments,
  initialActivities,
  initialRelations,
  labels,
  ui,
}: IssueDetailClientProps) {
  const today = useToday();
  const [issue, setIssue] = useState(initialIssue);
  const [children, setChildren] = useState(initialChildren);
  const [attachments, setAttachments] = useState(initialAttachments);
  const [activities, setActivities] = useState(initialActivities);
  const [relations, setRelations] = useState(initialRelations);
  const [uploading, setUploading] = useState(false);
  const [showRelationForm, setShowRelationForm] = useState(false);
  const [relationInput, setRelationInput] = useState('');
  const [relationType, setRelationType] = useState<(typeof RELATION_TYPES)[number]>('related');
  const [subOpen, setSubOpen] = useState(false);
  const [subError, setSubError] = useState<string | null>(null);

  const refreshIssue = useCallback(async () => {
    const res = await fetch(`/api/track/issues/${issue.id}`);
    if (res.ok) setIssue((await res.json()) as TrackIssueWithStatus);
  }, [issue.id]);

  const refreshChildren = useCallback(async () => {
    const res = await fetch(`/api/track/issues/${issue.id}/children`);
    if (res.ok) setChildren(((await res.json()) as { rows: TrackIssueWithStatus[] }).rows);
  }, [issue.id]);

  const refreshAttachments = useCallback(async () => {
    const res = await fetch(`/api/track/issues/${issue.id}/attachments`);
    if (res.ok) setAttachments(((await res.json()) as { rows: TrackIssueAttachmentWithAuthor[] }).rows);
  }, [issue.id]);

  const refreshActivities = useCallback(async () => {
    const res = await fetch(`/api/track/issues/${issue.id}/activities`);
    if (res.ok) setActivities(((await res.json()) as { rows: TrackIssueActivityWithAuthor[] }).rows);
  }, [issue.id]);

  const refreshRelations = useCallback(async () => {
    const res = await fetch(`/api/track/issues/${issue.id}/relations`);
    if (res.ok) setRelations(((await res.json()) as { rows: TrackIssueRelationWithTarget[] }).rows);
  }, [issue.id]);

  const handleIssueChange = useCallback(async () => {
    await Promise.all([refreshIssue(), refreshActivities()]);
  }, [refreshIssue, refreshActivities]);

  const doneStatus = initialStatuses.find((s) => s.category === 'done' || s.category === 'cancelled');
  const openStatus = initialStatuses.find((s) => s.category !== 'done' && s.category !== 'cancelled');
  const isClosed = issue.status_category === 'done' || issue.status_category === 'cancelled';

  async function handleCreateSubIssue(projectId: string, draft: IssueDraft) {
    setSubError(null);
    const res = await fetch(`/api/track/projects/${projectId}/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: draft.title,
        description: draft.description?.trim() ? [{ type: 'text', text: draft.description.trim() }] : [],
        statusId: draft.statusId || undefined,
        priority: draft.priority,
        assigneeId: draft.assigneeId || undefined,
        dueDate: draft.dueDate || undefined,
        parentId: issue.id,
      }),
    }).catch(() => null);
    if (!res?.ok) {
      setSubError(ui.inline.createError);
      return;
    }
    await Promise.all([refreshChildren(), refreshActivities()]);
  }

  async function handleCloseReopen() {
    const targetId = isClosed ? openStatus?.id : doneStatus?.id;
    if (!targetId) return;
    const res = await fetch(`/api/track/issues/${issue.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ statusId: targetId }),
    });
    if (res.ok) {
      await handleIssueChange();
      await refreshChildren();
    }
  }

  async function handleUpload(file: File) {
    if (file.size > 10 * 1024 * 1024) return;
    setUploading(true);
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch(`/api/track/issues/${issue.id}/attachments`, { method: 'POST', body: form });
      if (res.ok) {
        await Promise.all([refreshAttachments(), refreshActivities()]);
      }
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteAttachment(fileId: string) {
    const res = await fetch(`/api/track/issues/${issue.id}/attachments?fileId=${fileId}`, { method: 'DELETE' });
    if (res.ok) await refreshAttachments();
  }

  async function handleAddRelation(e: React.FormEvent) {
    e.preventDefault();
    if (!relationInput.trim()) return;
    const res = await fetch(`/api/track/issues/${issue.id}/relations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relatedIssueId: relationInput.trim(), type: relationType }),
    });
    if (res.ok) {
      setRelationInput('');
      setShowRelationForm(false);
      await Promise.all([refreshRelations(), refreshActivities()]);
    }
  }

  async function handleDeleteRelation(relationId: string) {
    const res = await fetch(`/api/track/issues/${issue.id}/relations?relationId=${relationId}`, { method: 'DELETE' });
    if (res.ok) {
      await Promise.all([refreshRelations(), refreshActivities()]);
    }
  }

  const issueLabels = parseLabels(issue.labels);
  const descriptionText = parseDescription(issue.description);

  const outgoing = relations.filter((r) => r.direction === 'outgoing');
  const incoming = relations.filter((r) => r.direction === 'incoming');

  function relationLabel(type: string, direction: 'outgoing' | 'incoming') {
    if (type === 'blocks') return direction === 'outgoing' ? labels.relations.blocks : labels.relations.blockedBy;
    if (type === 'duplicates') return direction === 'outgoing' ? labels.relations.duplicates : labels.relations.duplicatedBy;
    return labels.relations.related;
  }

  return (
    <div className="app-page track-detail" data-track-project-id={issue.project_id}>
      <div className="track-detail-head">
        <div className="track-detail-meta">
          <Link href={`/app/track/projects/${issue.project_id}`}>{labels.back}</Link>
        </div>
        <nav className="track-breadcrumb">
          <Link href={`/app/track/projects/${issue.project_id}`}>{initialProjectName}</Link>
          {initialParentChain.map((p) => (
            <span key={p.id}>
              <span className="track-breadcrumb-sep">/</span>
              <Link href={`/app/track/issues/${p.id}`} title={p.title}>
                {p.identifier}
              </Link>
            </span>
          ))}
          <span className="track-breadcrumb-sep">/</span>
          <span className="track-breadcrumb-current">{issue.identifier}</span>
        </nav>
        <h1>
          <span className="track-identifier">{issue.identifier}</span>{' '}
          {issue.title || labels.description}
        </h1>
        <div className="track-detail-meta">
          <StatusBadge name={issue.status_name} color={issue.status_color} />
          <span>{labels.priorities.find((p) => p.value === issue.priority)?.label ?? issue.priority}</span>
          <span>{formatDate(issue.created_at, locale)}</span>
          {issueLabels.length > 0 && (
            <span className="track-label-chips">
              {issueLabels.map((l) => (
                <span key={l.id} className="track-label-tag">
                  <span className="track-label-tag-dot" style={{ background: l.color }} aria-hidden />
                  {l.name}
                </span>
              ))}
            </span>
          )}
        </div>
        <div className="track-detail-actions">
          <CopyBranchButton issueId={issue.id} />
          {(doneStatus || openStatus) && (
            <button type="button" className="btn btn-outline" onClick={handleCloseReopen}>
              {isClosed ? labels.actions.reopen : labels.actions.close}
            </button>
          )}
        </div>
      </div>

      <div className="track-detail-grid">
        <div className="track-detail-main">
          {descriptionText ? (
            <section className="panel">
              <p className="section-label">{labels.description}</p>
              <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.6 }}>{descriptionText}</div>
            </section>
          ) : null}

          <section className="panel">
            <div className="track-section-header">
              <p className="section-label">{labels.subtasks.title}</p>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => setSubOpen(true)}
                data-testid="track-add-subissue"
              >
                {labels.subtasks.add}
              </button>
            </div>
            {subError && (
              <p className="form-error" role="alert">
                {subError}
              </p>
            )}
            {children.length === 0 ? (
              <p className="muted">{labels.subtasks.empty}</p>
            ) : (
              <ul className="track-subtask-list">
                {children.map((child) => (
                  <li key={child.id} className="track-subtask">
                    <Link href={`/app/track/issues/${child.id}`}>
                      <span className="track-identifier">{child.identifier}</span>
                      <span className="track-subtask-title">{child.title || '—'}</span>
                    </Link>
                    <div className="track-subtask-meta">
                      <StatusBadge name={child.status_name} color={child.status_color} />
                      <span className="track-priority">
                        <PriorityDot priority={child.priority} />
                        {child.priority}
                      </span>
                      <span>{child.assignee_name ?? child.assignee_email ?? labels.properties.noAssignee}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <IssueGithubPanel issueId={issue.id} />

          <section className="panel">
            <p className="section-label">{labels.attachments.title}</p>
            <label className="track-attachment-upload">
              <input
                type="file"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUpload(file);
                  e.currentTarget.value = '';
                }}
                disabled={uploading}
              />
              <span className="btn btn-small">{uploading ? '…' : labels.attachments.upload}</span>
            </label>
            {attachments.length === 0 ? (
              <p className="muted">{labels.attachments.empty}</p>
            ) : (
              <ul className="track-attachment-list">
                {attachments.map((a) => (
                  <li key={a.id} className="track-attachment">
                    <a href={a.url} target="_blank" rel="noreferrer" className="track-attachment-name">
                      {a.filename}
                    </a>
                    <span className="track-attachment-meta">
                      {formatBytes(a.size)} · {a.user_name ?? a.user_email} · {relDate(a.created_at, locale)}
                    </span>
                    {a.user_id === userId && (
                      <button
                        type="button"
                        className="track-attachment-delete"
                        onClick={() => handleDeleteAttachment(a.id)}
                      >
                        {labels.attachments.delete}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <p className="section-label">{labels.relations.title}</p>
            {relations.length === 0 && !showRelationForm && <p className="muted">{labels.relations.empty}</p>}

            {outgoing.length > 0 && (
              <div className="track-relation-group">
                <p className="track-relation-heading">{labels.relations.outgoing}</p>
                <ul className="track-relation-list">
                  {outgoing.map((r) => (
                    <li key={r.id} className="track-relation">
                      <span className="track-relation-type">{relationLabel(r.type, 'outgoing')}</span>
                      <Link href={`/app/track/issues/${r.related_issue_id}`}>
                        <span className="track-identifier">{r.identifier}</span>{' '}
                        {r.title}
                      </Link>
                      <button
                        type="button"
                        className="track-relation-delete"
                        onClick={() => handleDeleteRelation(r.id)}
                      >
                        {labels.relations.remove}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {incoming.length > 0 && (
              <div className="track-relation-group">
                <p className="track-relation-heading">{labels.relations.incoming}</p>
                <ul className="track-relation-list">
                  {incoming.map((r) => (
                    <li key={r.id} className="track-relation">
                      <span className="track-relation-type">{relationLabel(r.type, 'incoming')}</span>
                      <Link href={`/app/track/issues/${r.issue_id}`}>
                        <span className="track-identifier">{r.identifier}</span>{' '}
                        {r.title}
                      </Link>
                      <button
                        type="button"
                        className="track-relation-delete"
                        onClick={() => handleDeleteRelation(r.id)}
                      >
                        {labels.relations.remove}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {showRelationForm ? (
              <form className="track-relation-form" onSubmit={handleAddRelation}>
                <input
                  type="text"
                  value={relationInput}
                  onChange={(e) => setRelationInput(e.target.value)}
                  placeholder={labels.relations.selectIssue}
                />
                <select value={relationType} onChange={(e) => setRelationType(e.target.value as (typeof RELATION_TYPES)[number])}>
                  {RELATION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {labels.relations.selectType} {t}
                    </option>
                  ))}
                </select>
                <button type="submit" className="btn btn-small btn-solid">
                  {labels.relations.add}
                </button>
                <button type="button" className="btn btn-small" onClick={() => setShowRelationForm(false)}>
                  Cancel
                </button>
              </form>
            ) : (
              <button type="button" className="btn btn-small" onClick={() => setShowRelationForm(true)}>
                {labels.relations.add}
              </button>
            )}
          </section>

          <section className="panel">
            <p className="section-label">{labels.activity.title}</p>
            <IssueActivityTimeline
              issueId={issue.id}
              locale={locale}
              activities={activities}
              members={initialMembers}
              labels={labels.activity}
              onChange={refreshActivities}
            />
          </section>
        </div>

        <aside className="track-detail-side">
          <section className="panel">
            <p className="section-label">{labels.properties.status}</p>
            <IssuePropertiesPanel
              issue={issue}
              statuses={initialStatuses}
              cycles={initialCycles}
              members={initialMembers}
              locale={locale}
              labels={labels.properties}
              priorities={labels.priorities}
              onChange={handleIssueChange}
            />
          </section>
        </aside>
      </div>
      <QuickIssueModal
        open={subOpen}
        onClose={() => setSubOpen(false)}
        projects={[
          { id: issue.project_id, name: initialProjectName, statuses: initialStatuses, members: initialMembers },
        ]}
        defaults={{ projectId: issue.project_id, parentId: issue.id, parentLabel: issue.identifier }}
        onCreate={(projectId, draft) => void handleCreateSubIssue(projectId, draft)}
        labels={ui}
        today={today}
      />
    </div>
  );
}
