'use client';

import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { dragWidth, resizeByKey, type PanelSide } from '@/lib/panel-resize';

/**
 * Divisor vertical que cambia el ancho de un panel lateral. Controlado: quien
 * lo usa guarda el ancho y lo aplica (variable CSS, estilo). Se arrastra con
 * el puntero capturado (pasar por encima de un iframe no lo suelta), se mueve
 * con las flechas (Shift da pasos grandes), Inicio y Fin van al mínimo y al
 * máximo, y doble clic o Enter vuelven al ancho por defecto.
 * Estilos: .ui-splitter en styles/ui.css; la posición la pone cada pantalla.
 */
export default function PanelSplitter({
  label,
  hint,
  value,
  min,
  max,
  side,
  className = '',
  onResize,
  onCommit,
  onReset,
}: {
  /** Nombre accesible: qué panel cambia de tamaño. */
  label: string;
  /** Texto al pasar el mouse. */
  hint?: string;
  value: number;
  min: number;
  max: number;
  /** De qué lado del divisor está el panel que cambia. */
  side: PanelSide;
  className?: string;
  /** Ancho nuevo mientras se arrastra o con el teclado. */
  onResize: (width: number) => void;
  /** Terminó el cambio (se soltó el puntero o se tocó una tecla): momento de guardar. */
  onCommit?: (width: number) => void;
  /** Volver al ancho por defecto. */
  onReset: () => void;
}) {
  const drag = useRef<{ id: number; x: number; start: number; last: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);

  function end(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
    document.documentElement.classList.remove('ui-resizing');
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (d.moved) onCommit?.(d.last);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const r = resizeByKey(e.key, { shift: e.shiftKey, value, min, max, side });
    if (!r) return;
    e.preventDefault();
    e.stopPropagation();
    if (r.type === 'reset') return onReset();
    if (r.value === value) return;
    onResize(r.value);
    onCommit?.(r.value);
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      title={hint}
      tabIndex={0}
      className={`ui-splitter${dragging ? ' is-dragging' : ''}${className ? ` ${className}` : ''}`}
      onPointerDown={(e) => {
        if (e.button !== 0 || drag.current) return;
        // Sin esto el arrastre selecciona texto y el foco se va al body.
        e.preventDefault();
        e.currentTarget.focus({ preventScroll: true });
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* puntero que ya no existe: se arrastra igual mientras esté sobre el divisor */
        }
        drag.current = { id: e.pointerId, x: e.clientX, start: value, last: value, moved: false };
        setDragging(true);
        document.documentElement.classList.add('ui-resizing');
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        const next = dragWidth(d.start, e.clientX - d.x, side, min, max);
        if (next === d.last) return;
        d.last = next;
        d.moved = true;
        onResize(next);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    />
  );
}
