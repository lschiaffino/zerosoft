'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Popover anclado a un botón (compartir de Notes y Board): se cierra con un
 * clic afuera o con Esc, y Esc devuelve el foco al botón que lo abrió.
 */
export function usePopover<W extends HTMLElement = HTMLDivElement, B extends HTMLElement = HTMLButtonElement>() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<W>(null);
  const buttonRef = useRef<B>(null);

  const close = useCallback((returnFocus = false) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(true);
      }
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  return { open, setOpen, toggle: () => setOpen((v) => !v), close, wrapRef, buttonRef };
}
