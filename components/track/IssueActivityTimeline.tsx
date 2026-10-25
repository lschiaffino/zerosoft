'use client';

import { useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { relDate } from '@/lib/utils';
import type { TrackIssueAttachmentRow } from '@/lib/db';
import type { TrackIssueActivityWithAuthor, ProjectMember } from '@/lib/track-data';
import type { CommentReaction } from '@/lib/track-ux';
import MarkdownEditor, { MarkdownView, type MarkdownLabels, type UploadResult } from './MarkdownEditor';
import { Popover } from './InlineEditors';
import TrackIcon from './TrackIcon';
import { pushNotice } from './trackUndo';

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
  /** Reacciones de los comentarios del issue. */
  reactions?: CommentReaction[];
  onReactions?: (reactions: CommentReaction[]) => void;
  members: ProjectMember[];
  labels: ActivityLabels;
  /** Editor de Markdown del composer y de la edición de comentarios. */
  markdownLabels: MarkdownLabels;
  /** Adjuntos actuales del issue (para enlazar las entradas "subió X"). */
  attachments?: Array<Pick<TrackIssueAttachmentRow, 'id' | 'url'>>;
  /** Pegar imágenes en un comentario las sube como adjunto. */
  onUpload?: (file: File) => Promise<UploadResult | null>;
  onChange?: () => void;
}

export const REACTIONS = ['👍', '👎', '❤️', '🎉', '😄', '😕', '👀', '🚀'];

function parseMeta(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function Avatar({ name, small = false }: { name: string | null; small?: boolean }) {
  const initial = name?.[0]?.toUpperCase() ?? '?';
  return <span className={`track-avatar${small ? ' is-small' : ''}`}>{initial}</span>;
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

/** Ícono chico de cada evento de la línea de tiempo (como el feed de Linear). */
function eventIcon(type: string) {
  switch (type) {
    case 'assignee_change':
      return 'user' as const;
    case 'priority_change':
      return 'flag' as const;
    case 'cycle_change':
      return 'cycle' as const;
    case 'due_date_change':
      return 'calendar' as const;
    case 'estimate_change':
      return 'estimate' as const;
    case 'title_change':
    case 'description_change':
      return 'pencil' as const;
    case 'relation_added':
    case 'relation_removed':
      return 'link' as const;
    case 'attachment_added':
      return 'pin' as const;
    case 'subtask_added':
      return 'subtasks' as const;
    case 'closed':
      return 'check' as const;
    default:
      return 'clock' as const;
  }
}

interface CommentItem {
  activity: TrackIssueActivityWithAuthor;
  id: string;
  body: string;
  parentId: string | null;
  editedAt: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

function toComment(a: TrackIssueActivityWithAuthor): CommentItem {
  const meta = parseMeta(a.meta);
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  return {
    activity: a,
    id: String(meta.commentId ?? a.id),
    body: String(meta.body ?? ''),
    parentId: str(meta.parentId),
    editedAt: str(meta.editedAt),
    resolvedAt: str(meta.resolvedAt),
    resolvedBy: str(meta.resolvedBy),
  };
}

export default function IssueActivityTimeline({
  issueId,
  locale,
  userId,
  activities,
  reactions = [],
  onReactions,
  members,
  labels,
  markdownLabels,
  attachments = [],
  onUpload,
  onChange,
}: IssueActivityTimelineProps) {
  const tt = useTranslations('track.ux.thread');
  const attachmentUrls = useMemo(() => new Map(attachments.map((a) => [a.id, a.url])), [attachments]);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [openResolved, setOpenResolved] = useState<Set<string>>(new Set());
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const sorted = useMemo(
    () => [...activities].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    [activities],
  );
  const replies = useMemo(() => {
    const map = new Map<string, CommentItem[]>();
    for (const a of sorted) {
      if (a.type !== 'comment') continue;
      const c = toComment(a);
      if (!c.parentId) continue;
      const list = map.get(c.parentId) ?? [];
      list.push(c);
      map.set(c.parentId, list);
    }
    return map;
  }, [sorted]);
  const commentIds = useMemo(
    () => new Set(sorted.filter((a) => a.type === 'comment').map((a) => toComment(a).id)),
    [sorted],
  );
  const byComment = useMemo(() => {
    const map = new Map<string, Map<string, CommentReaction[]>>();
    for (const r of reactions) {
      const m = map.get(r.comment_id) ?? new Map<string, CommentReaction[]>();
      m.set(r.emoji, [...(m.get(r.emoji) ?? []), r]);
      map.set(r.comment_id, m);
    }
    return map;
  }, [reactions]);

  async function post(body: string, parentId?: string): Promise<boolean> {
    setError(null);
    const res = await fetch(`/api/track/issues/${issueId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parentId ? { body, parentId } : { body }),
    }).catch(() => null);
    if (!res?.ok) {
      setError(tt('postError'));
      return false;
    }
    onChange?.();
    return true;
  }

  async function submitComment(e?: React.FormEvent) {
    e?.preventDefault();
    const body = comment.trim();
    if (!body || submitting) return;
    setSubmitting(true);
    try {
      if (await post(body)) setComment('');
    } finally {
      setSubmitting(false);
    }
  }

  async function submitReply(parentId: string) {
    const body = replyBody.trim();
    if (!body || submitting) return;
    setSubmitting(true);
    try {
      if (await post(body, parentId)) {
        setReplyBody('');
        setReplyTo(null);
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

  async function react(commentId: string, emoji: string) {
    // Optimista: se pone o se saca al instante y se corrige con la respuesta.
    const mine = reactions.some((r) => r.comment_id === commentId && r.emoji === emoji && r.user_id === userId);
    const optimistic = mine
      ? reactions.filter((r) => !(r.comment_id === commentId && r.emoji === emoji && r.user_id === userId))
      : [...reactions, { comment_id: commentId, emoji, user_id: userId ?? '', user_name: tt('you') }];
    onReactions?.(optimistic);
    const res = await fetch(`/api/track/issues/${issueId}/comments/${commentId}/reactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji }),
    }).catch(() => null);
    if (!res?.ok) {
      onReactions?.(reactions);
      setError(tt('reactError'));
      return;
    }
    const data = (await res.json()) as { reactions: CommentReaction[] };
    onReactions?.(data.reactions);
  }

  async function resolve(commentId: string, resolved: boolean) {
    const res = await fetch(`/api/track/issues/${issueId}/comments/${commentId}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolved }),
    }).catch(() => null);
    if (!res?.ok) {
      setError(tt('resolveError'));
      return;
    }
    setOpenResolved((s) => {
      const next = new Set(s);
      next.delete(commentId);
      return next;
    });
    onChange?.();
  }

  function copyCommentLink(commentId: string) {
    const url = `${window.location.href.split('#')[0]}#comment-${commentId}`;
    void navigator.clipboard?.writeText(url).catch(() => undefined);
    pushNotice(tt('linkCopied'));
  }

  function renderEvent(activity: TrackIssueActivityWithAuthor) {
    const meta = parseMeta(activity.meta);
    const name = userName(activity, meta);
    const from = String(meta.from ?? '');
    const to = String(meta.to ?? '');
    const fill = (tpl: string, f = from, t2 = to) => tpl.replace('{user}', name).replace('{from}', f).replace('{to}', t2);
    switch (activity.type) {
      case 'created':
        return labels.created.replace('{user}', name);
      case 'status_change':
        return fill(labels.statusChange);
      case 'assignee_change': {
        const nameOf = (id: string) =>
          id ? (members.find((m) => m.id === id)?.name ?? members.find((m) => m.id === id)?.email ?? id) : labels.unassigned;
        return fill(labels.assigneeChange, nameOf(from), nameOf(to));
      }
      case 'priority_change':
        return fill(labels.priorityChange);
      case 'cycle_change':
        return fill(labels.cycleChange);
      case 'due_date_change':
        return fill(labels.dueDateChange);
      case 'estimate_change':
        return fill(labels.estimateChange);
      case 'title_change':
        return fill(labels.titleChange);
      case 'description_change':
        return labels.descriptionChange.replace('{user}', name);
      case 'relation_added': {
        const relatedIssueId = String(meta.relatedIssueId ?? '');
        return (
          <>
            {labels.relationAdded.replace('{user}', name)}{' '}
            {relatedIssueId && (
              <Link href={`/app/track/issues/${relatedIssueId}`} className="track-activity-link">
                {String(meta.identifier ?? relatedIssueId)}
              </Link>
            )}
          </>
        );
      }
      case 'relation_removed':
        return labels.relationRemoved.replace('{user}', name);
      case 'attachment_added': {
        const filename = String(meta.filename ?? '');
        const url = attachmentUrls.get(String(meta.attachmentId ?? ''));
        return (
          <>
            {labels.attachmentAdded.replace('{user}', name).replace('{filename}', filename)}{' '}
            {url && (
              <a href={url} target="_blank" rel="noreferrer" className="track-activity-link">
                {filename}
              </a>
            )}
          </>
        );
      }
      case 'subtask_added':
        return labels.subtaskAdded.replace('{user}', name);
      case 'closed':
        return labels.closed.replace('{user}', name);
      case 'reopened':
        return labels.reopened.replace('{user}', name);
      default:
        return activity.type;
    }
  }

  function reactionBar(c: CommentItem) {
    const groups = byComment.get(c.id);
    return (
      <div className="track-reactions" role="group" aria-label={tt('reactions')}>
        {groups &&
          Array.from(groups.entries()).map(([emoji, list]) => {
            const mine = list.some((r) => r.user_id === userId);
            const who = list.map((r) => (r.user_id === userId ? tt('you') : (r.user_name ?? '?'))).join(', ');
            return (
              <button
                key={emoji}
                type="button"
                className={`track-reaction${mine ? ' is-mine' : ''}`}
                aria-pressed={mine}
                title={who}
                aria-label={tt('reactionLabel', { emoji, count: list.length, who })}
                onClick={() => void react(c.id, emoji)}
                data-testid="track-reaction"
              >
                <span aria-hidden>{emoji}</span>
                <span className="track-reaction-count">{list.length}</span>
              </button>
            );
          })}
      </div>
    );
  }

  function emojiPicker(c: CommentItem) {
    return (
      <Popover
        ariaLabel={tt('addReaction')}
        className="track-comment-tool"
        width={232}
        trigger={<TrackIcon name="smile" size={14} />}
      >
        {(close) => (
          <div className="track-emoji-grid">
            {REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                role="menuitem"
                className="track-emoji"
                aria-label={emoji}
                onClick={() => {
                  close();
                  void react(c.id, emoji);
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </Popover>
    );
  }

  function commentMenu(c: CommentItem, isRoot: boolean) {
    const mine = Boolean(userId) && c.activity.user_id === userId;
    return (
      <Popover ariaLabel={tt('more')} className="track-comment-tool" width={220} trigger={<TrackIcon name="more" size={14} />}>
        {(close) => (
          <>
            {isRoot && (
              <button
                type="button"
                role="menuitem"
                className="track-menu-item"
                onClick={() => {
                  close();
                  void resolve(c.id, !c.resolvedAt);
                }}
                data-testid="track-thread-resolve"
              >
                <span className="track-menu-label">{c.resolvedAt ? tt('reopen') : tt('resolve')}</span>
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              className="track-menu-item"
              onClick={() => {
                close();
                copyCommentLink(c.id);
              }}
            >
              <span className="track-menu-label">{tt('copyLink')}</span>
            </button>
            {mine && (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className="track-menu-item"
                  onClick={() => {
                    close();
                    setEditingId(c.id);
                    setEditBody(c.body);
                  }}
                >
                  <span className="track-menu-label">{labels.editComment}</span>
                </button>
                <div className="track-menu-sep" role="separator" />
                <button
                  type="button"
                  role="menuitem"
                  className="track-menu-item is-danger"
                  onClick={() => {
                    close();
                    void removeComment(c.id);
                  }}
                >
                  <span className="track-menu-label">{labels.deleteComment}</span>
                </button>
              </>
            )}
          </>
        )}
      </Popover>
    );
  }

  function commentBlock(c: CommentItem, isRoot: boolean) {
    const name = userName(c.activity);
    const editing = editingId === c.id;
    return (
      <div className={`track-comment${isRoot ? '' : ' is-reply'}`} id={`comment-${c.id}`} data-testid="track-comment">
        <div className="track-comment-head">
          <Avatar name={name} small={!isRoot} />
          <span className="track-comment-author">{name}</span>
          <time className="track-activity-time" dateTime={c.activity.created_at} title={c.activity.created_at}>
            {relDate(c.activity.created_at, locale)}
          </time>
          {c.editedAt && (
            <span className="track-activity-time" title={relDate(c.editedAt, locale)}>
              {labels.edited}
            </span>
          )}
          {!editing && (
            <span className="track-comment-tools">
              {emojiPicker(c)}
              {isRoot && (
                <button
                  type="button"
                  className="track-inline-trigger track-comment-tool"
                  aria-label={tt('reply')}
                  title={tt('reply')}
                  onClick={() => {
                    setReplyTo(c.id);
                    setReplyBody('');
                  }}
                  data-testid="track-comment-reply"
                >
                  <TrackIcon name="reply" size={14} />
                </button>
              )}
              {commentMenu(c, isRoot)}
            </span>
          )}
        </div>
        {editing ? (
          <div className="track-comment-edit">
            <MarkdownEditor
              value={editBody}
              onValueChange={setEditBody}
              labels={markdownLabels}
              members={members}
              onUpload={onUpload}
              textareaProps={{
                'aria-label': labels.editComment,
                rows: 3,
                maxLength: 5000,
                autoFocus: true,
                onKeyDown: (e) => {
                  if (e.key === 'Escape') setEditingId(null);
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void saveEdit(c.id);
                  }
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
                onClick={() => void saveEdit(c.id)}
              >
                {labels.saveComment}
              </button>
            </span>
          </div>
        ) : (
          c.body && <MarkdownView source={c.body} className="track-activity-comment" />
        )}
        {reactionBar(c)}
      </div>
    );
  }

  function thread(root: CommentItem) {
    const list = replies.get(root.id) ?? [];
    const resolved = Boolean(root.resolvedAt);
    const expanded = !resolved || openResolved.has(root.id);
    return (
      <div className={`track-thread${resolved ? ' is-resolved' : ''}`} key={root.activity.id} data-testid="track-thread">
        {resolved && (
          <button
            type="button"
            className="track-thread-resolved"
            aria-expanded={expanded}
            onClick={() =>
              setOpenResolved((s) => {
                const next = new Set(s);
                if (next.has(root.id)) next.delete(root.id);
                else next.add(root.id);
                return next;
              })
            }
            data-testid="track-thread-resolved"
          >
            <TrackIcon name="check" size={12} />
            <span>{tt('resolvedBy', { name: root.resolvedBy ?? '?', count: list.length + 1 })}</span>
            <span className="track-thread-toggle">{expanded ? tt('hide') : tt('show')}</span>
          </button>
        )}
        {expanded && (
          <>
            {commentBlock(root, true)}
            {list.length > 0 && <div className="track-thread-replies">{list.map((r) => <div key={r.activity.id}>{commentBlock(r, false)}</div>)}</div>}
            {replyTo === root.id ? (
              <div className="track-thread-reply">
                <MarkdownEditor
                  value={replyBody}
                  onValueChange={setReplyBody}
                  labels={markdownLabels}
                  members={members}
                  onUpload={onUpload}
                  textareaProps={{
                    'aria-label': tt('replyPlaceholder'),
                    placeholder: tt('replyPlaceholder'),
                    rows: 2,
                    maxLength: 5000,
                    autoFocus: true,
                    onKeyDown: (e) => {
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        setReplyTo(null);
                      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        void submitReply(root.id);
                      }
                    },
                    'data-testid': 'track-reply-input',
                  }}
                />
                <span className="track-comment-edit-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReplyTo(null)}>
                    {labels.cancelEdit}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={!replyBody.trim() || submitting}
                    onClick={() => void submitReply(root.id)}
                    data-testid="track-reply-submit"
                  >
                    {tt('replySubmit')}
                  </button>
                </span>
              </div>
            ) : (
              list.length > 0 && (
                <button type="button" className="track-thread-reply-btn" onClick={() => setReplyTo(root.id)}>
                  {tt('replyPlaceholder')}
                </button>
              )
            )}
          </>
        )}
      </div>
    );
  }

  const visible = sorted.filter((a) => {
    if (a.type !== 'comment') return true;
    const c = toComment(a);
    // Las respuestas van dentro de su hilo (si el padre existe).
    return !c.parentId || !commentIds.has(c.parentId);
  });

  return (
    <div className="track-activity">
      {visible.length === 0 ? (
        <p className="ui-help">{labels.empty}</p>
      ) : (
        <ol className="track-activity-list" role="list">
          {visible.map((activity) =>
            activity.type === 'comment' ? (
              <li key={activity.id} className="track-activity-entry is-comment">
                {thread(toComment(activity))}
              </li>
            ) : (
              <li key={activity.id} className="track-activity-entry track-activity-event">
                <span className="track-event-icon" aria-hidden>
                  <TrackIcon name={eventIcon(activity.type)} size={12} />
                </span>
                <span className="track-activity-text">{renderEvent(activity)}</span>
                <time className="track-activity-time" dateTime={activity.created_at} title={activity.created_at}>
                  {relDate(activity.created_at, locale)}
                </time>
              </li>
            ),
          )}
        </ol>
      )}

      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}

      <form className="track-activity-composer" onSubmit={submitComment}>
        <MarkdownEditor
          className="track-activity-composer-input"
          value={comment}
          onValueChange={setComment}
          labels={markdownLabels}
          textareaRef={composerRef}
          members={members}
          onUpload={onUpload}
          textareaProps={{
            'aria-label': labels.addComment,
            placeholder: labels.addComment,
            rows: 3,
            maxLength: 5000,
            onKeyDown: (e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submitComment();
              }
            },
          }}
        />
        <button type="submit" className="btn btn-primary btn-sm" disabled={!comment.trim()} aria-busy={submitting || undefined}>
          {labels.submitComment}
        </button>
      </form>
    </div>
  );
}
