'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { DesignComment } from '@/lib/design';
import type { DesignDoc } from '@/lib/design-model';
import { G, Glyph } from './ui';

export interface Draft {
  pageId: string;
  x: number;
  y: number;
}

/**
 * Panel de comentarios (como Canva): hilos fijados en un punto de una página,
 * con respuestas, resolver/reabrir y borrar. Un hilo nuevo arranca al hacer
 * clic en el lienzo con la herramienta de comentar.
 */
export default function CommentsPanel({
  designId,
  doc,
  comments,
  activeId,
  setActiveId,
  draft,
  setDraft,
  onPosted,
  onChanged,
  onClose,
  goToPage,
  showResolved,
  setShowResolved,
  error,
}: {
  designId: string;
  doc: DesignDoc;
  comments: DesignComment[];
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  draft: Draft | null;
  setDraft: (d: Draft | null) => void;
  onPosted: (c: DesignComment) => void;
  onChanged: () => void;
  onClose: () => void;
  goToPage: (pageId: string) => void;
  showResolved: boolean;
  setShowResolved: (v: boolean) => void;
  error: string | null;
}) {
  const t = useTranslations('design.comments');
  const roots = comments.filter((c) => !c.parentId && (showResolved || !c.resolved));
  const replies = (id: string) => comments.filter((c) => c.parentId === id);
  const pageNo = (pageId: string) => doc.pages.findIndex((p) => p.id === pageId) + 1;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const post = async (body: string, extra: Record<string, unknown>) => {
    setBusy(true);
    setFailed(null);
    try {
      const r = await fetch(`/api/design/designs/${designId}/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body, ...extra }) });
      if (!r.ok) throw new Error('post');
      const d = (await r.json()) as { comment: DesignComment };
      onPosted(d.comment);
      return true;
    } catch {
      setFailed(t('error'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const act = async (id: string, method: 'PATCH' | 'DELETE', body?: Record<string, unknown>) => {
    setFailed(null);
    const r = await fetch(`/api/design/designs/${designId}/comments/${id}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).catch(() => null);
    if (!r?.ok) setFailed(t('error'));
    onChanged();
  };

  return (
    <aside className="dz-comments" aria-label={t('title')} data-testid="design-comments">
      <div className="dz-comments-head">
        <h2 className="dz-comments-title">{t('title')}</h2>
        <label className="ui-check dz-comments-resolved">
          <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
          <span>{t('showResolved')}</span>
        </label>
        <button type="button" className="btn btn-ghost btn-sm dz-tool" aria-label={t('close')} title={t('close')} onClick={onClose}>
          <Glyph d={G.close} />
        </button>
      </div>
      <p className="muted dz-side-note">{t('hint')}</p>
      {(error || failed) && (
        <p className="ui-error" role="alert">
          {failed ?? error}
        </p>
      )}
      {draft && (
        <Composer
          autoFocus
          label={t('newLabel', { page: pageNo(draft.pageId) })}
          placeholder={t('placeholder')}
          submit={t('post')}
          cancel={t('cancel')}
          busy={busy}
          onCancel={() => setDraft(null)}
          onSubmit={async (body) => {
            if (await post(body, { pageId: draft.pageId, x: draft.x, y: draft.y })) setDraft(null);
          }}
          testId="design-comment-new"
        />
      )}
      {!roots.length && !draft ? (
        <p className="muted dz-comments-empty">{t('empty')}</p>
      ) : (
        <ol className="dz-threads">
          {roots.map((c) => {
            const n = comments.filter((x) => !x.parentId).findIndex((x) => x.id === c.id) + 1;
            return (
              <li key={c.id} className={`dz-thread${activeId === c.id ? ' is-active' : ''}${c.resolved ? ' is-resolved' : ''}`} data-testid="design-thread">
                <button
                  type="button"
                  className="dz-thread-head"
                  onClick={() => {
                    setActiveId(c.id);
                    goToPage(c.pageId);
                  }}
                >
                  <span className="dz-thread-n">#{n}</span>
                  <span className="dz-thread-who">{c.authorName}</span>
                  <span className="dz-thread-page">{t('page', { n: pageNo(c.pageId) })}</span>
                </button>
                <p className="dz-thread-body">{c.body}</p>
                {replies(c.id).map((r) => (
                  <div key={r.id} className="dz-reply">
                    <span className="dz-thread-who">{r.authorName}</span>
                    <p className="dz-thread-body">{r.body}</p>
                    {r.mine && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void act(r.id, 'DELETE')}>
                        {t('delete')}
                      </button>
                    )}
                  </div>
                ))}
                <div className="dz-thread-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void act(c.id, 'PATCH', { resolved: !c.resolved })} data-testid="design-thread-resolve">
                    {c.resolved ? t('reopen') : t('resolve')}
                  </button>
                  {c.mine && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void act(c.id, 'DELETE')}>
                      {t('delete')}
                    </button>
                  )}
                </div>
                {activeId === c.id && !c.resolved && (
                  <Composer
                    label={t('replyLabel')}
                    placeholder={t('replyPlaceholder')}
                    submit={t('reply')}
                    busy={busy}
                    onSubmit={async (body) => {
                      await post(body, { pageId: c.pageId, x: c.x, y: c.y, parentId: c.id });
                    }}
                  />
                )}
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}

function Composer({
  label,
  placeholder,
  submit,
  cancel,
  busy,
  onSubmit,
  onCancel,
  autoFocus,
  testId,
}: {
  label: string;
  placeholder: string;
  submit: string;
  cancel?: string;
  busy: boolean;
  onSubmit: (body: string) => Promise<void>;
  onCancel?: () => void;
  autoFocus?: boolean;
  testId?: string;
}) {
  const [body, setBody] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  const send = async () => {
    const v = body.trim();
    if (!v || busy) return;
    await onSubmit(v);
    setBody('');
  };
  return (
    <form
      className="dz-composer"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
      data-testid={testId}
    >
      <label className="sr-only" htmlFor={`${testId ?? 'reply'}-ta`}>
        {label}
      </label>
      <textarea
        id={`${testId ?? 'reply'}-ta`}
        ref={ref}
        className="textarea"
        rows={2}
        maxLength={2000}
        placeholder={placeholder}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
          if (e.key === 'Escape' && onCancel) onCancel();
        }}
      />
      <div className="dz-composer-actions">
        {onCancel && cancel && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
            {cancel}
          </button>
        )}
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !body.trim()}>
          {submit}
        </button>
      </div>
    </form>
  );
}
