'use client';

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

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
}: {
  label: string;
  items: MenuItem[];
  /** Contenido del botón (por defecto ⋯). */
  trigger?: ReactNode;
  className?: string;
  /** Lado hacia el que abre la lista (por defecto, alineada a la derecha del botón). */
  align?: 'left' | 'right';
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpenState] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const setOpen = (v: boolean | ((p: boolean) => boolean)) =>
    setOpenState((prev) => {
      const next = typeof v === 'function' ? v(prev) : v;
      if (next !== prev) onOpenChange?.(next);
      return next;
    });

  // Posición: debajo del botón si entra; si no, arriba. Siempre dentro de la ventana.
  useLayoutEffect(() => {
    if (!open || !button.current || !list.current) return;
    const b = button.current.getBoundingClientRect();
    const l = list.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 4;
    const below = vh - b.bottom - gap - 8;
    const above = b.top - gap - 8;
    const up = l.height > below && above > below;
    const maxHeight = Math.max(120, up ? above : below);
    const h = Math.min(l.height, maxHeight);
    const top = up ? b.top - gap - h : b.bottom + gap;
    let left = align === 'left' ? b.left : b.right - l.width;
    left = Math.min(Math.max(8, left), vw - l.width - 8);
    setPos({ top, left, maxHeight });
  }, [open, align, items.length]);

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    // Sin mover el scroll: la lista todavía puede estar fuera de la pantalla hasta que se ubica.
    list.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (button.current?.contains(t) || list.current?.contains(t)) return;
      setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', close);
    // Si se scrollea lo de atrás (no el propio menú), se cierra: la posición dejó de valer.
    const onScroll = (e: Event) => {
      if (list.current && e.target instanceof Node && list.current.contains(e.target)) return;
      close();
    };
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
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
      className={`gr-menu-list is-portal${items.some((it) => it.icon) ? ' has-icons' : ''}${items.some((it) => it.glyph) ? ' has-glyphs' : ''}`}
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
        onClick={() => setOpen((v) => !v)}
      >
        {trigger ?? '⋯'}
      </button>
      {listEl && typeof document !== 'undefined' ? createPortal(listEl, document.body) : null}
    </span>
  );
}
