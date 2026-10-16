'use client';

import { useState, type FormEvent } from 'react';
import type { CommentView } from '@/lib/board';

export interface CommentLabels {
  title: string;
  empty: string;
  placeholder: string;
  send: string;
  sending: string;
  officialTag: string;
  pinned: string;
  pin: string;
  unpin: string;
  markOfficial: string;
  unmarkOfficial: string;
  postOfficial: string;
  delete: string;
  deleteConfirm: string;
  loginToComment: string;
  error: string;
  anonymous: string;
  markdownHint: string;
}

/**
 * Comentarios de un ítem. El HTML ya viene sanitizado del servidor
 * (renderCommentHtml). Borrar: el propio o admin. Fijar y marcar como
 * respuesta oficial "Equipo zerosoft": solo admin.
 */
export default function BoardComments({
  itemId,
  initial,
  personId,
  isAdmin,
  loginHref,
  locale,
  labels,
}: {
  itemId: string;
  initial: CommentView[];
  personId: string | null;
  isAdmin: boolean;
  loginHref: string;
  locale: string;
  labels: CommentLabels;
}) {
  const [comments, setComments] = useState(initial);
  const [body, setBody] = useState('');
  const [official, setOfficial] = useState(false);
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function sorted(list: CommentView[]): CommentView[] {
    return [...list].sort((a, b) => b.pinned - a.pinned || a.created_at.localeCompare(b.created_at));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !body.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/board/items/${encodeURIComponent(itemId)}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body, official: isAdmin ? official : undefined, locale, website }),
    }).catch(() => null);
    if (res?.status === 401) {
      window.location.href = loginHref;
      return;
    }
    const data = res?.ok ? ((await res.json().catch(() => null)) as { comment?: CommentView } | null) : null;
    if (data?.comment) {
      setComments((prev) => sorted([...prev, data.comment!]));
      setBody('');
      setOfficial(false);
    } else {
      setError(labels.error);
    }
    setBusy(false);
  }

  async function remove(id: string) {
    if (!window.confirm(labels.deleteConfirm)) return;
    const res = await fetch(`/api/board/comments/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null);
    if (res?.ok) setComments((prev) => prev.filter((c) => c.id !== id));
    else setError(labels.error);
  }

  async function moderate(id: string, patch: { pinned?: boolean; official?: boolean }) {
    const res = await fetch(`/api/board/comments/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }).catch(() => null);
    if (!res?.ok) {
      setError(labels.error);
      return;
    }
    setComments((prev) =>
      sorted(
        prev.map((c) =>
          c.id === id
            ? {
                ...c,
                pinned: patch.pinned === undefined ? c.pinned : patch.pinned ? 1 : 0,
                is_official: patch.official === undefined ? c.is_official : patch.official ? 1 : 0,
              }
            : c,
        ),
      ),
    );
  }

  return (
    <section className="bp-comments" aria-labelledby="bp-comments-title">
      <h2 id="bp-comments-title">
        {labels.title} <span className="bp-hint">{comments.length}</span>
      </h2>
      {comments.length === 0 && <p className="bp-hint">{labels.empty}</p>}
      {comments.map((c) => {
        const name = c.is_official ? labels.officialTag : (c.author_name ?? labels.anonymous);
        return (
          <article key={c.id} className={`bp-comment${c.is_official ? ' is-official' : ''}`}>
            {c.author_image && !c.is_official ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="bp-avatar" src={c.author_image} alt="" referrerPolicy="no-referrer" />
            ) : (
              <span className="bp-avatar" aria-hidden="true">
                {c.is_official ? '0' : name.slice(0, 1).toUpperCase()}
              </span>
            )}
            <div>
              <p className="bp-comment-head">
                <strong>{name}</strong>
                {c.is_official === 1 && c.author_name && <span className="bp-comment-tag">{c.author_name}</span>}
                {c.pinned === 1 && <span className="bp-comment-pin">{labels.pinned}</span>}
                <time className="bp-hint" dateTime={c.created_at}>
                  {new Date(c.created_at).toLocaleDateString(locale, { dateStyle: 'medium', timeZone: 'UTC' })}
                </time>
              </p>
              <div className="bp-comment-body" dangerouslySetInnerHTML={{ __html: c.body }} />
              {(isAdmin || (personId && c.user_id === personId)) && (
                <div className="bp-comment-actions">
                  {isAdmin && (
                    <>
                      <button type="button" className="bp-link-btn" onClick={() => moderate(c.id, { pinned: c.pinned !== 1 })}>
                        {c.pinned === 1 ? labels.unpin : labels.pin}
                      </button>
                      <button
                        type="button"
                        className="bp-link-btn"
                        onClick={() => moderate(c.id, { official: c.is_official !== 1 })}
                      >
                        {c.is_official === 1 ? labels.unmarkOfficial : labels.markOfficial}
                      </button>
                    </>
                  )}
                  <button type="button" className="bp-link-btn" onClick={() => remove(c.id)}>
                    {labels.delete}
                  </button>
                </div>
              )}
            </div>
          </article>
        );
      })}

      {personId ? (
        <form className="bp-comment-form" onSubmit={submit}>
          <textarea
            className="textarea"
            rows={4}
            maxLength={4000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={labels.placeholder}
            aria-label={labels.placeholder}
          />
          <div className="bp-hp" aria-hidden="true">
            <label>
              Website
              <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </label>
          </div>
          <div className="bp-comment-form-row">
            <button type="submit" className="btn btn-solid btn-small" disabled={busy || !body.trim()}>
              {busy ? labels.sending : labels.send}
            </button>
            {isAdmin && (
              <label className="bp-check">
                <input type="checkbox" checked={official} onChange={(e) => setOfficial(e.target.checked)} />
                {labels.postOfficial}
              </label>
            )}
            <span className="bp-hint">{labels.markdownHint}</span>
          </div>
          {error && (
            <p className="bp-error" role="alert">
              {error}
            </p>
          )}
        </form>
      ) : (
        <p className="bp-comment-login">
          <a className="btn btn-ghost btn-small" href={loginHref}>
            {labels.loginToComment}
          </a>
        </p>
      )}
    </section>
  );
}
