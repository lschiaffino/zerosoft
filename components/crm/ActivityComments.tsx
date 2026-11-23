'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Mentionable } from '@/lib/crm-mentions';
import { COMMENT_MAX } from '@/lib/crm-note-format';
import { parseDbUtc } from '@/lib/utils';
import LocalText from '@/components/ui/LocalText';
import { useMounted } from '@/components/ui/useMounted';
import CrmIcon from './CrmIcon';
import TimelineMenu from './TimelineMenu';
import NoteEditor, { RichNoteBody } from './RichNote';
import { relativeTime } from './timelineModel';

interface Comment {
  id: string;
  author_id: string;
  author_name: string | null;
  body: string;
  edited: 0 | 1;
  created_at: string;
}

interface Reply {
  error?: string;
  mentions_not_notified?: Array<{ id: string; name: string }>;
}

/**
 * Hilo de comentarios de una actividad del timeline, como "Add comment" de
 * HubSpot: la cantidad, abrir y cerrar, comentar con formato y @menciones, y
 * editar o borrar los propios. Se carga al abrirlo (GET
 * /api/crm/activities/:id/comments). El server decide quién lo ve: el que
 * no ve la actividad recibe 404 y acá queda el error.
 */
export default function ActivityComments({
  activityId,
  initialCount,
  people,
  locale,
}: {
  activityId: string;
  /** Cantidad que trajo el timeline (sin dato: se muestra "Comentar"). */
  initialCount?: number;
  people: Mentionable[];
  locale: string;
}) {
  const t = useTranslations('crm.comments');
  const tm = useTranslations('crm.mentions');
  const tc = useTranslations('crm.common');
  const mounted = useMounted();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(initialCount ?? 0);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [me, setMe] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (initialCount !== undefined) setCount(initialCount);
  }, [initialCount]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    const res = await fetch(`/api/crm/activities/${encodeURIComponent(activityId)}/comments`).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { comments?: Comment[]; me?: string } | null;
    setLoading(false);
    if (!res?.ok || !data?.comments) {
      setLoadError(true);
      return;
    }
    setComments(data.comments);
    setMe(data.me ?? '');
    setCount(data.comments.length);
  }, [activityId]);

  function toggle() {
    const next = !open;
    setOpen(next);
    setError(null);
    setNotice(null);
    if (next && comments === null) void load();
  }

  function errorText(code?: string): string {
    if (code === 'too_many_comments') return t('tooMany');
    return t('saveError');
  }

  function noticeFrom(reply: Reply | null) {
    const names = (reply?.mentions_not_notified ?? []).map((m) => m.name).filter(Boolean);
    setNotice(names.length ? tm('notNotified', { names: names.join(', '), count: names.length }) : null);
  }

  const tooLong = draft.length > COMMENT_MAX;
  const canPost = !posting && draft.trim() !== '' && !tooLong;

  async function post() {
    if (!canPost) return;
    setPosting(true);
    setError(null);
    const res = await fetch(`/api/crm/activities/${encodeURIComponent(activityId)}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: draft.trim() }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as (Comment & Reply) | null;
    setPosting(false);
    if (!res?.ok || !data?.id) {
      setError(errorText(data?.error));
      return;
    }
    setComments((c) => [...(c ?? []), data]);
    setCount((n) => n + 1);
    setDraft('');
    noticeFrom(data);
  }

  async function saveEdit(c: Comment) {
    if (!editDraft.trim() || editDraft.length > COMMENT_MAX) return;
    setBusyId(c.id);
    setError(null);
    const res = await fetch(`/api/crm/activities/${encodeURIComponent(activityId)}/comments/${encodeURIComponent(c.id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: editDraft.trim() }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as (Comment & Reply) | null;
    setBusyId(null);
    if (!res?.ok || !data?.id) {
      setError(errorText(data?.error));
      return;
    }
    setComments((list) => (list ?? []).map((x) => (x.id === c.id ? data : x)));
    setEditingId(null);
    noticeFrom(data);
  }

  async function remove(c: Comment) {
    setBusyId(c.id);
    setError(null);
    const res = await fetch(`/api/crm/activities/${encodeURIComponent(activityId)}/comments/${encodeURIComponent(c.id)}`, {
      method: 'DELETE',
    }).catch(() => null);
    setBusyId(null);
    setConfirmId(null);
    if (!res?.ok) {
      setError(t('deleteError'));
      return;
    }
    setComments((list) => (list ?? []).filter((x) => x.id !== c.id));
    setCount((n) => Math.max(0, n - 1));
  }

  const now = useMemo(() => new Date(), [comments]); // eslint-disable-line react-hooks/exhaustive-deps
  const when = (iso: string) => {
    const d = parseDbUtc(iso);
    return mounted ? relativeTime(d, now, locale) : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(d);
  };

  return (
    <div className="atl-comments" data-testid="timeline-comments">
      <button
        ref={toggleRef}
        type="button"
        className="atl-comments-toggle"
        aria-expanded={open}
        onClick={toggle}
        data-testid="timeline-comments-toggle"
      >
        <CrmIcon name="message" size={14} />
        <span>{count > 0 ? t('count', { count }) : t('add')}</span>
      </button>
      {open && (
        <div className="atl-comments-body">
          {loading && comments === null && <p className="muted atl-comments-status">{t('loading')}</p>}
          {loadError && (
            <p className="form-error atl-comments-status" role="alert">
              {t('loadError')}{' '}
              <button type="button" className="link-btn" onClick={() => void load()}>
                {t('retry')}
              </button>
            </p>
          )}
          {comments && comments.length > 0 && (
            <ol className="atl-comment-list" aria-label={t('listLabel')}>
              {comments.map((c) => (
                <li key={c.id} className={`atl-comment${busyId === c.id ? ' row-busy' : ''}`} data-testid="timeline-comment">
                  <div className="atl-comment-head">
                    <strong className="atl-comment-author">{c.author_name || '—'}</strong>
                    <time dateTime={c.created_at} title={mounted ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(parseDbUtc(c.created_at)) : undefined}>
                      <LocalText>{when(c.created_at)}</LocalText>
                    </time>
                    {c.edited ? <span className="muted atl-comment-edited">{t('edited')}</span> : null}
                    {c.author_id === me && editingId !== c.id && (
                      <TimelineMenu label={t('actions')} button={<CrmIcon name="more" />} buttonClassName="icon-btn atl-more" align="end" testId="timeline-comment-menu">
                        {(close) => (
                          <>
                            <button
                              type="button"
                              role="menuitem"
                              className="atl-menu-item"
                              onClick={() => {
                                close();
                                setConfirmId(null);
                                setEditingId(c.id);
                                setEditDraft(c.body);
                              }}
                            >
                              {tc('edit')}
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              className="atl-menu-item danger"
                              onClick={() => {
                                close();
                                setEditingId(null);
                                setConfirmId(c.id);
                              }}
                            >
                              {tc('delete')}
                            </button>
                          </>
                        )}
                      </TimelineMenu>
                    )}
                  </div>
                  {editingId === c.id ? (
                    <div className="atl-comment-edit">
                      <NoteEditor
                        value={editDraft}
                        onChange={setEditDraft}
                        people={people}
                        ariaLabel={t('editLabel')}
                        testId="timeline-comment-edit"
                        onSubmit={() => void saveEdit(c)}
                        onEscape={() => setEditingId(null)}
                        autoFocus
                        compact
                      />
                      <div className="form-actions">
                        <button type="button" className="btn btn-solid btn-small" disabled={busyId === c.id || !editDraft.trim()} onClick={() => void saveEdit(c)}>
                          {tc('save')}
                        </button>
                        <button type="button" className="btn btn-ghost btn-small" onClick={() => setEditingId(null)}>
                          {tc('cancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <RichNoteBody body={c.body} format="md" people={people} className="atl-comment-body" testId="timeline-comment-body" />
                  )}
                  {confirmId === c.id && (
                    <div className="atl-confirm" role="alertdialog" aria-label={t('deleteConfirm')}>
                      <span>{t('deleteConfirm')}</span>
                      <button type="button" className="btn btn-danger btn-small" onClick={() => void remove(c)} autoFocus>
                        {tc('delete')}
                      </button>
                      <button type="button" className="btn btn-ghost btn-small" onClick={() => setConfirmId(null)}>
                        {tc('cancel')}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
          {comments && (
            <div className="atl-comment-composer">
              <NoteEditor
                value={draft}
                onChange={setDraft}
                people={people}
                ariaLabel={t('composerLabel')}
                placeholder={people.length > 1 ? t('placeholderMention') : t('placeholder')}
                testId="timeline-comment-input"
                onSubmit={() => void post()}
                onEscape={() => {
                  setOpen(false);
                  toggleRef.current?.focus();
                }}
                compact
              />
              <div className="form-actions">
                <button type="button" className="btn btn-solid btn-small" disabled={!canPost} onClick={() => void post()} data-testid="timeline-comment-save">
                  {posting ? t('saving') : t('save')}
                </button>
              </div>
              {tooLong && <p className="form-error">{t('tooLong')}</p>}
            </div>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {notice && <p className="muted em-notice">{notice}</p>}
        </div>
      )}
    </div>
  );
}
