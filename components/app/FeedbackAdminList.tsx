'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { FeedbackRow } from '@/lib/feedback';
import type { FeedbackStatus } from '@/lib/feedback-constants';
import { formatDateTime } from '@/lib/utils';
import ProductTag from './ProductTag';

const KIND_BADGE: Record<string, string> = { idea: 'badge-warn', bug: 'badge-bad', other: '' };
const STATUS_BADGE: Record<string, string> = { new: 'badge-ink', read: 'badge-outline', done: 'badge-ok' };

interface Target {
  id: string;
  title: string;
}

/**
 * Lista del owner: marcar leído / hecho / reabrir (PATCH /api/feedback/:id) y
 * llevar al roadmap: adjuntar a un ítem o crear uno nuevo
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
  const ts = useTranslations('settings.admin');
  const tp = useTranslations('feedbackBoard.product');
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [links, setLinks] = useState<Record<string, Target>>(linked);
  const [items, setItems] = useState<Target[]>(targets);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<{ id: string; msg: string } | null>(null);

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
      setFailed({ id: row.id, msg: t('admin.promoteError') });
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
    setFailed(null);
    const res = await fetch(`/api/feedback/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    }).catch(() => null);
    if (res?.ok) setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    else setFailed({ id, msg: ts('actionError') });
    setBusy(null);
  }

  return (
    <ul className="st-fb-list">
      {rows.map((r) => {
        const pickId = `st-fb-pick-${r.id}`;
        return (
          <li key={r.id} className="st-fb" data-status={r.status}>
            <div className="st-fb-meta">
              <span className={`badge ${STATUS_BADGE[r.status] ?? ''}`}>{t(`admin.status.${r.status}`)}</span>
              <span className={`badge ${KIND_BADGE[r.kind] ?? ''}`}>{t(`form.kind.${r.kind}`)}</span>
              <ProductTag product={r.product} label={tp(r.product)} />
              <span className="st-fb-who">
                <span>{r.email ?? t('admin.anonymous')}</span>
                <span className="data">{formatDateTime(r.created_at, locale)}</span>
              </span>
            </div>
            <p className="st-fb-msg">{r.message}</p>
            {(r.page_url || links[r.id]) && (
              <p className="st-fb-refs">
                {r.page_url && (
                  <a className="st-inline-link data" href={r.page_url} target="_blank" rel="noreferrer noopener">
                    {r.page_url}
                  </a>
                )}
                {links[r.id] && (
                  <span>
                    {t('admin.linkedTo')}:{' '}
                    <a className="st-inline-link" href={`/${locale}/feedback-board/i/${links[r.id].id}`}>
                      {links[r.id].title}
                    </a>
                  </span>
                )}
              </p>
            )}
            <div className="st-fb-actions">
              <div className="st-fb-promote">
                <label className="sr-only" htmlFor={pickId}>
                  {t('admin.promoteAttach')}
                </label>
                <select
                  id={pickId}
                  className="select"
                  value={pick[r.id] ?? ''}
                  onChange={(e) => setPick((prev) => ({ ...prev, [r.id]: e.target.value }))}
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
                  className="btn btn-secondary btn-sm"
                  disabled={busy === r.id || !pick[r.id]}
                  onClick={() => promote(r, { itemId: pick[r.id] })}
                >
                  {t('admin.attach')}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy === r.id} onClick={() => createFrom(r)}>
                  {ts('createItem')}
                </button>
              </div>
              <div className="st-fb-status">
                {r.status === 'new' && (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy === r.id} onClick={() => setStatus(r.id, 'read')}>
                    {t('admin.markRead')}
                  </button>
                )}
                {r.status !== 'done' ? (
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy === r.id} onClick={() => setStatus(r.id, 'done')}>
                    {t('admin.markDone')}
                  </button>
                ) : (
                  <button type="button" className="btn btn-secondary btn-sm" disabled={busy === r.id} onClick={() => setStatus(r.id, 'new')}>
                    {t('admin.reopen')}
                  </button>
                )}
              </div>
            </div>
            {failed?.id === r.id && (
              <p className="ui-error" role="alert">
                {failed.msg}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
