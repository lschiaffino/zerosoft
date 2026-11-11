'use client';

import { useEffect, useRef } from 'react';

/**
 * Corre `fn` cuando la persona vuelve a la ventana (foco, o la pestaña otra
 * vez visible). Conectar una cuenta pasa en otra pestaña o, en la app de
 * escritorio, en el navegador del sistema: al volver, los ajustes muestran la
 * cuenta sin recargar. `enabled` en false cuando no hay nada que esperar (p.
 * ej. ya conectada), para no pisar lo que se está editando.
 */
export function useRefetchOnReturn(fn: () => unknown, enabled = true, minGapMs = 2_000) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (!enabled) return;
    let last = Date.now();
    const run = () => {
      // Foco y visibilidad llegan juntos: una sola corrida.
      if (document.visibilityState !== 'visible' || Date.now() - last < minGapMs) return;
      last = Date.now();
      void fnRef.current();
    };
    window.addEventListener('focus', run);
    document.addEventListener('visibilitychange', run);
    return () => {
      window.removeEventListener('focus', run);
      document.removeEventListener('visibilitychange', run);
    };
  }, [enabled, minGapMs]);
}
