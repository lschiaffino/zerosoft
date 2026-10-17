'use client';

import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import type { RoadmapItemRow } from '@/lib/db';
import { ROADMAP_STATUSES, type RoadmapStatus } from '@/lib/roadmap-constants';
import type { AdminItem } from './RoadmapAdminRow';
import RoadmapItemDrawer from './RoadmapItemDrawer';
import ProductTag from './ProductTag';

/**
 * Kanban del admin: arrastrar un ítem entre columnas cambia su estado
 * (PATCH /api/roadmap/:id, que registra el evento y avisa a los suscriptos).
 * Click o Enter en una tarjeta abre el panel de edición (editar, publicar,
 * fusionar). Sin mouse: el panel tiene el selector de estado.
 */
export default function RoadmapKanban({ initial, locale }: { initial: AdminItem[]; locale: string }) {
  const t = useTranslations('roadmap');
  const tp = useTranslations('feedbackBoard.product');
  const ts = useTranslations('settings.admin');
  const [items, setItems] = useState(initial);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<RoadmapStatus | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newStatus, setNewStatus] = useState<RoadmapStatus>('idea');
  const [creating, setCreating] = useState(false);

  const boardRef = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(0);

  // Cuántas columnas quedan fuera a la derecha: el botón "Ver N columnas más"
  // avisa que el tablero sigue y lleva hasta el final.
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const measure = () => {
      const right = el.getBoundingClientRect().right;
      const cols = Array.from(el.children) as HTMLElement[];
      setHidden(cols.filter((c) => c.getBoundingClientRect().right > right + 2).length);
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      ro.disconnect();
    };
  }, []);

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
      <div className="st-kb-bar">
        <form className="st-create st-kb-new" onSubmit={create}>
          <div className="ui-field st-create-field">
            <label className="sr-only" htmlFor="st-kb-title">
              {t('admin.newItemPlaceholder')}
            </label>
            <input
              id="st-kb-title"
              className="input"
              value={newTitle}
              maxLength={160}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder={t('admin.newItemPlaceholder')}
            />
          </div>
          <label className="sr-only" htmlFor="st-kb-status">
            {t('admin.statusLabel')}
          </label>
          <select
            id="st-kb-status"
            className="select st-kb-status"
            value={newStatus}
            onChange={(e) => setNewStatus(e.target.value as RoadmapStatus)}
          >
            {ROADMAP_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`admin.status.${s}`)}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-primary" disabled={!newTitle.trim()} aria-busy={creating || undefined}>
            {t('admin.create')}
          </button>
        </form>
        {hidden > 0 && (
          <button
            type="button"
            className="btn btn-secondary btn-sm st-kb-more"
            onClick={() =>
              boardRef.current?.scrollTo({
                left: boardRef.current.scrollWidth,
                behavior: 'smooth',
              })
            }
          >
            {ts('kanbanMore', { count: hidden })}
          </button>
        )}
      </div>
      {error && (
        <p className="ui-error" role="alert">
          {t('admin.error')}
        </p>
      )}

      <div className="st-kb" role="list" aria-label={t('admin.title')} ref={boardRef}>
        {ROADMAP_STATUSES.map((status) => {
          const col = items.filter((i) => i.status === status);
          return (
            <section
              key={status}
              role="listitem"
              className={`st-kb-col${over === status ? ' is-over' : ''}`}
              aria-label={t(`admin.status.${status}`)}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (over !== status) setOver(status);
              }}
              onDragLeave={() => setOver((o) => (o === status ? null : o))}
              onDrop={(e) => onDrop(e, status)}
            >
              <header className="st-kb-head">
                <h3>{t(`admin.status.${status}`)}</h3>
                <span className="data">{col.length}</span>
              </header>
              {col.length === 0 && <p className="st-kb-empty">{ts('columnEmpty')}</p>}
              {col.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  draggable
                  className={`st-kb-card${dragId === item.id ? ' is-dragging' : ''}`}
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
                  aria-haspopup="dialog"
                >
                  <span className="st-kb-title">{item.title}</span>
                  <span className="st-kb-meta">
                    <ProductTag product={item.product} label={tp(item.product)} />
                    <span className="data">{t('votes', { count: item.votes })}</span>
                    {!item.is_public && <span className="badge badge-outline">{t('admin.private')}</span>}
                  </span>
                </button>
              ))}
            </section>
          );
        })}
      </div>

      <RoadmapItemDrawer
        item={open}
        targets={targets}
        locale={locale}
        onClose={() => setOpenId(null)}
        onSaved={(id, next) => setItems((list) => list.map((i) => (i.id === id ? { ...i, ...next } : i)))}
        onMerged={(sourceId, target) => {
          setItems((list) => {
            const source = list.find((i) => i.id === sourceId);
            return list
              .filter((i) => i.id !== sourceId)
              .map((i) =>
                i.id === target.id
                  ? {
                      ...i,
                      ...target,
                      signals: [...(source?.signals ?? []), ...i.signals],
                    }
                  : i,
              );
          });
          setOpenId(target.id);
        }}
      />
    </>
  );
}
