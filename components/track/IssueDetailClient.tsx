'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { formatDate, relDate } from '@/lib/utils';
import StatusBadge from './StatusBadge';
import IssuePropertiesPanel from './IssuePropertiesPanel';
import IssueActivityTimeline from './IssueActivityTimeline';
import QuickIssueModal from './QuickIssueModal';
import { IssueGithubPanel, useIssueGithub } from './IssueGithub';
import { Popover, PriorityIcon, TrackToast, useToday } from './InlineEditors';
import { branchNameFor } from '@/lib/track-branch';
import { TriageBanner } from './TriagePanel';
import { findDoneStatus, findOpenStatus } from '@/lib/track-tasks';
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
    title: string;
    estimatePlaceholder: string;
    estimateUnit: string;
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
    tooLarge: string;
    typeNotAllowed: string;
    uploadError: string;
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
    editComment: string;
    deleteComment: string;
    deleteCommentConfirm: string;
    saveComment: string;
    cancelEdit: string;
    edited: string;
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
    notFound: string;
    duplicate: string;
    self: string;
    error: string;
    cancel: string;
  };
  actions: {
    close: string;
    reopen: string;
  };
  description: string;
  untitled: string;
  createdOn: string;
  edit: {
    title: string;
    descriptionPlaceholder: string;
    more: string;
    copyBranch: string;
    copied: string;
    addSubtask: string;
    addAttachment: string;
    addRelation: string;
  };
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

/** Textarea que crece con el contenido (título y descripción editables en línea). */
function useAutosize(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return ref;
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
  const github = useIssueGithub(issue.id);
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
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [relationError, setRelationError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState(initialIssue.title);
  const [descDraft, setDescDraft] = useState(() => parseDescription(initialIssue.description));
  const [editingDesc, setEditingDesc] = useState(false);
  const [copied, setCopied] = useState(false);
  const titleRef = useAutosize(titleDraft);
  const descRef = useAutosize(editingDesc ? descDraft : '');

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

  // Igual que el checkbox de las listas (useIssueStore.toggleDone): cerrar va al
  // primer Done (nunca a Cancelled) y reabrir prefiere Todo.
  const doneStatus = findDoneStatus(initialStatuses);
  const openStatus = findOpenStatus(initialStatuses);
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

  // Título y descripción se editan en línea; un PATCH fallido revierte y avisa.
  async function patchFields(body: Record<string, unknown>): Promise<boolean> {
    const res = await fetch(`/api/track/issues/${issue.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!res?.ok) {
      setSaveError(ui.inline.saveError);
      return false;
    }
    await handleIssueChange();
    return true;
  }

  async function saveTitle() {
    const next = titleDraft.replace(/\s+/g, ' ').trim();
    if (!next) {
      setTitleDraft(issue.title);
      return;
    }
    if (next === issue.title) return;
    setTitleDraft(next);
    if (!(await patchFields({ title: next }))) setTitleDraft(issue.title);
  }

  async function saveDescription() {
    setEditingDesc(false);
    const next = descDraft.trim();
    const current = parseDescription(issue.description).trim();
    if (next === current) return;
    if (!(await patchFields({ description: next ? [{ type: 'text', text: next }] : [] }))) setDescDraft(current);
  }

  const branchName = branchNameFor(issue.identifier, titleDraft || issue.title);

  async function handleUpload(file: File) {
    setAttachmentError(null);
    if (file.size > 10 * 1024 * 1024) {
      setAttachmentError(labels.attachments.tooLarge);
      return;
    }
    setUploading(true);
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch(`/api/track/issues/${issue.id}/attachments`, { method: 'POST', body: form }).catch(
        () => null,
      );
      if (res?.ok) {
        await Promise.all([refreshAttachments(), refreshActivities()]);
      } else if (res?.status === 413) {
        setAttachmentError(labels.attachments.tooLarge);
      } else if (res?.status === 415) {
        setAttachmentError(labels.attachments.typeNotAllowed);
      } else {
        setAttachmentError(labels.attachments.uploadError);
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
    setRelationError(null);
    const res = await fetch(`/api/track/issues/${issue.id}/relations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relatedIssueId: relationInput.trim(), type: relationType }),
    }).catch(() => null);
    if (res?.ok) {
      setRelationInput('');
      setShowRelationForm(false);
      await Promise.all([refreshRelations(), refreshActivities()]);
      return;
    }
    const code = res ? ((await res.json().catch(() => null)) as { error?: string } | null)?.error : undefined;
    setRelationError(
      res?.status === 404
        ? labels.relations.notFound
        : code === 'duplicate_relation'
          ? labels.relations.duplicate
          : code === 'invalid_relation'
            ? labels.relations.self
            : labels.relations.error,
    );
  }

  async function handleDeleteRelation(relationId: string) {
    const res = await fetch(`/api/track/issues/${issue.id}/relations?relationId=${relationId}`, { method: 'DELETE' });
    if (res.ok) {
      await Promise.all([refreshRelations(), refreshActivities()]);
    }
  }

  const issueLabels = parseLabels(issue.labels);

  const outgoing = relations.filter((r) => r.direction === 'outgoing');
  const incoming = relations.filter((r) => r.direction === 'incoming');

  function relationLabel(type: string, direction: 'outgoing' | 'incoming') {
    if (type === 'blocks') return direction === 'outgoing' ? labels.relations.blocks : labels.relations.blockedBy;
    if (type === 'duplicates') return direction === 'outgoing' ? labels.relations.duplicates : labels.relations.duplicatedBy;
    return labels.relations.related;
  }

  const priorityLabel = (value: string) => labels.priorities.find((p) => p.value === value)?.label ?? value;

  return (
    <div className="app-page track-detail" data-track-project-id={issue.project_id}>
      <header className="track-detail-head">
        <nav className="track-breadcrumb" aria-label={labels.back}>
          <Link href={`/app/track/projects/${issue.project_id}`}>{initialProjectName}</Link>
          {initialParentChain.map((p) => (
            <span key={p.id} className="track-breadcrumb-step">
              <span className="track-breadcrumb-sep" aria-hidden>
                /
              </span>
              <Link href={`/app/track/issues/${p.id}`} title={p.title} className="track-identifier">
                {p.identifier}
              </Link>
            </span>
          ))}
          <span className="track-breadcrumb-sep" aria-hidden>
            /
          </span>
          <span className="track-breadcrumb-current track-identifier" aria-current="page">
            {issue.identifier}
          </span>
        </nav>
        <h1 className="track-detail-title">
          <textarea
            ref={titleRef}
            className="track-detail-title-input"
            value={titleDraft}
            rows={1}
            maxLength={500}
            placeholder={labels.untitled}
            aria-label={labels.edit.title}
            onChange={(e) => setTitleDraft(e.target.value.replace(/\n/g, ' '))}
            onBlur={() => void saveTitle()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setTitleDraft(issue.title);
                window.setTimeout(() => (e.target as HTMLTextAreaElement).blur(), 0);
              }
            }}
            data-testid="track-issue-title"
          />
        </h1>
        <div className="track-detail-bar">
          <div className="track-detail-meta">
            <StatusBadge name={issue.status_name} color={issue.status_color} category={issue.status_category} />
            <span className="track-priority">
              <PriorityIcon priority={issue.priority} />
              {priorityLabel(issue.priority)}
            </span>
            <span>{labels.createdOn.replace('{date}', formatDate(issue.created_at, locale))}</span>
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
            <Popover
              ariaLabel={labels.edit.more}
              className="btn btn-icon track-detail-more"
              width={240}
              trigger={
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                  <rect x="2" y="7" width="2.5" height="2.5" fill="currentColor" />
                  <rect x="6.75" y="7" width="2.5" height="2.5" fill="currentColor" />
                  <rect x="11.5" y="7" width="2.5" height="2.5" fill="currentColor" />
                </svg>
              }
            >
              {(close) => (
                <button
                  type="button"
                  role="menuitem"
                  className="track-menu-item"
                  data-testid="track-copy-branch"
                  data-branch={branchName}
                  data-autofocus
                  onClick={() => {
                    void navigator.clipboard?.writeText(branchName).catch(() => undefined);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1500);
                    close();
                  }}
                >
                  <span className="track-menu-label">{labels.edit.copyBranch}</span>
                  <span className="track-menu-meta data">{branchName}</span>
                </button>
              )}
            </Popover>
            {(doneStatus || openStatus) && (
              <button type="button" className="btn btn-primary" onClick={handleCloseReopen}>
                {isClosed ? labels.actions.reopen : labels.actions.close}
              </button>
            )}
          </div>
        </div>
        <span className="sr-only" role="status">
          {copied ? labels.edit.copied : ''}
        </span>
        {issue.triage === 1 && (
          <TriageBanner key={issue.id} issue={issue} statuses={initialStatuses} onResolved={() => void handleIssueChange()} />
        )}
      </header>

      <div className="track-detail-grid">
        <div className="track-detail-main">
          <section className="track-detail-section track-detail-description" aria-label={labels.description}>
            {editingDesc ? (
              <textarea
                ref={descRef}
                className="track-description-input"
                value={descDraft}
                rows={4}
                autoFocus
                placeholder={labels.edit.descriptionPlaceholder}
                aria-label={labels.description}
                onChange={(e) => setDescDraft(e.target.value)}
                onBlur={() => void saveDescription()}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    setDescDraft(parseDescription(issue.description));
                    setEditingDesc(false);
                  } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                }}
                data-testid="track-issue-description"
              />
            ) : (
              <button
                type="button"
                className={`track-description${descDraft.trim() ? '' : ' is-empty'}`}
                onClick={() => setEditingDesc(true)}
                aria-label={descDraft.trim() ? `${labels.description}: ${descDraft}` : labels.edit.descriptionPlaceholder}
                data-testid="track-issue-description"
              >
                {descDraft.trim() || labels.edit.descriptionPlaceholder}
              </button>
            )}
          </section>

          <div className="track-detail-add">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setSubOpen(true)}
              data-testid="track-add-subissue"
            >
              <span aria-hidden>+</span> {labels.edit.addSubtask}
            </button>
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
              <span className="btn btn-ghost btn-sm" aria-busy={uploading || undefined}>
                <span aria-hidden>+</span> {labels.edit.addAttachment}
              </span>
            </label>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setShowRelationForm(true)}
              aria-expanded={showRelationForm}
            >
              <span aria-hidden>+</span> {labels.edit.addRelation}
            </button>
          </div>
          {(subError || attachmentError) && (
            <p className="ui-error" role="alert">
              {subError ?? attachmentError}
            </p>
          )}

          {children.length > 0 && (
            <section className="track-detail-section">
              <h2 className="track-section-title">{labels.subtasks.title}</h2>
              <ul className="track-subtask-list">
                {children.map((child) => (
                  <li key={child.id} className="track-subtask">
                    <Link href={`/app/track/issues/${child.id}`}>
                      <span className="track-identifier">{child.identifier}</span>
                      <span className="track-subtask-title">{child.title || labels.untitled}</span>
                    </Link>
                    <div className="track-subtask-meta">
                      <StatusBadge name={child.status_name} color={child.status_color} category={child.status_category} />
                      <span className="track-priority">
                        <PriorityIcon priority={child.priority} />
                        {priorityLabel(child.priority)}
                      </span>
                      <span>{child.assignee_name ?? child.assignee_email ?? labels.properties.noAssignee}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <IssueGithubPanel data={github} />

          {attachments.length > 0 && (
            <section className="track-detail-section">
              <h2 className="track-section-title">{labels.attachments.title}</h2>
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
                        className="btn btn-ghost btn-sm btn-danger"
                        onClick={() => handleDeleteAttachment(a.id)}
                      >
                        {labels.attachments.delete}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(relations.length > 0 || showRelationForm) && (
            <section className="track-detail-section">
              <h2 className="track-section-title">{labels.relations.title}</h2>

              {outgoing.length > 0 && (
                <div className="track-relation-group">
                  <h3 className="track-relation-heading">{labels.relations.outgoing}</h3>
                  <ul className="track-relation-list">
                    {outgoing.map((r) => (
                      <li key={r.id} className="track-relation">
                        <span className="track-relation-type">{relationLabel(r.type, 'outgoing')}</span>
                        <Link href={`/app/track/issues/${r.related_issue_id}`}>
                          <span className="track-identifier">{r.identifier}</span> {r.title}
                        </Link>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleDeleteRelation(r.id)}>
                          {labels.relations.remove}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {incoming.length > 0 && (
                <div className="track-relation-group">
                  <h3 className="track-relation-heading">{labels.relations.incoming}</h3>
                  <ul className="track-relation-list">
                    {incoming.map((r) => (
                      <li key={r.id} className="track-relation">
                        <span className="track-relation-type">{relationLabel(r.type, 'incoming')}</span>
                        <Link href={`/app/track/issues/${r.issue_id}`}>
                          <span className="track-identifier">{r.identifier}</span> {r.title}
                        </Link>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleDeleteRelation(r.id)}>
                          {labels.relations.remove}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {showRelationForm && (
                <form
                  className="track-relation-form"
                  onSubmit={handleAddRelation}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      setShowRelationForm(false);
                    }
                  }}
                >
                  <select
                    className="select"
                    aria-label={labels.relations.selectType}
                    value={relationType}
                    onChange={(e) => setRelationType(e.target.value as (typeof RELATION_TYPES)[number])}
                  >
                    {RELATION_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {relationLabel(type, 'outgoing')}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input data"
                    type="text"
                    value={relationInput}
                    onChange={(e) => setRelationInput(e.target.value)}
                    placeholder={labels.relations.selectIssue}
                    aria-label={labels.relations.selectIssue}
                    autoFocus
                  />
                  <span className="track-inline-form-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowRelationForm(false)}>
                      {labels.relations.cancel}
                    </button>
                    <button type="submit" className="btn btn-primary btn-sm" disabled={!relationInput.trim()}>
                      {labels.relations.add}
                    </button>
                  </span>
                </form>
              )}
              {relationError && (
                <p className="ui-error" role="alert">
                  {relationError}
                </p>
              )}
            </section>
          )}

          <section className="track-detail-section">
            <h2 className="track-section-title">{labels.activity.title}</h2>
            <IssueActivityTimeline
              issueId={issue.id}
              locale={locale}
              userId={userId}
              activities={activities}
              members={initialMembers}
              labels={labels.activity}
              attachments={attachments}
              onChange={refreshActivities}
            />
          </section>
        </div>

        <aside className="track-detail-side">
          <section className="track-detail-props" aria-label={labels.properties.title}>
            <IssuePropertiesPanel
              issue={issue}
              statuses={initialStatuses}
              cycles={initialCycles}
              members={initialMembers}
              locale={locale}
              labels={labels.properties}
              priorities={labels.priorities}
              dateLabels={ui.inline}
              today={today}
              onChange={handleIssueChange}
              onError={() => setSaveError(ui.inline.saveError)}
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
      <TrackToast message={saveError} onDismiss={() => setSaveError(null)} dismissLabel={ui.inline.dismiss} />
    </div>
  );
}
