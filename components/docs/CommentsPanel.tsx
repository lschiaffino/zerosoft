'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import type { DocsComment, DocsMentionableUser } from '@/lib/docs-types';
import type { DocsSuggestion } from '@/lib/docs-marks';
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
  /** Comentario nuevo sobre texto seleccionado (el resaltado ya está en el bloque). */
  pendingAnchor?: { id: string; quote: string; blockId: string } | null;
  /** Se canceló el comentario sobre texto: el padre saca el resaltado. */
  onAnchorCancel?: () => void;
  onAnchorPosted?: () => void;
  /** Click en un hilo sobre texto: el padre lleva la vista al resaltado. */
  onThreadFocus?: (anchorId: string) => void;
  /** Hilo marcado desde el texto (click en un resaltado). */
  focusAnchor?: string | null;
  /** Cambia cuando otra persona comentó (el polling en vivo lo detecta): se recarga la lista. */
  refreshSignal?: string;
  /** Al borrar un hilo sobre texto: el padre saca el resaltado. */
  onThreadDeleted?: (anchorId: string) => void;
  /** Puede comentar (si no, solo lee). */
  canComment?: boolean;
  /** Puede borrar comentarios ajenos (acceso total). */
  canModerate?: boolean;
  /** Sugerencias de edición de la página (modo sugerir). */
  suggestions?: DocsSuggestion[];
  /** Puede aceptar o rechazar (edición). */
  canResolveSuggestions?: boolean;
  onResolveSuggestion?: (id: string | null, accept: boolean) => void;
  onSuggestionFocus?: (s: DocsSuggestion) => void;
  /** Nombres de las personas por id (autores de sugerencias). */
  peopleNames?: Record<string, string>;
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
  pendingAnchor = null,
  onAnchorCancel,
  onAnchorPosted,
  onThreadFocus,
  focusAnchor = null,
  refreshSignal,
  onThreadDeleted,
  canComment = true,
  canModerate: canModerateProp,
  suggestions = [],
  canResolveSuggestions = false,
  onResolveSuggestion,
  onSuggestionFocus,
  peopleNames = {},
}: CommentsPanelProps) {
  const [comments, setComments] = useState<DocsComment[]>(initialComments);
  const [members, setMembers] = useState<DocsMentionableUser[] | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  // Abiertos o resueltos (como el filtro del panel de Notion).
  const [tab, setTab] = useState<'open' | 'resolved'>('open');
  const t = useTranslations('docs.comments');
  const ts = useTranslations('docs.suggest');
  const format = useFormatter();
  // Se refresca cada minuto: "hace un momento" no queda fijo.
  const now = useNow({ updateInterval: 60_000 });

  useEffect(() => {
    setComments(initialComments);
  }, [initialComments]);

  useEffect(() => {
    onCommentsChange?.(comments);
  }, [comments, onCommentsChange]);

  // Otra persona comentó, respondió o resolvió: se recarga la lista.
  const firstSignal = useRef(refreshSignal);
  useEffect(() => {
    if (refreshSignal === undefined || refreshSignal === firstSignal.current) return;
    firstSignal.current = refreshSignal;
    let cancelled = false;
    fetch(`/api/docs/pages/${encodeURIComponent(pageId)}/comments`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { rows?: DocsComment[] } | null) => {
        if (!cancelled && data?.rows) setComments(data.rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [refreshSignal, pageId]);

  // Un hilo marcado desde el texto: a la vista, en su pestaña.
  useEffect(() => {
    if (!focusAnchor) return;
    const root = comments.find((c) => !c.parent_id && c.anchor_id === focusAnchor);
    if (!root) return;
    setTab(root.resolved ? 'resolved' : 'open');
    requestAnimationFrame(() => {
      document.querySelector(`[data-thread-anchor="${CSS.escape(focusAnchor)}"]`)?.scrollIntoView({ block: 'nearest' });
    });
  }, [focusAnchor, comments]);

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

  const canModerate = canModerateProp ?? currentUserId === pageOwnerId;
  const allThreads = useMemo(() => {
    const all = groupCommentThreads(comments);
    return blockFilter ? all.filter((th) => th.root.block_id === blockFilter) : all;
  }, [comments, blockFilter]);
  const openCount = allThreads.filter((th) => !th.root.resolved).length;
  const resolvedCount = allThreads.length - openCount;
  const threads = allThreads.filter((th) => (tab === 'open' ? !th.root.resolved : th.root.resolved));
  const mentionNames = useMemo(
    () => (members ?? []).flatMap((m) => [m.name ?? '', m.email]).filter(Boolean),
    [members],
  );

  const post = async (
    body: string,
    mentionIds: string[],
    parentId: string | null,
    anchor: { id: string; quote: string; blockId: string } | null = null,
  ): Promise<boolean> => {
    try {
      const res = await fetch(`/api/docs/pages/${pageId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body,
          block_id: parentId ? null : anchor?.blockId ?? blockFilter ?? null,
          parent_id: parentId,
          mention_ids: mentionIds,
          ...(anchor ? { anchor_id: anchor.id, quote: anchor.quote } : {}),
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
      if (anchor) {
        setTab('open');
        onAnchorPosted?.();
      }
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
    if (!comment.parent_id && comment.anchor_id) onThreadDeleted?.(comment.anchor_id);
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
          {isRoot && comment.block_id && !comment.anchor_id && <span className="badge badge-outline">{labels.blockTag}</span>}
          {isRoot && comment.resolved && <span className="badge badge-ok">{labels.resolved}</span>}
          <time
            className="docs-comment-date num"
            dateTime={comment.created_at}
            title={format.dateTime(parseDbUtc(comment.created_at), { dateStyle: 'medium', timeStyle: 'short' })}
            suppressHydrationWarning
          >
            {/* `now` se actualiza cada minuto: uno recién creado no queda "en 5 segundos". */}
            {format.relativeTime(new Date(Math.min(parseDbUtc(comment.created_at).getTime(), now.getTime())), now)}
          </time>
        </div>
        {renderBody(comment.body)}
        {canComment && (
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
        )}
      </div>
    </div>
  );

  const nameOf = (id: string) => peopleNames[id] ?? (id === currentUserId ? t('you') : t('someone'));

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

      {suggestions.length > 0 && (
        <section className="docs-suggestions" aria-label={ts('title')} data-testid="docs-suggestions">
          <div className="docs-suggestions-head">
            <h3 className="docs-suggestions-title">
              {ts('title')} <span className="num">{suggestions.length}</span>
            </h3>
            {canResolveSuggestions && suggestions.length > 1 && (
              <span className="docs-suggestions-all">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onResolveSuggestion?.(null, true)}>
                  {ts('acceptAll')}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onResolveSuggestion?.(null, false)}>
                  {ts('rejectAll')}
                </button>
              </span>
            )}
          </div>
          <ul className="docs-suggestions-list">
            {suggestions.map((s) => (
              <li key={s.id} className="docs-suggestion" data-testid="docs-suggestion">
                <button type="button" className="docs-suggestion-main" onClick={() => onSuggestionFocus?.(s)}>
                  <span className="docs-suggestion-who">{nameOf(s.by)}</span>
                  <span className="docs-suggestion-what">
                    {s.block ? ts('addedBlock') : s.inserted && s.deleted ? ts('replaced') : s.inserted ? ts('added') : ts('deleted')}
                  </span>
                  {s.deleted && <del className="docs-suggestion-del">{s.deleted}</del>}
                  {s.inserted && <ins className="docs-suggestion-ins">{s.inserted}</ins>}
                </button>
                {canResolveSuggestions && (
                  <span className="docs-suggestion-actions">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => onResolveSuggestion?.(s.id, true)} aria-label={`${ts('accept')}: ${s.inserted || s.deleted}`}>
                      {ts('accept')}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => onResolveSuggestion?.(s.id, false)} aria-label={`${ts('reject')}: ${s.inserted || s.deleted}`}>
                      {ts('reject')}
                    </button>
                  </span>
                )}
                {!canResolveSuggestions && s.by === currentUserId && (
                  <span className="docs-suggestion-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => onResolveSuggestion?.(s.id, false)}>
                      {ts('withdraw')}
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {pendingAnchor && canComment && (
        <div className="docs-comment-thread docs-comment-pending" data-testid="docs-inline-composer">
          <blockquote className="docs-comment-quote">{pendingAnchor.quote}</blockquote>
          <CommentComposer
            members={members}
            placeholder={labels.placeholder}
            submitLabel={labels.add}
            cancelLabel={t('cancel')}
            autoFocus
            onCancel={() => onAnchorCancel?.()}
            onSubmit={(body, ids) => post(body, ids, null, pendingAnchor)}
          />
        </div>
      )}

      <div className="docs-comments-tabs" role="tablist" aria-label={labels.title}>
        <button type="button" role="tab" aria-selected={tab === 'open'} className={`docs-comments-tab${tab === 'open' ? ' active' : ''}`} onClick={() => setTab('open')}>
          {t('open')} <span className="num">{openCount}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === 'resolved'} className={`docs-comments-tab${tab === 'resolved' ? ' active' : ''}`} onClick={() => setTab('resolved')}>
          {t('resolvedTab')} <span className="num">{resolvedCount}</span>
        </button>
      </div>

      <div className="docs-comments-list">
        {threads.length === 0 ? (
          <p className="docs-comments-empty">{tab === 'resolved' ? t('emptyResolved') : labels.empty}</p>
        ) : (
          threads.map((thread) => (
            <div
              key={thread.root.id}
              className={`docs-comment-thread${thread.root.resolved ? ' resolved' : ''}${thread.root.anchor_id && thread.root.anchor_id === focusAnchor ? ' is-focused' : ''}`}
              data-testid="docs-comment-thread"
              data-thread-anchor={thread.root.anchor_id ?? undefined}
            >
              {thread.root.quote && (
                <button
                  type="button"
                  className="docs-comment-quote"
                  onClick={() => thread.root.anchor_id && onThreadFocus?.(thread.root.anchor_id)}
                  title={t('goToText')}
                >
                  {thread.root.quote}
                </button>
              )}
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

      {canComment ? (
        <>
          <CommentComposer
            members={members}
            placeholder={labels.placeholder}
            submitLabel={labels.add}
            focusSignal={focusSignal}
            onSubmit={(body, ids) => post(body, ids, null)}
          />
          <p className="docs-comment-hint">{t('mentionHint')}</p>
        </>
      ) : (
        <p className="docs-comment-hint">{t('readOnlyHint')}</p>
      )}
    </div>
  );
}
