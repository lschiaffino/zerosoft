'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Popover de la base (menús de propiedad, filtro, orden, opciones de una
 * celda). Va en un portal con posición fija debajo del ancla: la tabla tiene
 * scroll horizontal y lo cortaría. Click afuera o Esc cierra; Esc devuelve el
 * foco al ancla (o a quien diga `returnFocus`).
 */
export default function DbPopover({
  anchor,
  onClose,
  children,
  className = '',
  label,
  width,
  autoFocus = true,
}: {
  anchor: HTMLElement | null;
  onClose: (reason: 'escape' | 'outside') => void;
  children: ReactNode;
  className?: string;
  label?: string;
  /** Ancho fijo (px); por defecto el del contenido, mínimo el del ancla. */
  width?: number;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; minWidth: number } | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const el = ref.current;
      const h = el?.offsetHeight ?? 0;
      const w = el?.offsetWidth ?? width ?? 240;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let top = r.bottom + 4;
      if (top + h > vh - 8 && r.top - h - 4 > 8) top = r.top - h - 4;
      const left = Math.max(8, Math.min(r.left, vw - w - 8));
      setPos({ top, left, minWidth: Math.min(Math.max(r.width, 0), vw - 16) });
    };
    place();
    // Segunda pasada: el alto real recién se conoce después de pintar.
    const id = requestAnimationFrame(place);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, width]);

  useEffect(() => {
    if (autoFocus) {
      const first = ref.current?.querySelector<HTMLElement>('[data-autofocus], input, select, button, [tabindex="0"]');
      first?.focus();
    }
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      // Un popover hijo (opciones dentro del menú de propiedad) también cuenta como adentro.
      if ((t as Element).closest?.('.docs-db-popover')) return;
      onCloseRef.current('outside');
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
    // Solo al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={ref}
      className={`docs-db-popover${className ? ` ${className}` : ''}`}
      role="dialog"
      aria-label={label}
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        minWidth: pos?.minWidth,
        width,
        maxWidth: 'calc(100vw - 16px)',
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onCloseRef.current('escape');
          anchor?.focus();
        }
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
