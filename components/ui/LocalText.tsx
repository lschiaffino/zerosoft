'use client';

import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { useMounted } from './useMounted';

const HOLD: CSSProperties = { visibility: 'hidden' };

/**
 * Texto que depende de la zona, del idioma o del "ahora" del navegador (fechas,
 * horas, "hace 5 min"). El servidor lo escribe con su zona y el navegador con la
 * suya, y esa diferencia rompe la hidratación (#418).
 *
 * El HTML del servidor queda oculto pero ocupando su lugar, así no se mueve nada;
 * al hidratar se escribe el texto del navegador y se muestra. Lo que se monta
 * después de hidratar se ve de entrada. Solo admite texto: suppressHydrationWarning
 * no llega más allá de los hijos directos.
 */
export default function LocalText({ children, className }: { children: string | number | null | undefined; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const mounted = useMounted();
  const text = children === null || children === undefined ? '' : String(children);
  // React no corrige una diferencia que se le pidió ignorar: cree que el DOM ya dice `text`.
  useLayoutEffect(() => {
    if (ref.current && ref.current.textContent !== text) ref.current.textContent = text;
  }, [text]);
  return (
    <span ref={ref} className={className} style={mounted ? undefined : HOLD} suppressHydrationWarning>
      {text}
    </span>
  );
}
