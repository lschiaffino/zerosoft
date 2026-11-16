'use client';

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useBackLayer } from './backLayer';
import { Plus } from './icons';
import type { MenuItem } from './Menu';

export interface TouchReactions {
  quick: string[];
  /** Las que ya puse yo (se ven marcadas). */
  mine: string[];
  onPick: (emoji: string) => void;
  /** El "+" (todos los emojis). Sin esto, solo las rápidas. */
  onMore?: () => void;
  label: string;
  moreLabel?: string;
}

/**
 * El menú de un mensaje en el teléfono, como WhatsApp: con un toque largo el mensaje queda marcado, arriba
 * aparece la barra de reacciones y abajo una hoja con las mismas acciones del menú de la flecha (las da quien
 * lo usa: `items`). No tapa el chat con una cortina: tocar otro mensaje lo suma a la selección (`onOutside`
 * recibe el elemento tocado y decide), tocar en otro lado, Esc o "atrás" lo cierran.
 *
 * Va dentro del `.gr-inbox` del mensaje (sus colores, claro u oscuro, y el estilo del chat) con posición fija.
 */
export default function TouchMessageMenu({
  anchor,
  items,
  label,
  reactions,
  onClose,
  onOutside,
}: {
  anchor: HTMLElement;
  items: MenuItem[];
  label: string;
  reactions?: TouchReactions | null;
  onClose: () => void;
  /** Un toque fuera del menú. Si devuelve true, ya hizo algo con él (sumó otro mensaje): el clic que sigue no cuenta. */
  onOutside?: (target: Element) => boolean | void;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [barPos, setBarPos] = useState<{ top: number; left: number } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const outsideRef = useRef(onOutside);
  outsideRef.current = onOutside;
  useBackLayer(true, () => closeRef.current());

  // Ubicación: el mensaje queda a la vista entre la barra de reacciones y la hoja (se corre la lista si hace falta).
  useLayoutEffect(() => {
    const target = anchor.querySelector<HTMLElement>('.gr-bubble') ?? anchor;
    const box = anchor.closest<HTMLElement>('.wa-messages');
    // Por su alto y no por su caja: la hoja entra con una animación (está corrida hacia abajo en este momento).
    const sheetTop = window.innerHeight - (sheet.current?.offsetHeight ?? 0);
    const barH = bar.current?.offsetHeight ?? 0;
    // La hoja tapa el final del chat: mientras está abierta, el chat tiene ese lugar de más abajo para que el
    // último mensaje también pueda quedar arriba de la hoja.
    const prevPad = box?.style.paddingBottom ?? '';
    if (box) {
      const cover = box.getBoundingClientRect().bottom - sheetTop + 8;
      if (cover > 0) box.style.paddingBottom = `${cover}px`;
      const r = target.getBoundingClientRect();
      const top = box.getBoundingClientRect().top + barH + 12;
      const bottom = sheetTop - 8;
      if (r.bottom > bottom) box.scrollTop += Math.min(r.bottom - bottom, Math.max(0, r.top - top));
      else if (r.top < top) box.scrollTop -= top - r.top;
    }
    const place = () => {
      if (!bar.current) return;
      const r = target.getBoundingClientRect();
      const b = bar.current.getBoundingClientRect();
      const boxTop = box ? box.getBoundingClientRect().top : 0;
      const top = Math.max(boxTop + 4, r.top - b.height - 6);
      const out = Boolean(anchor.closest('.gr-msg-out'));
      let left = out ? r.right - b.width : r.left;
      left = Math.min(Math.max(8, left), window.innerWidth - b.width - 8);
      setBarPos({ top, left });
    };
    place();
    // El chat se puede seguir moviendo (scroll, un mensaje nuevo): la barra va con el mensaje.
    const onScroll = () => requestAnimationFrame(place);
    box?.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      box?.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (box) box.style.paddingBottom = prevPad;
    };
  }, [anchor]);

  useEffect(() => {
    sheet.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    // El dedo que abrió el menú sigue apoyado: al soltarlo, el navegador puede mandar un clic justo donde quedó la hoja
    // o la barra (iOS siempre). Hasta un rato después de soltar, ningún clic cuenta.
    let armed = false;
    let armTimer = window.setTimeout(() => (armed = true), 1500);
    const onUp = () => {
      window.clearTimeout(armTimer);
      armTimer = window.setTimeout(() => (armed = true), 350);
    };
    const onClick = (e: MouseEvent) => {
      if (armed) return;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener('pointerup', onUp, { capture: true, once: true });
    document.addEventListener('click', onClick, true);
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t || sheet.current?.contains(t) || bar.current?.contains(t)) return;
      if (!outsideRef.current) return closeRef.current();
      if (outsideRef.current(t) !== true) return;
      // El clic de ese mismo toque llega después (y el chat ya se movió al cerrarse la hoja): no se usa.
      const swallow = (ev: MouseEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
      };
      document.addEventListener('click', swallow, { capture: true, once: true });
      window.setTimeout(() => document.removeEventListener('click', swallow, true), 800);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      closeRef.current();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      window.clearTimeout(armTimer);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, []);

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const all = [...(sheet.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
    }
  }

  const host = anchor.closest('.gr-inbox') ?? document.body;
  return createPortal(
    <div className="wa-touch-menu" data-testid="touch-menu">
      {reactions && (
        <div
          ref={bar}
          className="wa-touch-react"
          role="group"
          aria-label={reactions.label}
          style={barPos ? { top: barPos.top, left: barPos.left } : { top: -9999, left: -9999 }}
        >
          {reactions.quick.map((e) => (
            <button
              key={e}
              type="button"
              className={reactions.mine.includes(e) ? 'is-mine' : ''}
              aria-label={e}
              aria-pressed={reactions.mine.includes(e)}
              onClick={() => {
                closeRef.current();
                reactions.onPick(e);
              }}
            >
              {e}
            </button>
          ))}
          {reactions.onMore && (
            <button
              type="button"
              className="wa-touch-react-more"
              aria-label={reactions.moreLabel}
              title={reactions.moreLabel}
              onClick={() => {
                closeRef.current();
                reactions.onMore?.();
              }}
            >
              <Plus size={20} />
            </button>
          )}
        </div>
      )}
      {items.length > 0 && (
        <div ref={sheet} className={`gr-menu-list wa-touch-sheet${items.some((it) => it.glyph) ? ' has-glyphs' : ''}`} role="menu" aria-label={label} onKeyDown={onKey}>
          <span className="wa-touch-grip" aria-hidden="true" />
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              data-key={it.key}
              className={`gr-menu-item${it.danger ? ' gr-danger' : ''}${it.divider ? ' has-divider' : ''}`}
              onClick={() => {
                closeRef.current();
                it.onSelect();
              }}
            >
              {(it.glyph || it.icon) && <span className="gr-menu-glyph">{it.glyph ?? it.icon}</span>}
              <span>{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>,
    host,
  );
}
