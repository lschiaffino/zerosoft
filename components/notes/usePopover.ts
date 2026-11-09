'use client';

import { useCallback, useRef, useState } from 'react';
import { useLayer } from '@/lib/ui/layers';

/**
 * Popover anclado a un botón (compartir de Notes y Board): se cierra con un
 * clic afuera o con Esc, y Esc devuelve el foco al botón que lo abrió. Es una
 * capa más (lib/ui/layers.ts): abrirlo cierra cualquier otro menú abierto.
 */
export function usePopover<W extends HTMLElement = HTMLDivElement, B extends HTMLElement = HTMLButtonElement>() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<W>(null);
  const buttonRef = useRef<B>(null);

  const close = useCallback((returnFocus = false) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  useLayer(open, () => setOpen(false), { root: wrapRef, trigger: buttonRef });

  return { open, setOpen, toggle: () => setOpen((v) => !v), close, wrapRef, buttonRef };
}
