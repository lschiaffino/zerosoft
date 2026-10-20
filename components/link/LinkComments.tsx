'use client';

import { useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { LinkCommentDto } from '@/lib/link-comments';
import { formatDateTime } from '@/lib/utils';

interface LinkCommentsProps {
  linkId: string;
  initial: LinkCommentDto[];
  /** Id real de quien mira: puede borrar los suyos. */
  viewerId: string;
  /** Los admins borran cualquiera. */
  isAdmin: boolean;
}

/** Notas internas del equipo sobre el link: un hilo simple, del más viejo al más nuevo. */
export default function LinkComments({ linkId, initial, viewerId, isAdmin }: LinkCommentsProps) {
  const t = useTranslations('link');
  const locale = useLocale();
  const [comments, setComments] = useState(initial);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!body.trim() || busy) return;
    setBusy('add');
    setError(null);
    const res = await fetch(`/api/links/${linkId}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: body.trim() }),
    }).catch(() => null);
    setBusy(null);
    if (res?.status === 201) {
      const created = (await res.json()) as LinkCommentDto;
      setComments((prev) => [...prev, created]);
      setBody('');
    } else {
      setError(t('errors.generic'));
    }
  }

  async function remove(c: LinkCommentDto) {
    if (!window.confirm(t('comments.removeConfirm'))) return;
    setBusy(c.id);
    setError(null);
    const res = await fetch(`/api/links/${linkId}/comments/${c.id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(null);
    if (res?.status === 204) setComments((prev) => prev.filter((x) => x.id !== c.id));
    else setError(t(res?.status === 403 ? 'errors.forbidden' : 'errors.generic'));
  }

  return (
    <section className="lk-block lk-comments" aria-labelledby="lk-comments-title">
      <div className="lk-panel-head">
        <h2 className="lk-h" id="lk-comments-title">
          {t('comments.title')}
        </h2>
      </div>
      <p className="ui-help">{t('comments.help')}</p>

      {comments.length === 0 ? (
        <p className="lk-empty-line">{t('comments.empty')}</p>
      ) : (
        <ol className="lk-comment-list">
          {comments.map((c) => (
            <li key={c.id} className="lk-comment">
              <div className="lk-comment-head">
                <span className="lk-comment-author">{c.authorName || t('comments.unknownAuthor')}</span>
                <time className="data lk-comment-time" dateTime={c.createdAt}>
                  {formatDateTime(c.createdAt, locale)}
                </time>
                {(c.authorId === viewerId || isAdmin) && (
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost btn-danger lk-comment-remove"
                    onClick={() => remove(c)}
                    disabled={busy !== null}
                    aria-busy={busy === c.id || undefined}
                  >
                    {t('common.delete')}
                  </button>
                )}
              </div>
              <p className="lk-comment-body">{c.body}</p>
            </li>
          ))}
        </ol>
      )}

      <form className="lk-comment-form" onSubmit={add}>
        <label className="sr-only" htmlFor="lk-comment-input">
          {t('comments.label')}
        </label>
        <textarea
          id="lk-comment-input"
          className="textarea"
          rows={3}
          maxLength={2000 /* MAX_COMMENT_LENGTH de lib/link-comments.ts */}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t('comments.placeholder')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="lk-comment-foot">
          {error ? (
            <p className="ui-error" role="alert">
              {error}
            </p>
          ) : (
            <span />
          )}
          <button type="submit" className="btn btn-primary btn-sm" disabled={!body.trim() || busy !== null} aria-busy={busy === 'add' || undefined}>
            {t('comments.add')}
          </button>
        </div>
      </form>
    </section>
  );
}
