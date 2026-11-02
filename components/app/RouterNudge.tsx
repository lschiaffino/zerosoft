'use client';

import { useEffect, useState } from 'react';
import { nudgeActive, NUDGE_EVERY_MS } from '@/lib/router-nudge';

/**
 * Destraba navegaciones que React dejó en espera sin motivo.
 *
 * Si un dato de la respuesta del servidor llega justo mientras React renderiza una
 * transición, el aviso de "ya está" se pierde (pingSuspendedRoot no hace nada dentro
 * del render) y la transición queda suspendida hasta el próximo update de cualquier
 * componente: el clic en un link no cambiaba la URL ni abría nada durante hasta 15 s,
 * lo que tardaba otro contador de la app en actualizarse. Está en el React que trae
 * Next 15.5 (react-dom 19.3 ya lo corrige, pero el App Router usa el suyo): al subir
 * a una versión de Next con ese arreglo, este componente se puede borrar.
 *
 * Un commit limpia las transiciones suspendidas y React las vuelve a intentar. Por eso
 * este componente vacío se actualiza mientras puede haber una navegación en curso:
 * al cargar y después de que la persona haga algo. Quieto no corre ningún timer.
 */
export default function RouterNudge() {
  const [, setTick] = useState(0);

  useEffect(() => {
    let lastActivity = performance.now();
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const start = () => {
      lastActivity = performance.now();
      timer ??= setInterval(() => {
        if (!nudgeActive(performance.now(), lastActivity)) stop();
        else if (document.visibilityState === 'visible') setTick((n) => n + 1);
      }, NUDGE_EVERY_MS);
    };
    start();
    const events = ['pointerdown', 'keydown', 'popstate'] as const;
    for (const e of events) window.addEventListener(e, start, true);
    return () => {
      stop();
      for (const e of events) window.removeEventListener(e, start, true);
    };
  }, []);

  return null;
}
