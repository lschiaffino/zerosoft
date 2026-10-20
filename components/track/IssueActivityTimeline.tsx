'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { relDate } from '@/lib/utils';
import type { TrackIssueAttachmentRow } from '@/lib/db';
import type { TrackIssueActivityWithAuthor, ProjectMember } from '@/lib/track-data';
import MarkdownEditor, { MarkdownView, type MarkdownLabels } from './MarkdownEditor';

interface ActivityLabels {
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
}

interface IssueActivityTimelineProps {
  issueId: string;
  locale: string;
  /** Usuario actual: solo el autor ve editar/borrar en sus comentarios. */
  userId?: string;
  activities: TrackIssueActivityWithAuthor[];
  members: ProjectMember[];
  labels: ActivityLabels;
  /** Editor de Markdown del composer y de la edición de comentarios. */
  markdownLabels: MarkdownLabels;
  /** Adjuntos actuales del issue (para enlazar las entradas "subió X"). */
  attachments?: Array<Pick<TrackIssueAttachmentRow, 'id' | 'url'>>;
  onChange?: () => void;
}

function parseMeta(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function Avatar({ name }: { name: string | null }) {
  const initial = name?.[0]?.toUpperCase() ?? '?';
  return <span className="track-avatar">{initial}</span>;
}

function userName(activity: TrackIssueActivityWithAuthor, meta: Record<string, unknown> = parseMeta(activity.meta)): string {
  // Cambios automáticos de GitHub: se firman con el autor del PR, no con el
  // owner del workspace (que solo es el user_id técnico de la fila).
  if (meta.via === 'github') {
    const author = typeof meta.viaAuthor === 'string' && meta.viaAuthor ? ` (@${meta.viaAuthor})` : '';
    return `GitHub${author}`;
  }
  return activity.user_name ?? activity.user_email ?? '?';
}

function getMentionState(text: string, cursor: number): { active: boolean; query: string; start: number } {
  const before = text.slice(0, cursor);
  const atIndex = before.lastIndexOf('@');
  if (atIndex === -1) return { active: false, query: '', start: 0 };
  const afterAt = before.slice(atIndex + 1);
  // Stop mention if there's a space after the @ before the cursor.
  if (/\s/.test(afterAt)) return { active: false, query: '', start: 0 };
  return { active: true, query: afterAt, start: atIndex };
}

export default function IssueActivityTimeline({
  issueId,
  locale,
  userId,
  activities,
  members,
  labels,
  markdownLabels,
  attachments = [],
  onChange,
}: IssueActivityTimelineProps) {
  const attachmentUrls = useMemo(() => new Map(attachments.map((a) => [a.id, a.url])), [attachments]);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const [editBusy, setEditBusy] = useState(false);

  const sorted = useMemo(
    () => [...activities].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    [activities],
  );

  const mentionMembers = useMemo(() => {
    const q = mentionQuery.toLowerCase();
    return members.filter(
      (m) =>
        m.email.toLowerCase().includes(q) || m.name?.toLowerCase().includes(q),
    );
  }, [members, mentionQuery]);

  useEffect(() => {
    if (mentionIndex >= mentionMembers.length) setMentionIndex(0);
  }, [mentionMembers.length, mentionIndex]);

  async function submitComment(e: React.FormEvent) {
    e.preventDefault();
    const body = comment.trim();
    if (!body) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/track/issues/${issueId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      if (res.ok) {
        setComment('');
        setShowMentions(false);
        onChange?.();
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function saveEdit(commentId: string) {
    const body = editBody.trim();
    if (!body) return;
    setEditBusy(true);
    try {
      const res = await fetch(`/api/track/issues/${issueId}/comments/${commentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      if (res.ok) {
        setEditingId(null);
        onChange?.();
      }
    } finally {
      setEditBusy(false);
    }
  }

  async function removeComment(commentId: string) {
    if (!window.confirm(labels.deleteCommentConfirm)) return;
    const res = await fetch(`/api/track/issues/${issueId}/comments/${commentId}`, { method: 'DELETE' });
    if (res.ok) onChange?.();
  }

  function insertMention(member: ProjectMember) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const cursor = textarea.selectionStart;
    const state = getMentionState(comment, cursor);
    const mentionText = `@${member.email}`;
    const newText = comment.slice(0, state.start) + mentionText + ' ' + comment.slice(cursor);
    setComment(newText);
    setShowMentions(false);
    setMentionQuery('');
    setMentionIndex(0);
    setTimeout(() => {
      textarea.focus();
      const pos = state.start + mentionText.length + 1;
      textarea.setSelectionRange(pos, pos);
    }, 0);
  }

  function handleInput(value: string) {
    setComment(value);
    const cursor = textareaRef.current?.selectionStart ?? value.length;
    const state = getMentionState(value, cursor);
    if (state.active) {
      setShowMentions(true);
      setMentionQuery(state.query);
    } else {
      setShowMentions(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!showMentions || mentionMembers.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setMentionIndex((i) => (i + 1) % mentionMembers.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setMentionIndex((i) => (i - 1 + mentionMembers.length) % mentionMembers.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      insertMention(mentionMembers[mentionIndex]);
    } else if (e.key === 'Escape') {
      setShowMentions(false);
    }
  }

  function renderActivity(activity: TrackIssueActivityWithAuthor) {
    const meta = parseMeta(activity.meta);
    const name = userName(activity, meta);

    switch (activity.type) {
      case 'created':
        return <span>{labels.created.replace('{user}', name)}</span>;
      case 'status_change': {
        const from = String(meta.from ?? '');
        const to = String(meta.to ?? '');
        return (
          <span>
            {labels.statusChange.replace('{user}', name).replace('{from}', from).replace('{to}', to)}
          </span>
        );
      }
      case 'assignee_change': {
        const fromId = String(meta.from ?? '');
        const toId = String(meta.to ?? '');
        const fromName = members.find((m) => m.id === fromId)?.name ?? members.find((m) => m.id === fromId)?.email ?? labels.unassigned;
        const toName = toId
          ? (members.find((m) => m.id === toId)?.name ?? members.find((m) => m.id === toId)?.email ?? toId)
          : labels.unassigned;
        return (
          <span>
            {labels.assigneeChange
              .replace('{user}', name)
              .replace('{from}', fromName)
              .replace('{to}', toName)}
          </span>
        );
      }
      case 'priority_change': {
        const from = String(meta.from ?? '');
        const to = String(meta.to ?? '');
        return (
          <span>
            {labels.priorityChange.replace('{user}', name).replace('{from}', from).replace('{to}', to)}
          </span>
        );
      }
      case 'cycle_change': {
        const from = String(meta.from ?? '');
        const to = String(meta.to ?? '');
        return (
          <span>
            {labels.cycleChange.replace('{user}', name).replace('{from}', from).replace('{to}', to)}
          </span>
        );
      }
      case 'due_date_change': {
        const from = String(meta.from ?? '');
        const to = String(meta.to ?? '');
        return (
          <span>
            {labels.dueDateChange.replace('{user}', name).replace('{from}', from).replace('{to}', to)}
          </span>
        );
      }
      case 'estimate_change': {
        const from = String(meta.from ?? '');
        const to = String(meta.to ?? '');
        return (
          <span>
            {labels.estimateChange.replace('{user}', name).replace('{from}', from).replace('{to}', to)}
          </span>
        );
      }
      case 'title_change': {
        const from = String(meta.from ?? '');
        const to = String(meta.to ?? '');
        return (
          <span>
            {labels.titleChange.replace('{user}', name).replace('{from}', from).replace('{to}', to)}
          </span>
        );
      }
      case 'description_change':
        return <span>{labels.descriptionChange.replace('{user}', name)}</span>;
      case 'relation_added': {
        const relatedIssueId = String(meta.relatedIssueId ?? '');
        return (
          <span>
            {labels.relationAdded.replace('{user}', name)}{' '}
            {relatedIssueId && (
              <Link href={`/app/track/issues/${relatedIssueId}`} className="track-activity-link">
                {String(meta.identifier ?? relatedIssueId)}
              </Link>
            )}
          </span>
        );
      }
      case 'relation_removed':
        return <span>{labels.relationRemoved.replace('{user}', name)}</span>;
      case 'attachment_added': {
        const attachmentId = String(meta.attachmentId ?? '');
        const filename = String(meta.filename ?? '');
        // Se enlaza al archivo real; si el adjunto ya se borró, queda solo el nombre.
        const url = attachmentUrls.get(attachmentId);
        return (
          <span>
            {labels.attachmentAdded.replace('{user}', name).replace('{filename}', filename)}{' '}
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="track-activity-link"
              >
                {filename}
              </a>
            )}
          </span>
        );
      }
      case 'subtask_added':
        return <span>{labels.subtaskAdded.replace('{user}', name)}</span>;
      case 'closed':
        return <span>{labels.closed.replace('{user}', name)}</span>;
      case 'reopened':
        return <span>{labels.reopened.replace('{user}', name)}</span>;
      case 'comment': {
        const body = String(meta.body ?? '');
        const commentId = String(meta.commentId ?? activity.id);
        if (editingId === commentId) {
          return (
            <div>
              {labels.commented.replace('{user}', name)}
              <div className="track-comment-edit">
                <MarkdownEditor
                  value={editBody}
                  onValueChange={setEditBody}
                  labels={markdownLabels}
                  textareaProps={{
                    'aria-label': labels.editComment,
                    rows: 3,
                    maxLength: 5000,
                    autoFocus: true,
                    onKeyDown: (e) => {
                      if (e.key === 'Escape') setEditingId(null);
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void saveEdit(commentId);
                    },
                  }}
                />
                <span className="track-comment-edit-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingId(null)}>
                    {labels.cancelEdit}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={!editBody.trim() || editBusy}
                    aria-busy={editBusy || undefined}
                    onClick={() => void saveEdit(commentId)}
                  >
                    {labels.saveComment}
                  </button>
                </span>
              </div>
            </div>
          );
        }
        return (
          <div>
            {labels.commented.replace('{user}', name)}
            {body && <MarkdownView source={body} className="track-activity-comment" />}
          </div>
        );
      }
      default:
        return <span>{activity.type}</span>;
    }
  }

  return (
    <div className="track-activity">
      <form className="track-activity-composer" onSubmit={submitComment}>
        <MarkdownEditor
          className="track-activity-composer-input"
          value={comment}
          onValueChange={handleInput}
          labels={markdownLabels}
          textareaRef={textareaRef}
          textareaProps={{
            'aria-label': labels.addComment,
            placeholder: labels.addComment,
            rows: 3,
            maxLength: 5000,
            onKeyDown: handleKeyDown,
          }}
        >
          {showMentions && mentionMembers.length > 0 && (
            <div className="track-mention-dropdown">
              {mentionMembers.map((m, i) => (
                <button
                  key={m.id}
                  type="button"
                  className={`track-mention-option${i === mentionIndex ? ' active' : ''}`}
                  onClick={() => insertMention(m)}
                >
                  <span>{m.name ?? m.email}</span>
                  <span>{m.email}</span>
                </button>
              ))}
            </div>
          )}
        </MarkdownEditor>
        <button type="submit" className="btn btn-primary btn-sm" disabled={!comment.trim()} aria-busy={submitting || undefined}>
          {labels.submitComment}
        </button>
      </form>

      {sorted.length === 0 ? (
        <p className="ui-help">{labels.empty}</p>
      ) : (
        <div className="track-activity-list">
          {sorted.map((activity) => {
            const isComment = activity.type === 'comment';
            const meta = isComment ? parseMeta(activity.meta) : {};
            const commentId = String(meta.commentId ?? activity.id);
            const mine = isComment && !!userId && activity.user_id === userId && editingId !== commentId;
            return (
              <div key={activity.id} className="track-activity-item">
                <Avatar name={userName(activity)} />
                <div className="track-activity-body">
                  <div className="track-activity-text">{renderActivity(activity)}</div>
                  <span className="track-activity-meta">
                    <time className="track-activity-time" dateTime={activity.created_at}>
                      {relDate(activity.created_at, locale)}
                    </time>
                    {isComment && typeof meta.editedAt === 'string' && meta.editedAt && (
                      <span className="track-activity-time" title={relDate(meta.editedAt, locale)}>
                        {labels.edited}
                      </span>
                    )}
                    {mine && (
                      <>
                        <button
                          type="button"
                          className="track-comment-action"
                          onClick={() => {
                            setEditingId(commentId);
                            setEditBody(String(meta.body ?? ''));
                          }}
                        >
                          {labels.editComment}
                        </button>
                        <button
                          type="button"
                          className="track-comment-action"
                          onClick={() => void removeComment(commentId)}
                        >
                          {labels.deleteComment}
                        </button>
                      </>
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
