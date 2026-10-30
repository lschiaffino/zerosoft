'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import type { PostDto, PostEvent } from '@/lib/social';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { api, fmtDateTime, fmtNum, NetworkTag, StatusTag, useErrorText, useToast } from './shared';

/**
 * Una publicación: estado por cuenta con el link a lo publicado, el error de
 * la red y reintentar, métricas, la aprobación (aprobar o rechazar con
 * comentario) y el historial.
 */
export default function PostDetail({ post, events }: { post: PostDto; events: PostEvent[] }) {
  const t = useTranslations('social.post');
  const tEv = useTranslations('social.events');
  const tErr = useTranslations('social.publishErrors');
  const locale = useLocale();
  const router = useRouter();
  const errorText = useErrorText();
  const [toast, showToast] = useToast();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const movable = post.canEdit && ['draft', 'scheduled', 'pending_approval', 'rejected'].includes(post.status);
  const [when, setWhen] = useState(() => {
    if (!post.scheduledAt) return '';
    const d = new Date(post.scheduledAt);
    const p2 = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
  });

  /** Reprogramar sin arrastrar (teclado): misma regla que el calendario. */
  async function reschedule() {
    if (!when) return;
    setBusy('reschedule');
    try {
      await api(`/posts/${post.id}`, { method: 'PATCH', json: { scheduledAt: new Date(when).toISOString() } });
      showToast(t('done_reschedule'));
      router.refresh();
    } catch (err) {
      showToast(errorText(err), true);
    } finally {
      setBusy(null);
    }
  }

  async function act(action: 'approve' | 'reject' | 'retry', extra: Record<string, string> = {}) {
    setBusy(action + (extra.targetId ?? ''));
    try {
      await api(`/posts/${post.id}`, { method: 'POST', json: { action, ...extra } });
      showToast(t(`done_${action}`));
      setComment('');
      router.refresh();
    } catch (err) {
      showToast(errorText(err), true);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy('delete');
    try {
      await api(`/posts/${post.id}`, { method: 'DELETE' });
      router.push('/app/social/posts');
      router.refresh();
    } catch (err) {
      showToast(errorText(err), true);
      setBusy(null);
      setConfirmDelete(false);
    }
  }

  return (
    <div className="sc-detail">
      <div className="sc-page">
        <section className="sc-panel">
          <div className="sc-row">
            <StatusTag status={post.status} />
            <span className="sc-muted sc-grow">
              {post.publishedAt
                ? t('publishedAt', { when: fmtDateTime(post.publishedAt, locale) })
                : post.scheduledAt
                  ? t('scheduledFor', { when: fmtDateTime(post.scheduledAt, locale) })
                  : t('noDate')}
            </span>
            {post.canEdit && (
              <Link className="btn btn-sm" href={`/app/social/posts/${post.id}?edit=1`} data-testid="post-edit">
                {t('edit')}
              </Link>
            )}
          </div>
          {movable && (
            <form
              className="sc-row"
              onSubmit={(e) => {
                e.preventDefault();
                void reschedule();
              }}
            >
              <label className="ui-field sc-grow">
                <span className="label">{t('rescheduleLabel')}</span>
                <input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} data-testid="post-reschedule-at" />
              </label>
              <button type="submit" className="btn btn-sm" disabled={!when || busy === 'reschedule'} aria-busy={busy === 'reschedule'} data-testid="post-reschedule">
                {t('reschedule')}
              </button>
            </form>
          )}
          <p className="sc-preview-text" data-testid="post-text">
            {post.text || t('mediaOnly')}
          </p>
          {post.media.length > 0 && (
            <div className="sc-media">
              {post.media.map((m) => (
                <div key={m.url} className="sc-thumb">
                  {m.type === 'video' ? (
                    <video src={m.url} muted preload="metadata" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.url} alt={m.name ?? ''} />
                  )}
                </div>
              ))}
            </div>
          )}
          {post.firstComment && <p className="sc-muted sc-small">{t('firstComment', { text: post.firstComment })}</p>}
          <p className="sc-muted sc-small">{t('by', { name: post.createdByName ?? '' })}</p>
        </section>

        {post.canApprove && (
          <section className="sc-panel" aria-labelledby="sc-approve-title">
            <h2 id="sc-approve-title">{t('approvalTitle')}</h2>
            <label className="ui-field">
              <span className="label">{t('approvalComment')}</span>
              <textarea className="textarea" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} data-testid="approval-comment" />
            </label>
            <div className="sc-actions">
              <button
                type="button"
                className="btn btn-danger"
                disabled={!comment.trim() || Boolean(busy)}
                aria-busy={busy === 'reject'}
                onClick={() => void act('reject', { comment })}
                title={!comment.trim() ? t('rejectNeedsComment') : undefined}
              >
                {t('reject')}
              </button>
              <button type="button" className="btn btn-primary" disabled={Boolean(busy)} aria-busy={busy === 'approve'} onClick={() => void act('approve', comment.trim() ? { comment } : {})}>
                {t('approve')}
              </button>
            </div>
          </section>
        )}

        {post.approval?.comment && (
          <section className="sc-panel" data-testid="approval-note">
            <h2>{post.status === 'rejected' ? t('rejectedBy', { name: post.approval.byName ?? '' }) : t('approvedBy', { name: post.approval.byName ?? '' })}</h2>
            <p className="sc-preview-text">{post.approval.comment}</p>
          </section>
        )}

        <section aria-labelledby="sc-targets-title" className="sc-page">
          <h2 id="sc-targets-title" className="sc-small">
            {t('accounts')}
          </h2>
          <div className="sc-targets">
            {post.targets.map((tg) => (
              <div key={tg.id} className="sc-target" data-testid="post-target">
                <div className="sc-row">
                  {tg.account ? <NetworkTag network={tg.account.network} name={tg.account.networkName} /> : null}
                  <strong className="sc-grow">{tg.account?.name ?? t('disconnected')}</strong>
                  <StatusTag status={tg.status} />
                </div>
                {tg.textOverride && <p className="sc-muted sc-small">{t('customText', { text: tg.textOverride.slice(0, 200) })}</p>}
                {tg.externalUrl && (
                  <a href={tg.externalUrl} target="_blank" rel="noopener noreferrer" data-testid="live-link">
                    {t('viewLive')}
                  </a>
                )}
                {tg.status === 'retry' && tg.nextAttemptAt && <p className="sc-muted sc-small">{t('retrying', { n: tg.attempts, when: fmtDateTime(tg.nextAttemptAt, locale) })}</p>}
                {tg.errorCode && (
                  <p className="sc-error" data-testid="target-error">
                    {tErr.has(tg.errorCode) ? tErr(tg.errorCode) : tErr('generic')}
                    {tg.errorMessage ? `: ${tg.errorMessage}` : ''}
                  </p>
                )}
                {tg.commentStatus === 'failed' && <p className="sc-error sc-small">{t('commentFailed')}</p>}
                {tg.status === 'failed' && (
                  <div>
                    <button type="button" className="btn btn-sm" aria-busy={busy === `retry${tg.id}`} disabled={Boolean(busy)} onClick={() => void act('retry', { targetId: tg.id })}>
                      {t('retry')}
                    </button>
                  </div>
                )}
                {tg.status === 'published' && tg.metrics.at && (
                  <div className="sc-metrics" data-testid="target-metrics">
                    <span>
                      {t('m_impressions')} <b>{fmtNum(tg.metrics.impressions, locale)}</b>
                    </span>
                    <span>
                      {t('m_engagement')} <b>{fmtNum(tg.metrics.engagement, locale)}</b>
                    </span>
                    <span>
                      {t('m_likes')} <b>{fmtNum(tg.metrics.likes, locale)}</b>
                    </span>
                    <span>
                      {t('m_comments')} <b>{fmtNum(tg.metrics.comments, locale)}</b>
                    </span>
                    <span>
                      {t('m_shares')} <b>{fmtNum(tg.metrics.shares, locale)}</b>
                    </span>
                    <span>
                      {t('m_clicks')} <b>{fmtNum(tg.metrics.clicks, locale)}</b>
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>

      <aside className="sc-page">
        <section className="sc-panel">
          <h2>{t('history')}</h2>
          <ol className="sc-events">
            {events.map((e) => (
              <li key={e.id}>
                <span>
                  {tEv.has(e.kind) ? tEv(e.kind, { name: e.personName ?? '' }) : e.kind}
                  {e.body && (e.kind === 'approved' || e.kind === 'rejected') ? `: ${e.body}` : ''}
                </span>
                <span className="sc-muted sc-small">{fmtDateTime(e.createdAt, locale)}</span>
              </li>
            ))}
          </ol>
        </section>
        {(post.canEdit || post.status === 'published' || post.status === 'failed' || post.status === 'partial') && (
          <button type="button" className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(true)} data-testid="post-delete">
            {t('delete')}
          </button>
        )}
      </aside>
      <ConfirmDialog
        open={confirmDelete}
        title={t('deleteTitle')}
        body={post.status === 'published' || post.status === 'partial' ? t('deleteBodyPublished') : t('deleteBody')}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        danger
        busy={busy === 'delete'}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
      {toast}
    </div>
  );
}
