'use client';

import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef, type ReactNode, type TextareaHTMLAttributes } from 'react';

/** Un tramo del texto a pintar como mención: [start, end). */
export interface HighlightRange {
  start: number;
  end: number;
}

/** Lo que se copia del campo a la capa de arriba para que cada letra caiga en el mismo lugar. */
const MIRRORED = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'fontVariant',
  'fontFeatureSettings',
  'fontKerning',
  'letterSpacing',
  'wordSpacing',
  'lineHeight',
  'textIndent',
  'textTransform',
  'tabSize',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'direction',
] as const;

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value'> & {
  value: string;
  /** Menciones del texto, en orden y sin superponerse. Sin ninguna, el campo es un textarea común. */
  highlights: ReadonlyArray<HighlightRange>;
};

/**
 * Campo de texto con las @menciones en color, como el de WhatsApp Web. Un
 * textarea no puede pintar partes del texto: encima va una capa con el mismo
 * texto (misma letra, mismo relleno, mismo ancho de renglón y el mismo
 * scroll) que pinta todo, y el texto del textarea queda transparente (el
 * cursor y la selección siguen siendo los del textarea). La capa no recibe
 * clics. Solo aparece cuando hay alguna mención.
 */
const MentionTextarea = forwardRef<HTMLTextAreaElement, Props>(function MentionTextarea({ value, highlights, className, onScroll, ...rest }, ref) {
  const area = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => area.current as HTMLTextAreaElement);
  const on = highlights.length > 0;

  // La capa copia la letra y el relleno del campo, y su caja interna (sin el borde ni la barra de scroll).
  const sync = useCallback(() => {
    const el = area.current;
    const m = mirror.current;
    if (!el || !m) return;
    const cs = window.getComputedStyle(el);
    for (const p of MIRRORED) m.style[p] = cs[p];
    m.style.top = `${el.offsetTop + el.clientTop}px`;
    m.style.left = `${el.offsetLeft + el.clientLeft}px`;
    m.style.width = `${el.clientWidth}px`;
    m.style.height = `${el.clientHeight}px`;
    m.scrollTop = el.scrollTop;
    m.scrollLeft = el.scrollLeft;
  }, []);

  useLayoutEffect(() => {
    if (!on) return;
    sync();
  });

  // El campo cambia de tamaño (crece con el texto, se angosta la ventana, cambia la letra): la capa lo sigue.
  useLayoutEffect(() => {
    const el = area.current;
    if (!on || !el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => sync());
    ro.observe(el);
    return () => ro.disconnect();
  }, [on, sync]);

  const parts: ReactNode[] = [];
  if (on) {
    let pos = 0;
    highlights.forEach((h, i) => {
      if (h.start < pos || h.end > value.length) return;
      if (h.start > pos) parts.push(value.slice(pos, h.start));
      parts.push(
        <span key={i} className="wa-input-mention">
          {value.slice(h.start, h.end)}
        </span>,
      );
      pos = h.end;
    });
    // Un salto de línea al final necesita algo después para ocupar su renglón.
    parts.push(`${value.slice(pos)}​`);
  }

  return (
    <div className={`wa-input-box${on ? ' has-mentions' : ''}`}>
      <textarea
        ref={area}
        value={value}
        className={className}
        onScroll={(e) => {
          if (on) sync();
          onScroll?.(e);
        }}
        {...rest}
      />
      {on && (
        <div ref={mirror} className="wa-input-mirror" aria-hidden="true" data-testid="mention-mirror">
          {parts}
        </div>
      )}
    </div>
  );
});

export default MentionTextarea;
