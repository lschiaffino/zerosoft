'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { DocsComment } from '@/lib/docs-types';

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
  const [body, setBody] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const t = useTranslations('docs.comments');
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setComments(initialComments);
  }, [initialComments]);

  useEffect(() => {
    onCommentsChange?.(comments);
  }, [comments, onCommentsChange]);

  useEffect(() => {
    if (focusSignal > 0) composerRef.current?.focus();
  }, [focusSignal]);

  const canModerate = currentUserId === pageOwnerId;
  const visible = blockFilter ? comments.filter((c) => c.block_id === blockFilter) : comments;

  const addComment = async () => {
    const trimmed = body.trim();
    if (!trimmed || pending) return;
    setPending(true);
    try {
      const res = await fetch(`/api/docs/pages/${pageId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: trimmed, block_id: blockFilter ?? null }),
      });
      if (!res.ok) {
        setError(true);
        return;
      }
      const comment = (await res.json()) as DocsComment;
      setComments((prev) => [...prev, comment]);
      setBody('');
      setError(false);
    } catch {
      setError(true);
    } finally {
      setPending(false);
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
    setComments((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  };

  const removeComment = async (comment: DocsComment) => {
    const res = await fetch(`/api/docs/pages/${pageId}/comments/${comment.id}`, {
      method: 'DELETE',
    });
    if (!res.ok) return;
    setComments((prev) => prev.filter((c) => c.id !== comment.id));
  };

  return (
    <div className="docs-comments">
      <h2 className="docs-side-title">{labels.title}</h2>

      {blockFilter && (
        <div className="docs-comments-filter">
          <span className="docs-comments-filter-label">{labels.blockThread}</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClearBlockFilter}
          >
            {labels.showAll}
          </button>
        </div>
      )}

      <div className="docs-comments-list">
        {visible.length === 0 ? (
          <p className="docs-comments-empty">{labels.empty}</p>
        ) : (
          visible.map((comment) => (
            <div
              key={comment.id}
              className={`docs-comment${comment.resolved ? ' resolved' : ''}`}
            >
              <CommentAvatar comment={comment} />
              <div className="docs-comment-main">
                <div className="docs-comment-head">
                  <span className="docs-comment-author">
                    {comment.user_name ?? comment.user_email}
                  </span>
                  {comment.block_id && (
                    <span className="badge badge-outline">{labels.blockTag}</span>
                  )}
                  {comment.resolved && (
                    <span className="badge badge-ok">{labels.resolved}</span>
                  )}
                  <span className="docs-comment-date num">
                    {comment.created_at.slice(0, 10)}
                  </span>
                </div>
                <p className="docs-comment-body">{comment.body}</p>
                <div className="docs-comment-actions">
                  <button
                    type="button"
                    className="docs-comment-action"
                    onClick={() => toggleResolved(comment)}
                  >
                    {comment.resolved ? labels.unresolve : labels.resolve}
                  </button>
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
          ))
        )}
      </div>

      <div className="docs-comment-composer">
        <textarea
          ref={composerRef}
          className="textarea docs-comment-input"
          aria-label={labels.placeholder}
          value={body}
          placeholder={labels.placeholder}
          rows={2}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void addComment();
            }
          }}
        />
        {error && (
          <p className="ui-error" role="alert">
            {t('error')}
          </p>
        )}
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!body.trim() || pending}
          aria-busy={pending || undefined}
          onClick={() => void addComment()}
        >
          {labels.add}
        </button>
      </div>
    </div>
  );
}
