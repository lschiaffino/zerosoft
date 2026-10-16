'use client';

import { useEffect, useState, type CSSProperties, type DragEvent, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import type { RoadmapItemRow } from '@/lib/db';
import { productColor } from '@/lib/product-taxonomy';
import { ROADMAP_STATUSES, type RoadmapStatus } from '@/lib/roadmap-constants';
import { RoadmapAdminRow, type AdminItem } from './RoadmapAdminList';

/**
 * Kanban del admin: arrastrar un ítem entre columnas cambia su estado
 * (PATCH /api/roadmap/:id, que registra el evento y avisa a los suscriptos).
 * Click en una tarjeta abre el panel de edición (editar, publicar, fusionar).
 * Sin mouse: el panel tiene el selector de estado.
 */
export default function RoadmapKanban({
  initial,
  locale,
}: {
  initial: AdminItem[];
  locale: string;
}) {
  const t = useTranslations('roadmap');
  const tp = useTranslations('feedbackBoard.product');
  const [items, setItems] = useState(initial);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<RoadmapStatus | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newStatus, setNewStatus] = useState<RoadmapStatus>('idea');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!openId) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenId(null);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openId]);

  async function move(id: string, status: RoadmapStatus) {
    const item = items.find((i) => i.id === id);
    if (!item || item.status === status) return;
    let declinedReason: string | null | undefined;
    if (status === 'declined') {
      const reason = window.prompt(t('admin.declinePrompt'), item.declined_reason ?? '');
      if (reason === null) return;
      declinedReason = reason.trim() || null;
    }
    const prev = items;
    setItems((list) => list.map((i) => (i.id === id ? { ...i, status } : i)));
    setError(false);
    const res = await fetch(`/api/roadmap/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(declinedReason !== undefined ? { status, declinedReason } : { status }),
    }).catch(() => null);
    const data = res?.ok ? ((await res.json().catch(() => null)) as { item?: RoadmapItemRow } | null) : null;
    if (data?.item) {
      const next = data.item;
      setItems((list) => list.map((i) => (i.id === id ? { ...i, ...next } : i)));
    } else {
      setItems(prev);
      setError(true);
    }
  }

  function onDrop(e: DragEvent, status: RoadmapStatus) {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain') || dragId;
    setOver(null);
    setDragId(null);
    if (id) void move(id, status);
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!newTitle.trim() || creating) return;
    setCreating(true);
    const res = await fetch('/api/roadmap', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: newTitle.trim(), status: newStatus, isPublic: newStatus !== 'proposed' }),
    }).catch(() => null);
    const data = res?.ok ? ((await res.json().catch(() => null)) as { item?: RoadmapItemRow } | null) : null;
    if (data?.item) {
      setItems((list) => [{ ...data.item!, signals: [] }, ...list]);
      setNewTitle('');
    } else setError(true);
    setCreating(false);
  }

  const open = items.find((i) => i.id === openId) ?? null;
  const targets = items.map((i) => ({ id: i.id, title: i.title }));

  return (
    <>
      <form className="rk-new" onSubmit={create}>
        <input
          className="input"
          value={newTitle}
          maxLength={160}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder={t('admin.newItemPlaceholder')}
          aria-label={t('admin.newItemPlaceholder')}
        />
        <select
          className="select"
          value={newStatus}
          onChange={(e) => setNewStatus(e.target.value as RoadmapStatus)}
          aria-label={t('admin.statusLabel')}
        >
          {ROADMAP_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`admin.status.${s}`)}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-solid btn-small" disabled={creating || !newTitle.trim()}>
          {t('admin.create')}
        </button>
      </form>
      {error && (
        <p className="rm-admin-status is-error" role="alert">
          {t('admin.error')}
        </p>
      )}

      <div className="rk-board">
        {ROADMAP_STATUSES.map((status) => {
          const col = items.filter((i) => i.status === status);
          return (
            <section
              key={status}
              className={`rk-col${over === status ? ' is-over' : ''}`}
              aria-label={t(`admin.status.${status}`)}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (over !== status) setOver(status);
              }}
              onDragLeave={() => setOver((o) => (o === status ? null : o))}
              onDrop={(e) => onDrop(e, status)}
            >
              <header className="rk-col-head">
                {t(`admin.status.${status}`)}
                <span>{col.length}</span>
              </header>
              {col.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  draggable
                  className={`rk-card${dragId === item.id ? ' is-dragging' : ''}${item.is_public ? '' : ' is-private'}`}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', item.id);
                    e.dataTransfer.effectAllowed = 'move';
                    setDragId(item.id);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setOver(null);
                  }}
                  onClick={() => setOpenId(item.id)}
                >
                  <span className="rk-card-title">{item.title}</span>
                  <span className="rk-card-meta">
                    <span className="bp-dot" style={{ '--dot': productColor(item.product) } as CSSProperties}>
                      {tp(item.product)}
                    </span>
                    <span>{t('votes', { count: item.votes })}</span>
                    {!item.is_public && <span>{t('admin.private')}</span>}
                  </span>
                </button>
              ))}
            </section>
          );
        })}
      </div>

      {open && (
        <>
          <div className="rk-drawer-backdrop" onClick={() => setOpenId(null)} aria-hidden="true" />
          <aside className="rk-drawer" role="dialog" aria-modal="true" aria-label={open.title}>
            <div className="rk-drawer-head">
              <strong>{t('admin.edit')}</strong>
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setOpenId(null)}>
                {t('admin.close')}
              </button>
            </div>
            <RoadmapAdminRow
              key={open.id}
              item={open}
              targets={targets.filter((x) => x.id !== open.id)}
              locale={locale}
              t={t}
              onSaved={(next) => setItems((list) => list.map((i) => (i.id === open.id ? { ...i, ...next } : i)))}
              onMerged={(target) => {
                setItems((list) =>
                  list
                    .filter((i) => i.id !== open.id)
                    .map((i) => (i.id === target.id ? { ...i, ...target, signals: [...open.signals, ...i.signals] } : i)),
                );
                setOpenId(target.id);
              }}
            />
          </aside>
        </>
      )}
    </>
  );
}
