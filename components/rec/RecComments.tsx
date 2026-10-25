'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { REC_REACTIONS, fmtClock } from '@/lib/rec-schema';
import { parseDbUtc } from '@/lib/utils';
import type { RecMarker } from './RecPlayer';

export interface RecComment {
  id: string;
  parentId: string | null;
  kind: 'comment' | 'reaction';
  body: string;
  emoji: string | null;
  atSec: number | null;
  authorName: string;
  guest: boolean;
  byAuthor: boolean;
  mine: boolean;
  createdAt: string;
}

interface Me {
  name: string;
  signedIn: boolean;
  canModerate: boolean;
  requireAccount: boolean;
}

const NAME_KEY = 'rec_viewer_name';

export function storedViewerName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function storeViewerName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* modo privado */
  }
}

/**
 * Comentarios y reacciones con el segundo del video (como Loom): la marca
 * sale en la línea de tiempo del reproductor y un clic lleva a ese momento.
 * Sin login se comenta con un nombre (queda guardado en el navegador).
 */
export default function RecComments({
  shareId,
  trimStart,
  allowComments,
  canModerate = false,
  currentAbs,
  onSeek,
  onMarkers,
}: {
  shareId: string;
  trimStart: number;
  allowComments: boolean;
  canModerate?: boolean;
  /** Segundo actual del video (sin recorte). */
  currentAbs: () => number;
  onSeek: (relSec: number) => void;
  onMarkers?: (m: RecMarker[]) => void;
}) {
  const t = useTranslations('rec.comments');
  const locale = useLocale();
  const base = `/api/rec/v/${encodeURIComponent(shareId)}/comments`;
  const [items, setItems] = useState<RecComment[] | null>(null);
  const [me, setMe] = useState<Me>({ name: '', signedIn: false, canModerate: false, requireAccount: false });
  const [reactionCounts, setReactionCounts] = useState<Record<string, number>>({});
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [atNow, setAtNow] = useState(true);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, force] = useState(0);

  type Page = { comments: RecComment[]; reactions: Record<string, number>; reactionMarks: RecComment[]; nextBefore: string | null; total: number; me: Me };
  const load = useCallback(
    async (before?: string) => {
      const res = await fetch(before ? `${base}?before=${encodeURIComponent(before)}` : base).catch(() => null);
      if (!res?.ok) {
        setError(t('errors.load'));
        setItems((prev) => prev ?? []);
        return;
      }
      const data = (await res.json()) as Page;
      setItems((prev) => (before ? [...(prev ?? []), ...data.comments] : [...data.comments, ...data.reactionMarks]));
      setReactionCounts(data.reactions);
      setNextBefore(data.nextBefore);
      setTotal(data.total);
      setMe(data.me);
    },
    [base, t],
  );

  useEffect(() => {
    setName(storedViewerName());
    void load();
    // El tiempo del checkbox "en 0:42" se refresca mientras se mira.
    const id = window.setInterval(() => force((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!items || !onMarkers) return;
    onMarkers(
      items
        .filter((c) => c.atSec !== null && !c.parentId)
        .map((c) => ({ id: c.id, atSec: c.atSec as number, emoji: c.kind === 'reaction' ? c.emoji : null, label: c.kind === 'reaction' ? `${c.authorName} ${c.emoji}` : `${c.authorName}: ${c.body.slice(0, 60)}` })),
    );
  }, [items, onMarkers]);

  const errorText = (code: string) => (t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'));

  async function post(payload: Record<string, unknown>): Promise<boolean> {
    setError(null);
    const who = me.signedIn ? undefined : name.trim();
    if (!me.signedIn && !who) {
      setError(t('errors.name_required'));
      return false;
    }
    if (who) storeViewerName(who);
    setBusy(true);
    const res = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, name: who }) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const code = ((await res?.json().catch(() => null)) as { error?: string } | null)?.error ?? 'generic';
      setError(errorText(code));
      return false;
    }
    const { comment } = (await res.json()) as { comment: RecComment };
    setItems((prev) => [...(prev ?? []), comment]);
    if (comment.kind === 'reaction' && comment.emoji) setReactionCounts((c) => ({ ...c, [comment.emoji!]: (c[comment.emoji!] ?? 0) + 1 }));
    else if (!comment.parentId) setTotal((n) => n + 1);
    return true;
  }

  async function react(emoji: string) {
    await post({ kind: 'reaction', emoji, atSec: currentAbs() });
  }

  async function submit() {
    const text = body.trim();
    if (!text) return;
    if (await post({ kind: 'comment', body: text, atSec: atNow ? currentAbs() : null })) setBody('');
  }

  async function reply(parentId: string) {
    const text = replyBody.trim();
    if (!text) return;
    if (await post({ kind: 'comment', body: text, parentId })) {
      setReplyBody('');
      setReplyTo(null);
    }
  }

  async function remove(id: string) {
    const res = await fetch(`${base}/${id}`, { method: 'DELETE' }).catch(() => null);
    if (res?.status === 204) setItems((prev) => (prev ?? []).filter((c) => c.id !== id && c.parentId !== id));
    else setError(t('errors.generic'));
  }

  const comments = useMemo(() => (items ?? []).filter((c) => c.kind === 'comment' && !c.parentId).sort((a, b) => (a.atSec ?? Infinity) - (b.atSec ?? Infinity) || a.createdAt.localeCompare(b.createdAt)), [items]);
  const replies = useMemo(() => {
    const m = new Map<string, RecComment[]>();
    for (const c of items ?? []) if (c.parentId) m.set(c.parentId, [...(m.get(c.parentId) ?? []), c]);
    return m;
  }, [items]);
  const counts = useMemo(() => new Map(Object.entries(reactionCounts)), [reactionCounts]);
  const moderator = canModerate || me.canModerate;
  const formOpen = allowComments && (me.signedIn || !me.requireAccount);

  const rel = (abs: number) => Math.max(0, abs - trimStart);
  const when = (d: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(parseDbUtc(d));

  return (
    <section className="rec-comments" aria-label={t('title')} data-testid="rec-comments">
      {formOpen && (
        <div className="rec-reactions" role="group" aria-label={t('react')}>
          {REC_REACTIONS.map((e) => (
            <button key={e} type="button" className="rec-reaction" onClick={() => void react(e)} disabled={busy} aria-label={t('reactWith', { emoji: e })}>
              <span aria-hidden="true">{e}</span>
              {counts.get(e) ? <span className="rec-reaction-n data">{counts.get(e)}</span> : null}
            </button>
          ))}
        </div>
      )}
      {items === null ? (
        <div className="ui-skeleton-text" aria-busy="true" aria-label={t('loading')} />
      ) : comments.length === 0 ? (
        <p className="ui-help rec-comments-empty">{allowComments ? t('empty') : t('off')}</p>
      ) : (
        <ol className="rec-comment-list">
          {comments.map((c) => (
            <li key={c.id} className="rec-comment" data-testid="rec-comment">
              <div className="rec-comment-head">
                <strong>{c.authorName}</strong>
                {c.guest && <span className="rec-badge">{t('guest')}</span>}
                {c.byAuthor && <span className="rec-badge author">{t('authorBadge')}</span>}
                {c.atSec !== null && (
                  <button type="button" className="rec-time-link data" onClick={() => onSeek(rel(c.atSec as number))} aria-label={t('jumpTo', { time: fmtClock(rel(c.atSec as number)) })}>
                    {fmtClock(rel(c.atSec as number))}
                  </button>
                )}
                <span className="muted rec-comment-date">{when(c.createdAt)}</span>
              </div>
              <p className="rec-comment-body">{c.body}</p>
              <div className="rec-comment-actions">
                {formOpen && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReplyTo(replyTo === c.id ? null : c.id)}>
                    {t('reply')}
                  </button>
                )}
                {(c.mine || moderator) && (
                  <button type="button" className="btn btn-ghost btn-danger btn-sm" onClick={() => void remove(c.id)}>
                    {t('delete')}
                  </button>
                )}
              </div>
              {(replies.get(c.id) ?? []).length > 0 && (
                <ol className="rec-replies">
                  {(replies.get(c.id) ?? []).map((r) => (
                    <li key={r.id} className="rec-comment rec-reply">
                      <div className="rec-comment-head">
                        <strong>{r.authorName}</strong>
                        {r.guest && <span className="rec-badge">{t('guest')}</span>}
                        {r.byAuthor && <span className="rec-badge author">{t('authorBadge')}</span>}
                        <span className="muted rec-comment-date">{when(r.createdAt)}</span>
                      </div>
                      <p className="rec-comment-body">{r.body}</p>
                      {(r.mine || moderator) && (
                        <button type="button" className="btn btn-ghost btn-danger btn-sm" onClick={() => void remove(r.id)}>
                          {t('delete')}
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
              )}
              {replyTo === c.id && (
                <form
                  className="rec-reply-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void reply(c.id);
                  }}
                >
                  <textarea
                    className="textarea"
                    rows={2}
                    value={replyBody}
                    autoFocus
                    onChange={(e) => setReplyBody(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setReplyTo(null);
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        void reply(c.id);
                      }
                    }}
                    aria-label={t('replyLabel')}
                    maxLength={4000}
                  />
                  <button type="submit" className="btn btn-secondary btn-sm" disabled={busy || !replyBody.trim()}>
                    {t('send')}
                  </button>
                </form>
              )}
            </li>
          ))}
        </ol>
      )}
      {nextBefore && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load(nextBefore)} data-testid="rec-comments-more">
          {t('more', { shown: comments.length, total })}
        </button>
      )}
      {allowComments && !formOpen && (
        <p className="ui-help" data-testid="rec-comments-signin">
          {t('signinToComment')}
        </p>
      )}
      {formOpen && (
        <form
          className="rec-comment-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {!me.signedIn && (
            <div className="ui-field">
              <label className="label" htmlFor="rec-name">
                {t('yourName')}
              </label>
              <input id="rec-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" />
            </div>
          )}
          <div className="ui-field">
            <label className="label" htmlFor="rec-comment">
              {t('add')}
            </label>
            <textarea
              id="rec-comment"
              className="textarea"
              rows={3}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void submit();
                }
              }}
              maxLength={4000}
              placeholder={t('placeholder')}
            />
          </div>
          <div className="rec-comment-foot">
            <label className="ui-check">
              <input type="checkbox" checked={atNow} onChange={(e) => setAtNow(e.target.checked)} />
              <span>{t('atTime', { time: fmtClock(rel(currentAbs())) })}</span>
            </label>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !body.trim()} data-testid="rec-comment-send">
              {t('send')}
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
