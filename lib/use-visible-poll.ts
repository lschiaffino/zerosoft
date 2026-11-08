'use client';

import { useEffect, useRef } from 'react';
import { whenIdle } from './idle';

/**
 * Sondeo que respeta la pestaña: corre `fn` al montar, cada `ms` mientras la
 * pestaña está visible y una vez al volver a ella (si pasó al menos `minGapMs`
 * desde la última corrida). Con la pestaña oculta no pide nada: una pestaña
 * olvidada no gasta red, batería ni funciones del servidor.
 */
export function useVisiblePoll(
  fn: () => unknown,
  ms: number,
  opts: { enabled?: boolean; minGapMs?: number; /** La primera corrida espera a que el navegador esté libre (ver lib/idle.ts). */ idleStart?: boolean } = {},
) {
  const { enabled = true, minGapMs = 5_000, idleStart = false } = opts;
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (!enabled) return;
    let last = 0;
    const run = () => {
      last = Date.now();
      void fnRef.current();
    };
    const tick = () => {
      if (document.visibilityState === 'visible') run();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - last >= minGapMs) run();
    };
    const cancelStart = idleStart ? whenIdle(run) : (run(), () => {});
    const id = setInterval(tick, ms);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelStart();
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [ms, enabled, minGapMs, idleStart]);
}
