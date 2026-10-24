'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { elementBox, isSticky, stickyTags, type SceneEl } from '@/lib/board-stickies';
import { sceneToView, type CanvasView } from '@/lib/board-view';
import type { BoardTrackCard } from '@/lib/board-track';
import type { VotingView } from '@/lib/board-workshop';
import type { CanvasApi } from './ExcalidrawCanvas';
import { elementsSignature } from '@/lib/board-signature';

/** Con menos zoom que esto, los tags no se muestran (el lienzo se llena de texto). */
const TAGS_MIN_ZOOM = 0.45;

/**
 * Insignias sobre el lienzo, ancladas a los elementos (siguen scroll, zoom y
 * movimientos): tags de los stickies, votos (los propios mientras la votación
 * está abierta, los totales al cerrarla) y las tarjetas en vivo de Track.
 */
export default function BoardOverlays({
  api,
  cards,
  voting,
  canVote,
  onVote,
}: {
  api: CanvasApi | null;
  cards: BoardTrackCard[];
  voting: VotingView | null;
  canVote: boolean;
  onVote: (elementId: string, delta: 1 | -1) => void;
}) {
  const t = useTranslations('board');
  const [view, setView] = useState<CanvasView>({ scrollX: 0, scrollY: 0, zoom: 1 });
  const [elements, setElements] = useState<SceneEl[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1600, height: 1000 });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth || 1600, height: el.clientHeight || 1000 });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Posiciones: se leen del lienzo en cada cambio, como mucho una vez por frame.
  useEffect(() => {
    if (!api) return;
    let frame = 0;
    let lastSig = '';
    const read = () => {
      frame = 0;
      const all = api.getSceneElements() as SceneEl[];
      // onChange llega también por cambios de solo appState (herramienta, puntero,
      // selección): si ningún elemento cambió de versión, no hay nada que recalcular.
      const sig = elementsSignature(all);
      if (sig === lastSig) return;
      lastSig = sig;
      setElements(all.filter((e) => !e.isDeleted));
    };
    read();
    const s = api.getAppState();
    setView({ scrollX: Number(s.scrollX) || 0, scrollY: Number(s.scrollY) || 0, zoom: Number((s.zoom as { value?: number })?.value) || 1 });
    const offScroll = api.onScrollChange((scrollX, scrollY, zoom) => setView({ scrollX, scrollY, zoom: zoom.value }));
    const offChange = api.onChange(() => {
      if (!frame) frame = requestAnimationFrame(read);
    });
    return () => {
      offScroll();
      offChange();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [api]);

  const cardByEl = useMemo(() => new Map(cards.map((c) => [c.element_id, c])), [cards]);
  const totals = useMemo(() => new Map((voting?.results ?? []).map((r) => [r.element_id, r.count])), [voting]);
  const top = useMemo(() => new Set((voting?.results ?? []).slice(0, 3).map((r) => r.element_id)), [voting]);

  const items = useMemo(() => {
    const out: Array<{ el: SceneEl; box: { x: number; y: number; width: number; height: number } }> = [];
    for (const el of elements) {
      const relevant = cardByEl.has(el.id) || isSticky(el);
      if (!relevant) continue;
      const b = elementBox(el);
      const p = sceneToView({ x: b.x, y: b.y }, view);
      const w = b.width * view.zoom;
      const h = b.height * view.zoom;
      // Fuera de pantalla: nada que dibujar.
      if (p.x + w < -40 || p.y + h < -40 || p.x > size.width + 40 || p.y > size.height + 40) continue;
      out.push({ el, box: { x: p.x, y: p.y, width: w, height: h } });
    }
    return out;
  }, [elements, cardByEl, view, size]);

  const open = voting?.status === 'open';
  const closed = voting?.status === 'closed';

  return (
    <div ref={wrapRef} className="board-overlays" aria-hidden={items.length === 0 ? true : undefined}>
      {items.map(({ el, box }) => {
        const tags = view.zoom >= TAGS_MIN_ZOOM ? stickyTags(el) : [];
        const card = cardByEl.get(el.id);
        const mine = voting?.mine[el.id] ?? 0;
        const total = totals.get(el.id) ?? 0;
        const sticky = isSticky(el);
        return (
          <div key={el.id}>
            {tags.length > 0 && (
              <span className="board-tags" style={{ left: box.x, top: box.y }}>
                {tags.slice(0, 4).map((tg) => (
                  <span key={tg} className="board-tag">
                    #{tg}
                  </span>
                ))}
              </span>
            )}
            {open && sticky && (
              <span className="board-vote" style={{ left: box.x + box.width, top: box.y }}>
                {mine > 0 && canVote && (
                  <button
                    type="button"
                    className="board-vote-btn"
                    onClick={() => onVote(el.id, -1)}
                    aria-label={t('workshop.unvote')}
                    title={t('workshop.unvote')}
                  >
                    −
                  </button>
                )}
                <button
                  type="button"
                  className={`board-vote-btn${mine > 0 ? ' is-mine' : ''}`}
                  disabled={!canVote || (voting?.left ?? 0) <= 0}
                  onClick={() => onVote(el.id, 1)}
                  aria-label={t('workshop.voteFor', { count: mine })}
                  title={t('workshop.voteFor', { count: mine })}
                >
                  {mine > 0 ? mine : '+'}
                </button>
              </span>
            )}
            {closed && total > 0 && (
              <span
                className={`board-vote-total${top.has(el.id) ? ' is-top' : ''}`}
                style={{ left: box.x + box.width, top: box.y }}
                title={t('workshop.votes', { count: total })}
              >
                {total}
              </span>
            )}
            {card && (
              <Link
                href={`/app/track/issues/${card.issue_id}`}
                target="_blank"
                className={`board-track-card${card.status_category === 'done' ? ' is-done' : ''}`}
                style={{ left: box.x, top: box.y + box.height + 4, maxWidth: Math.max(160, box.width) }}
                title={card.title}
              >
                <span className="board-track-dot" style={{ background: card.status_color ?? 'var(--brand-gray-2)' }} aria-hidden="true" />
                <span className="board-track-id mono">{card.identifier}</span>
                <span className="board-track-status">{card.status_name ?? t('track.noStatus')}</span>
                {card.assignee_name && <span className="board-track-who">{card.assignee_name}</span>}
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}
