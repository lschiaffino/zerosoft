'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import type { DocsComment, DocsMentionableUser } from '@/lib/docs-types';
import {
  activeMentionQuery,
  commentBodyParts,
  groupCommentThreads,
  insertMention,
  type DocsCommentThread,
} from '@/lib/docs-comments';
import { parseDbUtc } from '@/lib/utils';

interface CommentsPanelLabels {
  title: string;
  empty: string;
  placeholder: string;
  add: string;
  resolve: string;
  unresolve: string;
  delete: string;
  resolved: string;
  blockThread: string;
  showAll: string;
  blockTag: string;
}

interface CommentsPanelProps {
  pageId: string;
  pageOwnerId: string;
  currentUserId: string;
  initialComments: DocsComment[];
  /** Cambia para enfocar el composer (botón "Add comment" del header). */
  focusSignal: number;
  /** Si está seteado, el panel muestra solo el hilo de ese bloque y publica con block_id. */
  blockFilter: string | null;
  onClearBlockFilter: () => void;
  /** Notifica al padre cada cambio de la lista (para badges por bloque). */
  onCommentsChange?: (comments: DocsComment[]) => void;
  labels: CommentsPanelLabels;
}

function CommentAvatar({ comment }: { comment: DocsComment }) {
  const name = comment.user_name ?? comment.user_email;
  if (comment.user_image) {
    // Avatares vienen de OAuth (Google): <img> simple, sin next/image.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={comment.user_image} alt="" className="docs-comment-avatar" />;
  }
  return (
    <span className="docs-comment-avatar docs-comment-avatar-fallback" aria-hidden>
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

/**
 * Textarea con @menciones: al escribir `@` aparece la lista de personas del
 * workspace de la página (↑/↓, Enter o Tab elige, Esc cierra). Las elegidas
 * viajan como `mention_ids` y el server avisa solo a las que siguen
 * nombradas en el texto.
 */
function CommentComposer({
  members,
  placeholder,
  submitLabel,
  autoFocus,
  focusSignal,
  onSubmit,
  onCancel,
  cancelLabel,
  testId,
}: {
  members: DocsMentionableUser[] | null;
  placeholder: string;
  submitLabel: string;
  autoFocus?: boolean;
  focusSignal?: number;
  onSubmit: (body: string, mentionIds: string[]) => Promise<boolean>;
  onCancel?: () => void;
  cancelLabel?: string;
  testId?: string;
}) {
  const t = useTranslations('docs');
  const [body, setBody] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (focusSignal && focusSignal > 0) ref.current?.focus();
  }, [focusSignal]);

  const matches = useMemo(() => {
    if (!mention || !members) return [];
    const q = mention.query.toLowerCase();
    return members
      .filter((m) => !q || (m.name ?? '').toLowerCase().includes(q) || m.email.toLowerCase().includes(q))
      .slice(0, 6);
  }, [mention, members]);

  const pick = (user: DocsMentionableUser) => {
    if (!mention) return;
    const next = insertMention(body, mention, user);
    setBody(next.text);
    setPicked((prev) => (prev.includes(user.id) ? prev : [...prev, user.id]));
    setMention(null);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
    });
  };

  const submit = async () => {
    const trimmed = body.trim();
    if (!trimmed || pending) return;
    setPending(true);
    const ok = await onSubmit(trimmed, picked);
    setPending(false);
    setError(!ok);
    if (ok) {
      setBody('');
      setPicked([]);
      setMention(null);
    }
  };

  return (
    <div className="docs-comment-composer" data-testid={testId}>
      <div className="docs-comment-input-wrap">
        <textarea
          ref={ref}
          className="textarea docs-comment-input"
          aria-label={placeholder}
          value={body}
          placeholder={placeholder}
          rows={2}
          autoFocus={autoFocus}
          aria-autocomplete="list"
          onChange={(e) => {
            setBody(e.target.value);
            const at = activeMentionQuery(e.target.value, e.target.selectionStart ?? e.target.value.length);
            setMention(at);
            setActive(0);
          }}
          onBlur={() => setTimeout(() => setMention(null), 120)}
          onKeyDown={(e) => {
            if (mention && matches.length > 0) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length);
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                pick(matches[Math.min(active, matches.length - 1)]);
                return;
              }
            }
            if (e.key === 'Escape') {
              if (mention) {
                e.preventDefault();
                setMention(null);
              } else if (onCancel) {
                e.preventDefault();
                onCancel();
              }
              return;
            }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        {mention && members && (
          <div className="docs-comment-mentions" role="listbox" onMouseDown={(e) => e.preventDefault()}>
            {matches.length === 0 ? (
              <div className="docs-mention-empty">{t('mentions.noMembers')}</div>
            ) : (
              matches.map((m, i) => (
                <button
                  key={m.id}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  className={`docs-mention-item${i === active ? ' sel' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(m)}
                >
                  <span className="docs-mention-avatar" aria-hidden>
                    {(m.name ?? m.email).charAt(0).toUpperCase()}
                  </span>
                  <span className="docs-mention-title">{m.name ?? m.email}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
      {error && (
        <p className="ui-error" role="alert">
          {t('comments.error')}
        </p>
      )}
      <div className="docs-comment-composer-actions">
        {onCancel && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
            {cancelLabel}
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!body.trim() || pending}
          aria-busy={pending || undefined}
          onClick={() => void submit()}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

export default function CommentsPanel({
  pageId,
  pageOwnerId,
  currentUserId,
  initialComments,
  focusSignal,
  blockFilter,
  onClearBlockFilter,
  onCommentsChange,
  labels,
}: CommentsPanelProps) {
  const [comments, setComments] = useState<DocsComment[]>(initialComments);
  const [members, setMembers] = useState<DocsMentionableUser[] | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const t = useTranslations('docs.comments');
  const format = useFormatter();
  // Se refresca cada minuto: "hace un momento" no queda fijo.
  const now = useNow({ updateInterval: 60_000 });

  useEffect(() => {
    setComments(initialComments);
  }, [initialComments]);

  useEffect(() => {
    onCommentsChange?.(comments);
  }, [comments, onCommentsChange]);

  // Personas mencionables (las del workspace dueño de la página).
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/docs/members?page=${encodeURIComponent(pageId)}`)
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((data: { rows?: DocsMentionableUser[] }) => {
        if (!cancelled) setMembers(data.rows ?? []);
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [pageId]);

  const canModerate = currentUserId === pageOwnerId;
  const threads = useMemo(() => {
    const all = groupCommentThreads(comments);
    return blockFilter ? all.filter((th) => th.root.block_id === blockFilter) : all;
  }, [comments, blockFilter]);
  const mentionNames = useMemo(
    () => (members ?? []).flatMap((m) => [m.name ?? '', m.email]).filter(Boolean),
    [members],
  );

  const post = async (body: string, mentionIds: string[], parentId: string | null): Promise<boolean> => {
    try {
      const res = await fetch(`/api/docs/pages/${pageId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body,
          block_id: parentId ? null : blockFilter ?? null,
          parent_id: parentId,
          mention_ids: mentionIds,
        }),
      });
      if (!res.ok) return false;
      const comment = (await res.json()) as DocsComment;
      // Responder reabre el hilo: el estado se refleja también en la lista local.
      setComments((prev) => [
        ...prev.map((c) =>
          parentId && (c.id === comment.parent_id || c.parent_id === comment.parent_id) ? { ...c, resolved: false } : c,
        ),
        comment,
      ]);
      if (parentId) setReplyTo(null);
      return true;
    } catch {
      return false;
    }
  };

  const toggleResolved = async (comment: DocsComment) => {
    const res = await fetch(`/api/docs/pages/${pageId}/comments/${comment.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolved: !comment.resolved }),
    });
    if (!res.ok) return;
    const updated = (await res.json()) as DocsComment;
    // El estado vive en el hilo entero.
    setComments((prev) =>
      prev.map((c) => (c.id === updated.id || c.parent_id === updated.id ? { ...c, resolved: updated.resolved } : c)),
    );
  };

  const removeComment = async (comment: DocsComment) => {
    const res = await fetch(`/api/docs/pages/${pageId}/comments/${comment.id}`, {
      method: 'DELETE',
    });
    if (!res.ok) return;
    setComments((prev) => prev.filter((c) => c.id !== comment.id && c.parent_id !== comment.id));
  };

  const renderBody = (body: string) => (
    <p className="docs-comment-body">
      {commentBodyParts(body, mentionNames).map((part, i) =>
        part.mention ? (
          <span key={i} className="docs-comment-mention">
            {part.text}
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </p>
  );

  const renderComment = (comment: DocsComment, thread: DocsCommentThread, isRoot: boolean) => (
    <div key={comment.id} className={`docs-comment${isRoot ? '' : ' docs-comment-reply'}`}>
      <CommentAvatar comment={comment} />
      <div className="docs-comment-main">
        <div className="docs-comment-head">
          <span className="docs-comment-author">{comment.user_name ?? comment.user_email}</span>
          {isRoot && comment.block_id && <span className="badge badge-outline">{labels.blockTag}</span>}
          {isRoot && comment.resolved && <span className="badge badge-ok">{labels.resolved}</span>}
          <time
            className="docs-comment-date num"
            dateTime={comment.created_at}
            title={format.dateTime(parseDbUtc(comment.created_at), { dateStyle: 'medium', timeStyle: 'short' })}
            suppressHydrationWarning
          >
            {format.relativeTime(parseDbUtc(comment.created_at), now)}
          </time>
        </div>
        {renderBody(comment.body)}
        <div className="docs-comment-actions">
          {isRoot && (
            <button
              type="button"
              className="docs-comment-action"
              onClick={() => setReplyTo((cur) => (cur === thread.root.id ? null : thread.root.id))}
              aria-expanded={replyTo === thread.root.id}
            >
              {t('reply')}
            </button>
          )}
          {isRoot && (
            <button type="button" className="docs-comment-action" onClick={() => toggleResolved(comment)}>
              {comment.resolved ? labels.unresolve : labels.resolve}
            </button>
          )}
          {(comment.user_id === currentUserId || canModerate) && (
            <button
              type="button"
              className="docs-comment-action docs-comment-action-danger"
              onClick={() => removeComment(comment)}
            >
              {labels.delete}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="docs-comments">
      <h2 className="docs-side-title">{labels.title}</h2>

      {blockFilter && (
        <div className="docs-comments-filter">
          <span className="docs-comments-filter-label">{labels.blockThread}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClearBlockFilter}>
            {labels.showAll}
          </button>
        </div>
      )}

      <div className="docs-comments-list">
        {threads.length === 0 ? (
          <p className="docs-comments-empty">{labels.empty}</p>
        ) : (
          threads.map((thread) => (
            <div
              key={thread.root.id}
              className={`docs-comment-thread${thread.root.resolved ? ' resolved' : ''}`}
              data-testid="docs-comment-thread"
            >
              {renderComment(thread.root, thread, true)}
              {thread.replies.length > 0 && (
                <div className="docs-comment-replies">
                  {thread.replies.map((r) => renderComment(r, thread, false))}
                </div>
              )}
              {replyTo === thread.root.id && (
                <div className="docs-comment-replies">
                  <CommentComposer
                    members={members}
                    placeholder={t('replyPlaceholder')}
                    submitLabel={t('reply')}
                    cancelLabel={t('cancel')}
                    autoFocus
                    testId="docs-comment-reply-composer"
                    onCancel={() => setReplyTo(null)}
                    onSubmit={(body, ids) => post(body, ids, thread.root.id)}
                  />
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <CommentComposer
        members={members}
        placeholder={labels.placeholder}
        submitLabel={labels.add}
        focusSignal={focusSignal}
        onSubmit={(body, ids) => post(body, ids, null)}
      />
      <p className="docs-comment-hint">{t('mentionHint')}</p>
    </div>
  );
}
