'use client';

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { menuPlaceAt, menuPlaceNear } from '@/lib/menu-place';
import { TOUCH_QUERY, useBackLayer, useMediaQuery } from './backLayer';
import { useDismiss } from './useDismiss';

export interface MenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  danger?: boolean;
  /** Ícono a la izquierda (el menú de adjuntar los muestra en círculos de color). */
  icon?: ReactNode;
  /** Ícono de línea, chico y gris (menús de acciones, como los de WhatsApp). */
  glyph?: ReactNode;
  /** Separa este ítem de los anteriores (acciones del equipo debajo de las de WhatsApp). */
  divider?: boolean;
}

/** Evento con el que se abre un MessageMenu en un punto (ver openMenuAt). */
const OPEN_AT = 'zs-menu-open-at';

/**
 * Abre el menú de este botón (la flecha de un mensaje o de una fila). Con
 * `at` (el clic derecho o el toque), la lista se abre en ese punto, como el
 * menú contextual de WhatsApp; sin `at`, pegada al botón, como al tocarlo.
 */
export function openMenuAt(button: HTMLButtonElement | null | undefined, at?: { x: number; y: number }) {
  if (!button) return;
  if (!at) {
    button.click();
    return;
  }
  button.dispatchEvent(new CustomEvent(OPEN_AT, { detail: at }));
}

/**
 * El punto del clic derecho, para openMenuAt. Abierto con el teclado (la tecla de menú o Shift+F10) no hay
 * puntero: sin punto, el menú va pegado a la flecha.
 */
export function pointerOf(e: { clientX: number; clientY: number; nativeEvent: Event }): { x: number; y: number } | undefined {
  const type = (e.nativeEvent as Event & { pointerType?: string }).pointerType;
  if (type === '' || (e.clientX === 0 && e.clientY === 0)) return undefined;
  return { x: e.clientX, y: e.clientY };
}

/**
 * Menú (⋯ o la flecha de un mensaje): role="menu", flechas para moverse, Esc
 * cierra y devuelve el foco al botón, clic afuera también cierra. La lista va
 * en un portal con posición fija: se abre hacia arriba si abajo no entra y
 * nunca queda tapada por el composer ni cortada por el borde de la ventana.
 */
export function MessageMenu({
  label,
  items,
  trigger,
  className = 'btn btn-ghost btn-sm',
  align,
  onOpenChange,
  listClassName,
}: {
  label: string;
  items: MenuItem[];
  /** Contenido del botón (por defecto ⋯). */
  trigger?: ReactNode;
  className?: string;
  /** Clase extra de la lista (el menú de adjuntar usa "is-attach": íconos de color como WhatsApp). */
  listClassName?: string;
  /** Lado hacia el que abre la lista (por defecto, alineada a la derecha del botón). */
  align?: 'left' | 'right';
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpenState] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  // Abierto con el clic derecho: en ese punto. Con el botón (o el teclado): pegado a él.
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  // Teléfono: "atrás" cierra el menú abierto.
  useBackLayer(open, () => setOpen(false), { enabled: useMediaQuery(TOUCH_QUERY) });
  const setOpen = (v: boolean | ((p: boolean) => boolean)) =>
    setOpenState((prev) => {
      const next = typeof v === 'function' ? v(prev) : v;
      if (next !== prev) onOpenChange?.(next);
      return next;
    });

  // Clic o toque afuera, Esc (devuelve el foco al botón) u otro overlay que se abre: se cierra (./useDismiss.ts).
  useDismiss(
    open,
    (reason) => {
      setOpen(false);
      if (reason === 'escape') button.current?.focus();
    },
    [button, list],
  );

  // Posición: en el punto del clic derecho, o debajo del botón si entra (si no, arriba). Siempre entera dentro
  // de la ventana (lib/menu-place.ts); solo si es más alta que la ventana se corre por dentro.
  useLayoutEffect(() => {
    if (!open || !button.current || !list.current) return;
    const l = list.current;
    // El alto natural de la lista (sin el máximo de una posición anterior).
    const prev = l.style.maxHeight;
    l.style.maxHeight = 'none';
    const w = l.offsetWidth;
    const h = l.offsetHeight;
    l.style.maxHeight = prev;
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    setPos(at ? menuPlaceAt(at, w, h, vw, vh) : menuPlaceNear(button.current.getBoundingClientRect(), w, h, vw, vh, { align: align ?? 'right', gap: 4 }));
  }, [open, at, align, items.length]);

  // Clic derecho sobre el mensaje (openMenuAt): abre en el puntero; otro clic derecho lo mueve al nuevo punto.
  useEffect(() => {
    const b = button.current;
    if (!b) return;
    const onOpenAt = (e: Event) => {
      const p = (e as CustomEvent<{ x: number; y: number }>).detail;
      setAt({ x: p.x, y: p.y });
      setOpen(true);
    };
    b.addEventListener(OPEN_AT, onOpenAt);
    return () => b.removeEventListener(OPEN_AT, onOpenAt);
  });

  useEffect(() => {
    if (!open) {
      setPos(null);
      setAt(null);
      return;
    }
    // Sin mover el scroll: la lista todavía puede estar fuera de la pantalla hasta que se ubica.
    list.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    const close = () => setOpen(false);
    window.addEventListener('resize', close);
    // Si se scrollea algo que mueve el botón (la página o un contenedor suyo), se cierra: la posición dejó de
    // valer. Otro scroll no lo mueve y no lo cierra: la lista de mensajes que se queda abajo sola cuando llega
    // algo o el campo de texto que crece cerraban el menú de la cabecera apenas se abría.
    // Solo si el botón de verdad se movió: un contenedor que se acomoda sin moverlo (el chat que baja solo al
    // terminar de cargar las fotos) no cierra el menú.
    const at = button.current?.getBoundingClientRect();
    const onScroll = (e: Event) => {
      const target = e.target;
      if (!(target instanceof Node) || !button.current) return close();
      if (list.current?.contains(target)) return;
      if (!target.contains(button.current)) return;
      const now = button.current.getBoundingClientRect();
      if (!at || Math.abs(now.top - at.top) > 1 || Math.abs(now.left - at.left) > 1) close();
    };
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', onScroll, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const all = [...(list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length];
      next?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      (e.key === 'Home' ? all[0] : all[all.length - 1])?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    } else if (e.key === 'Tab') setOpen(false);
  }

  if (items.length === 0) return null;
  const listEl = open ? (
    <div
      className={`gr-menu-list is-portal${items.some((it) => it.icon) ? ' has-icons' : ''}${items.some((it) => it.glyph) ? ' has-glyphs' : ''}${listClassName ? ` ${listClassName}` : ''}`}
      role="menu"
      aria-label={label}
      ref={list}
      onKeyDown={onKey}
      style={pos ? { top: pos.top, left: pos.left, maxHeight: pos.maxHeight } : { top: -9999, left: -9999 }}
    >
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          role="menuitem"
          data-key={it.key}
          data-testid={`menu-${it.key}`}
          className={`gr-menu-item${it.danger ? ' gr-danger' : ''}${it.divider ? ' has-divider' : ''}`}
          onClick={() => {
            setOpen(false);
            it.onSelect();
          }}
        >
          {it.icon && <span className={`gr-menu-icon is-${it.key}`}>{it.icon}</span>}
          {it.glyph && <span className="gr-menu-glyph">{it.glyph}</span>}
          <span>{it.label}</span>
        </button>
      ))}
    </div>
  ) : null;
  return (
    <span className="gr-menu">
      <button
        ref={button}
        type="button"
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => {
          setAt(null);
          setOpen((v) => !v);
        }}
      >
        {trigger ?? '⋯'}
      </button>
      {listEl && typeof document !== 'undefined' ? createPortal(listEl, document.body) : null}
    </span>
  );
}
