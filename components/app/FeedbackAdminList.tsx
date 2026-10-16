'use client';

import { useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import type { FeedbackRow } from '@/lib/feedback';
import type { FeedbackStatus } from '@/lib/feedback-constants';
import { productColor } from '@/lib/product-taxonomy';
import { formatDateTime } from '@/lib/utils';

const KIND_COLOR: Record<string, string> = { idea: 'var(--warn)', bug: 'var(--bad)', other: 'var(--dim)' };

interface Target {
  id: string;
  title: string;
}

/**
 * Lista del owner: marcar leído / hecho / reabrir (PATCH /api/feedback/:id) y
 * "Promover a ítem": adjuntar a un ítem del roadmap o crear uno nuevo
 * (POST /api/feedback/:id/promote).
 */
export default function FeedbackAdminList({
  initial,
  locale,
  targets = [],
  linked = {},
}: {
  initial: FeedbackRow[];
  locale: string;
  targets?: Target[];
  linked?: Record<string, Target>;
}) {
  const t = useTranslations('feedback');
  const tp = useTranslations('feedbackBoard.product');
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [links, setLinks] = useState<Record<string, Target>>(linked);
  const [items, setItems] = useState<Target[]>(targets);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<string | null>(null);

  async function promote(row: FeedbackRow, body: unknown) {
    setBusy(row.id);
    setFailed(null);
    const res = await fetch(`/api/feedback/${row.id}/promote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    const data = res?.ok ? ((await res.json().catch(() => null)) as { item?: Target } | null) : null;
    if (data?.item) {
      const item = { id: data.item.id, title: data.item.title };
      setLinks((prev) => ({ ...prev, [row.id]: item }));
      setItems((prev) => (prev.some((x) => x.id === item.id) ? prev : [item, ...prev]));
      setRows((prev) => prev.map((r) => (r.id === row.id && r.status === 'new' ? { ...r, status: 'read' } : r)));
    } else {
      setFailed(row.id);
    }
    setBusy(null);
  }

  function createFrom(row: FeedbackRow) {
    const suggested = row.message.replace(/\s+/g, ' ').trim().slice(0, 80);
    const title = window.prompt(t('admin.promoteTitle'), suggested);
    if (!title?.trim()) return;
    void promote(row, {
      create: {
        title: title.trim(),
        description: row.message.slice(0, 4000),
        product: row.product,
        kind: row.kind === 'bug' ? 'bug' : 'idea',
        status: 'idea',
        isPublic: true,
      },
    });
  }

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
            <span className="fb-admin-tag" style={{ '--dot': productColor(r.product) } as CSSProperties}>
              <i />
              {tp(r.product)}
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
          {links[r.id] && (
            <p className="fb-linked">
              {t('admin.linkedTo')}: <a href={`/${locale}/feedback-board/i/${links[r.id].id}`}>{links[r.id].title}</a>
            </p>
          )}
          <div className="fb-promote">
            <select
              className="select"
              value={pick[r.id] ?? ''}
              onChange={(e) => setPick((prev) => ({ ...prev, [r.id]: e.target.value }))}
              aria-label={t('admin.promoteAttach')}
            >
              <option value="">{t('admin.promoteAttach')}</option>
              {items.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.title}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-ghost btn-small"
              disabled={busy === r.id || !pick[r.id]}
              onClick={() => promote(r, { itemId: pick[r.id] })}
            >
              {t('admin.attach')}
            </button>
            <button type="button" className="btn btn-ghost btn-small" disabled={busy === r.id} onClick={() => createFrom(r)}>
              {t('admin.promoteNew')}
            </button>
            {failed === r.id && <span className="rm-admin-status is-error">{t('admin.promoteError')}</span>}
          </div>
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
