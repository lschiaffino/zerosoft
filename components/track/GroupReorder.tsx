'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslations } from 'next-intl';
import { moveGroupKey } from '@/lib/track-views';
import { Popover } from './InlineEditors';
import TrackIcon from './TrackIcon';

/**
 * Reordenar grupos de una lista y columnas de un tablero, como Linear:
 * arrastrar desde el asa (mouse, lápiz o dedo: eventos de puntero, así anda
 * en el teléfono), las flechas con el asa enfocada, o "Mover arriba/abajo" en
 * el menú del encabezado. Esc cancela un arrastre a mitad de camino.
 *
 * Los ítems se marcan con `data-group-key` dentro de un contenedor con
 * `data-group-list`; el orden nuevo se pasa entero a `onReorder`.
 */

type Axis = 'x' | 'y';

interface DragState {
  key: string;
  /** Posición de destino en la lista sin el arrastrado (lo que espera moveGroupKey). */
  to: number;
}

/** Contenedor que scrollea en ese eje (el tablero de costado, la página para abajo). */
function scrollParent(el: HTMLElement, axis: Axis): HTMLElement {
  // Desde la lista misma: el tablero (.track-board) es el que scrollea de costado.
  let node: HTMLElement | null = el;
  while (node && node !== document.body) {
    const style = getComputedStyle(node);
    const overflow = axis === 'x' ? style.overflowX : style.overflowY;
    const scrolls = axis === 'x' ? node.scrollWidth > node.clientWidth : node.scrollHeight > node.clientHeight;
    if (scrolls && /(auto|scroll)/.test(overflow)) return node;
    node = node.parentElement;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

export function useGroupReorder(keys: string[], axis: Axis, onReorder?: (keys: string[]) => void) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const keysRef = useRef(keys);
  keysRef.current = keys;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  const start = useCallback(
    (key: string, e: ReactPointerEvent<HTMLElement>) => {
      if (!onReorderRef.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const list = e.currentTarget.closest<HTMLElement>('[data-group-list]');
      if (!list) return;
      // Sin preventDefault: el mousedown sigue llegando (cierra los menús abiertos). El asa no
      // selecciona texto (user-select) ni scrollea con el dedo (touch-action).
      cleanup.current?.();
      const pointerId = e.pointerId;
      const origin = axis === 'y' ? e.clientY : e.clientX;
      const scroller = scrollParent(list, axis);
      let moved = false;
      let to = keysRef.current.indexOf(key);
      let last = origin;
      let frame = 0;
      // El estado (y el render de la lista) cambia solo cuando cambia el lugar de destino.
      let shown = -1;
      const show = () => {
        if (to === shown) return;
        shown = to;
        setDrag({ key, to });
      };

      const items = () => Array.from(list.querySelectorAll<HTMLElement>('[data-group-key]')).filter((el) => el.closest('[data-group-list]') === list);
      const place = (pos: number) => {
        let idx = 0;
        for (const el of items()) {
          if (el.dataset.groupKey === key) continue;
          const r = el.getBoundingClientRect();
          const mid = axis === 'y' ? r.top + r.height / 2 : r.left + r.width / 2;
          if (pos > mid) idx++;
        }
        return idx;
      };
      // Cerca del borde del contenedor que scrollea, se corre solo (listas largas, tablero ancho).
      const autoscroll = () => {
        frame = 0;
        if (!moved) return;
        const isPage = scroller === document.scrollingElement || scroller === document.documentElement;
        const rect = isPage
          ? {
              start: 0,
              end: axis === 'y' ? window.innerHeight : window.innerWidth,
            }
          : (() => {
              const r = scroller.getBoundingClientRect();
              return axis === 'y' ? { start: r.top, end: r.bottom } : { start: r.left, end: r.right };
            })();
        const edge = 48;
        const delta = last < rect.start + edge ? -12 : last > rect.end - edge ? 12 : 0;
        if (!delta) return;
        if (axis === 'y') scroller.scrollBy(0, delta);
        else scroller.scrollBy(delta, 0);
        to = place(last);
        show();
        frame = window.requestAnimationFrame(autoscroll);
      };
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        const pos = axis === 'y' ? ev.clientY : ev.clientX;
        if (!moved && Math.abs(pos - origin) < 4) return;
        moved = true;
        ev.preventDefault();
        last = pos;
        to = place(pos);
        show();
        if (!frame) frame = window.requestAnimationFrame(autoscroll);
      };
      const finish = (commit: boolean) => {
        cleanup.current?.();
        setDrag(null);
        if (!commit || !moved) return;
        const next = moveGroupKey(keysRef.current, key, to);
        if (next.join('\u0001') !== keysRef.current.join('\u0001')) onReorderRef.current?.(next);
      };
      const onUp = (ev: PointerEvent) => ev.pointerId === pointerId && finish(true);
      const onCancel = (ev: PointerEvent) => ev.pointerId === pointerId && finish(false);
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key !== 'Escape') return;
        ev.preventDefault();
        ev.stopPropagation();
        finish(false);
      };
      // El clic que sigue a un arrastre no abre ni contrae nada.
      const onClick = (ev: MouseEvent) => {
        if (!moved) return;
        ev.preventDefault();
        ev.stopPropagation();
      };
      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('keydown', onKey, true);
      cleanup.current = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('keydown', onKey, true);
        if (frame) window.cancelAnimationFrame(frame);
        window.setTimeout(() => window.removeEventListener('click', onClick, true), 0);
        cleanup.current = null;
      };
      window.addEventListener('click', onClick, true);
    },
    [axis],
  );

  /** Clase del ítem: el que se arrastra, y la línea donde caería. */
  const itemClass = (key: string): string => {
    if (!drag) return '';
    if (key === drag.key) return ' is-group-dragging';
    const rest = keysRef.current.filter((k) => k !== drag.key);
    if (rest[drag.to] === key) return ' is-group-drop-before';
    if (drag.to >= rest.length && rest[rest.length - 1] === key) return ' is-group-drop-after';
    return '';
  };

  const move = useCallback((key: string, to: number) => {
    const next = moveGroupKey(keysRef.current, key, to);
    if (next.join('\u0001') === keysRef.current.join('\u0001')) return;
    onReorderRef.current?.(next);
  }, []);

  return {
    dragging: drag?.key ?? null,
    start,
    itemClass,
    move,
    enabled: Boolean(onReorder),
  };
}

/** El foco sigue al grupo movido con el teclado (el encabezado se vuelve a montar en otro lugar). */
function focusGrip(listEl: HTMLElement | null, key: string) {
  window.requestAnimationFrame(() => {
    const target = Array.from(listEl?.querySelectorAll<HTMLElement>('[data-group-key]') ?? []).find((el) => el.dataset.groupKey === key);
    target?.querySelector<HTMLElement>('[data-group-grip]')?.focus();
  });
}

interface GroupReorderControlsProps {
  groupKey: string;
  name: string;
  index: number;
  count: number;
  axis: Axis;
  reorder: ReturnType<typeof useGroupReorder>;
  /** "Restablecer orden": vuelve al orden natural (solo si hay uno propio). */
  onReset?: () => void;
  /** El asa (a la izquierda del encabezado) o el menú "…" (a la derecha). */
  part: 'grip' | 'menu';
}

/** Asa para arrastrar o menú "…" del encabezado (mover arriba/abajo, al principio o al final, restablecer). */
export function GroupReorderControls({ groupKey, name, index, count, axis, reorder, onReset, part }: GroupReorderControlsProps) {
  const td = useTranslations('track.ux.display');
  if (!reorder.enabled || count < 2) return null;
  const back = axis === 'y' ? td('groupMoveUp') : td('groupMoveLeft');
  const fwd = axis === 'y' ? td('groupMoveDown') : td('groupMoveRight');
  const keyMove = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const prev = axis === 'y' ? 'ArrowUp' : 'ArrowLeft';
    const next = axis === 'y' ? 'ArrowDown' : 'ArrowRight';
    if (e.key !== prev && e.key !== next) return;
    e.preventDefault();
    const to = e.key === prev ? index - 1 : index + 1;
    if (to < 0 || to >= count) return;
    const list = e.currentTarget.closest<HTMLElement>('[data-group-list]');
    reorder.move(groupKey, to);
    focusGrip(list, groupKey);
  };
  // Deshabilitados con aria-disabled (siguen enfocables): las flechas del menú pasan por todos.
  let autofocused = false;
  const item = (id: string, label: string, run: () => void, disabled = false) => {
    const autofocus = !disabled && !autofocused;
    if (autofocus) autofocused = true;
    return (
      <button
        key={id}
        type="button"
        role="menuitem"
        className="track-menu-item"
        aria-disabled={disabled || undefined}
        data-autofocus={autofocus ? '' : undefined}
        data-testid={`track-group-${id}`}
        onClick={() => {
          if (!disabled) run();
        }}
      >
        <span className="track-menu-label">{label}</span>
      </button>
    );
  };
  // Desde el menú: el grupo cambia de lugar y el foco vuelve a su "…" (React lo movió y lo soltó).
  const moveFromMenu = (close: () => void, to: number) => {
    close();
    reorder.move(groupKey, to);
    window.requestAnimationFrame(() => {
      const el = Array.from(document.querySelectorAll<HTMLElement>('[data-group-key]')).find((x) => x.dataset.groupKey === groupKey);
      el?.querySelector<HTMLElement>('.track-group-menu')?.focus();
    });
  };
  if (part === 'grip') {
    return (
      <button
        type="button"
        className="track-group-grip"
        data-group-grip=""
        data-testid="track-group-grip"
        aria-label={td('groupReorder', { name })}
        title={td('groupReorderHint')}
        aria-keyshortcuts={axis === 'y' ? 'ArrowUp ArrowDown' : 'ArrowLeft ArrowRight'}
        onPointerDown={(e) => reorder.start(groupKey, e)}
        onKeyDown={keyMove}
        onClick={(e) => e.preventDefault()}
      >
        <TrackIcon name="grip" size={14} />
      </button>
    );
  }
  return (
    <Popover
      ariaLabel={td('groupMenu', { name })}
      className="btn btn-ghost btn-icon track-group-menu"
      width={220}
      trigger={<TrackIcon name="more" size={14} />}
    >
      {(close) => (
        <>
          {item('move-back', back, () => moveFromMenu(close, index - 1), index === 0)}
          {item('move-forward', fwd, () => moveFromMenu(close, index + 1), index >= count - 1)}
          {item('move-first', axis === 'y' ? td('groupMoveTop') : td('groupMoveStart'), () => moveFromMenu(close, 0), index === 0)}
          {item('move-last', axis === 'y' ? td('groupMoveBottom') : td('groupMoveEnd'), () => moveFromMenu(close, count - 1), index >= count - 1)}
          {onReset && (
            <>
              <div className="track-menu-sep" role="separator" />
              {item('order-reset', td('groupOrderReset'), () => {
                close();
                onReset();
              })}
            </>
          )}
        </>
      )}
    </Popover>
  );
}
