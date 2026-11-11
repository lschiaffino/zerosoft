'use client';

import { useEffect, useRef } from 'react';
import { whenIdle } from './idle';

/**
 * ¿Toca consultar en esta vuelta del reloj? Oculta: nunca. A la vista y con
 * foco: siempre. A la vista sin foco (otra ventana encima, otro monitor, la
 * app de escritorio en segundo plano): solo si pasó `unfocusedMs` desde la
 * última consulta. Pura (se prueba sola).
 */
export function pollDue(state: { visible: boolean; focused: boolean; sinceLastMs: number }, unfocusedMs?: number): boolean {
  if (!state.visible) return false;
  if (state.focused || unfocusedMs === undefined) return true;
  return state.sinceLastMs >= unfocusedMs;
}

/**
 * Espera después de `failures` pedidos fallidos seguidos: el doble cada vez,
 * hasta `maxMs`. Cero sin fallas. Pura.
 */
export function failureBackoffMs(failures: number, baseMs: number, maxMs: number): number {
  if (failures <= 0) return 0;
  return Math.min(maxMs, baseMs * 2 ** Math.min(failures - 1, 10));
}

/**
 * Sondeo que respeta la pestaña: corre `fn` al montar, cada `ms` mientras la
 * pestaña está visible y una vez al volver a ella (si pasó al menos `minGapMs`
 * desde la última corrida). Con la pestaña oculta no pide nada: una pestaña
 * olvidada no gasta red, batería ni funciones del servidor. Con `unfocusedMs`,
 * una ventana a la vista pero sin foco consulta recién cada ese tiempo (y en
 * el acto cuando vuelve el foco).
 */
export function useVisiblePoll(
  fn: () => unknown,
  ms: number,
  opts: { enabled?: boolean; minGapMs?: number; /** La primera corrida espera a que el navegador esté libre (ver lib/idle.ts). */ idleStart?: boolean; unfocusedMs?: number } = {},
) {
  const { enabled = true, minGapMs = 5_000, idleStart = false, unfocusedMs } = opts;
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
      if (pollDue({ visible: document.visibilityState === 'visible', focused: document.hasFocus(), sinceLastMs: Date.now() - last }, unfocusedMs)) run();
    };
    // Visibilidad y foco llegan juntos al volver: una sola corrida.
    const onReturn = () => {
      if (document.visibilityState === 'visible' && Date.now() - last >= minGapMs) run();
    };
    const cancelStart = idleStart ? whenIdle(run) : (run(), () => {});
    const id = setInterval(tick, ms);
    document.addEventListener('visibilitychange', onReturn);
    if (unfocusedMs !== undefined) window.addEventListener('focus', onReturn);
    return () => {
      cancelStart();
      clearInterval(id);
      document.removeEventListener('visibilitychange', onReturn);
      if (unfocusedMs !== undefined) window.removeEventListener('focus', onReturn);
    };
  }, [ms, enabled, minGapMs, idleStart, unfocusedMs]);
}
