'use client';

import { useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import type { FeedbackRow } from '@/lib/feedback';
import type { FeedbackStatus } from '@/lib/feedback-constants';
import { formatDateTime } from '@/lib/utils';

const PRODUCT_COLOR: Record<string, string> = {
  link: 'var(--c-link)',
  crm: 'var(--c-crm)',
  cal: 'var(--c-cal)',
  track: 'var(--c-track)',
  chat: 'var(--c-chat)',
  docs: 'var(--c-docs)',
};

const KIND_COLOR: Record<string, string> = { idea: 'var(--warn)', bug: 'var(--bad)', other: 'var(--dim)' };

/** Lista del owner: marcar leído / hecho / reabrir (PATCH /api/feedback/:id). */
export default function FeedbackAdminList({ initial, locale }: { initial: FeedbackRow[]; locale: string }) {
  const t = useTranslations('feedback');
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);

  async function setStatus(id: string, status: FeedbackStatus) {
    setBusy(id);
    const res = await fetch(`/api/feedback/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    }).catch(() => null);
    if (res?.ok) setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    setBusy(null);
  }

  return (
    <div className="fb-admin-list">
      {rows.map((r) => (
        <article key={r.id} className={`fb-admin-row${r.status === 'new' ? ' is-new' : ''}`}>
          <div className="fb-admin-meta">
            <span className="fb-admin-tag" style={{ '--dot': KIND_COLOR[r.kind] } as CSSProperties}>
              <i />
              {t(`form.kind.${r.kind}`)}
            </span>
            <span className="fb-admin-tag" style={{ '--dot': PRODUCT_COLOR[r.product] ?? 'var(--line)' } as CSSProperties}>
              <i />
              {t(`form.product.${r.product}`)}
            </span>
            <span>{r.email ?? t('admin.anonymous')}</span>
            <span>{formatDateTime(r.created_at, locale)}</span>
            <span className="badge">{t(`admin.status.${r.status}`)}</span>
          </div>
          <p className="fb-admin-msg">{r.message}</p>
          {r.page_url && (
            <p className="fb-admin-meta">
              {t('admin.openPage')}:{' '}
              <a className="fb-admin-url" href={r.page_url} target="_blank" rel="noreferrer noopener">
                {r.page_url}
              </a>
            </p>
          )}
          <div className="fb-admin-actions">
            {r.status === 'new' && (
              <button type="button" className="btn btn-ghost" disabled={busy === r.id} onClick={() => setStatus(r.id, 'read')}>
                {t('admin.markRead')}
              </button>
            )}
            {r.status !== 'done' ? (
              <button type="button" className="btn btn-solid" disabled={busy === r.id} onClick={() => setStatus(r.id, 'done')}>
                {t('admin.markDone')}
              </button>
            ) : (
              <button type="button" className="btn btn-ghost" disabled={busy === r.id} onClick={() => setStatus(r.id, 'new')}>
                {t('admin.reopen')}
              </button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
