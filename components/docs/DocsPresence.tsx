'use client';

import { useEffect, useState, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import type { DocsPeer } from '@/lib/docs-live';

/** Color estable por persona (8 tonos de la paleta de colaboración, ver styles/docs.css). */
export function peerColor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return `var(--docs-peer-${h % 8})`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

/** Una sola entrada por persona (puede tener la página abierta en dos pestañas). */
function uniquePeople(peers: DocsPeer[]): DocsPeer[] {
  const seen = new Map<string, DocsPeer>();
  for (const p of peers) {
    const prev = seen.get(p.user_id);
    if (!prev || (p.block_id && !prev.block_id)) seen.set(p.user_id, p);
  }
  return [...seen.values()];
}

/**
 * Avatares de quién más está en la página (como Notion, arriba a la derecha).
 * Click: lleva la vista al bloque donde esa persona tiene el cursor.
 */
export function DocsPresenceAvatars({ peers, onJump }: { peers: DocsPeer[]; onJump?: (peer: DocsPeer) => void }) {
  const t = useTranslations('docs.live');
  const people = uniquePeople(peers);
  if (people.length === 0) return null;
  const shown = people.slice(0, 4);
  const rest = people.length - shown.length;
  return (
    <div className="docs-presence" role="group" aria-label={t('here', { count: people.length })} data-testid="docs-presence">
      {shown.map((p) => {
        const label = `${p.name} · ${t(`mode.${p.mode === 'suggest' ? 'suggest' : p.mode === 'view' || p.mode === 'comment' ? 'view' : 'edit'}`)}`;
        return (
          <button
            key={p.user_id}
            type="button"
            className="docs-presence-avatar"
            style={{ '--peer': peerColor(p.user_id) } as React.CSSProperties}
            title={label}
            aria-label={label}
            onClick={() => onJump?.(p)}
          >
            {p.image ? (
              // Avatares de OAuth: <img> simple.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.image} alt="" />
            ) : (
              <span aria-hidden>{initials(p.name)}</span>
            )}
          </button>
        );
      })}
      {rest > 0 && <span className="docs-presence-more num">+{rest}</span>}
    </div>
  );
}

interface Box {
  key: string;
  left: number;
  top: number;
  height: number;
  name: string;
  color: string;
  rects: Array<{ left: number; top: number; width: number; height: number }>;
}

/** Punto (nodo de texto + offset) del texto plano `offset` dentro de `root`. */
function pointAt(root: Node, offset: number): { node: Node; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, offset);
  let node = walker.nextNode();
  let last: Node | null = null;
  while (node) {
    const len = (node.textContent ?? '').length;
    if (remaining <= len) return { node, offset: remaining };
    remaining -= len;
    last = node;
    node = walker.nextNode();
  }
  return last ? { node: last, offset: (last.textContent ?? '').length } : null;
}

/**
 * Cursores de las demás personas sobre el texto (la capa se monta como
 * hermana del editor, en su contenedor con position: relative): una barra con su nombre
 * donde tienen el caret y su selección sombreada. Se recalcula al moverse,
 * al hacer scroll y cuando cambia el contenido.
 */
export function DocsPeerCursors({ peers, containerRef }: { peers: DocsPeer[]; containerRef: RefObject<HTMLElement | null> }) {
  const [boxes, setBoxes] = useState<Box[]>([]);
  useEffect(() => {
    const wrapEl = containerRef.current;
    const container = (wrapEl?.querySelector('.docs-editor') as HTMLElement | null) ?? null;
    if (!wrapEl || !container) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // La capa vive en el contenedor del editor (no adentro del editor: el
        // observer de abajo se dispararía con sus propios cambios).
        const wrap = wrapEl;
        const base = wrap.getBoundingClientRect();
        const out: Box[] = [];
        for (const p of peers) {
          if (!p.block_id || p.start == null) continue;
          const host = container.querySelector(`[data-block-anchor="${CSS.escape(p.block_id)}"] .docs-editable`);
          if (!host) continue;
          const start = pointAt(host, p.start);
          const end = pointAt(host, p.end ?? p.start);
          if (!start || !end) continue;
          const range = document.createRange();
          try {
            range.setStart(start.node, start.offset);
            range.setEnd(end.node, end.offset);
          } catch {
            continue;
          }
          const caret = document.createRange();
          caret.setStart(end.node, end.offset);
          caret.collapse(true);
          const cr = caret.getClientRects()[0] ?? host.getBoundingClientRect();
          const rects = (p.end ?? p.start) > p.start ? [...range.getClientRects()] : [];
          out.push({
            key: p.session,
            left: cr.left - base.left + wrap.scrollLeft,
            top: cr.top - base.top + wrap.scrollTop,
            height: cr.height || 18,
            name: p.name,
            color: peerColor(p.user_id),
            rects: rects.map((r) => ({ left: r.left - base.left + wrap.scrollLeft, top: r.top - base.top + wrap.scrollTop, width: r.width, height: r.height })),
          });
        }
        setBoxes(out);
      });
    };
    measure();
    const obs = new MutationObserver(measure);
    obs.observe(container, { subtree: true, childList: true, characterData: true });
    // Abrir o cerrar el panel lateral cambia el ancho del editor (y dónde cae el texto).
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(container);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      cancelAnimationFrame(frame);
      obs.disconnect();
      ro?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [peers, containerRef]);

  if (boxes.length === 0) return null;
  return (
    <div className="docs-peer-layer" aria-hidden="true">
      {boxes.map((b) => (
        <div key={b.key} style={{ '--peer': b.color } as React.CSSProperties}>
          {b.rects.map((r, i) => (
            <span key={i} className="docs-peer-sel" style={{ left: r.left, top: r.top, width: r.width, height: r.height }} />
          ))}
          <span className="docs-peer-caret" style={{ left: b.left, top: b.top, height: b.height }} data-testid="docs-peer-caret">
            <span className="docs-peer-name" title={b.name}>{b.name}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
