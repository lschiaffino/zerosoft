'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from '@/i18n/navigation';

/** Cada cuánto se sondea con la pestaña visible (como Track: sin websockets en el stack). */
export const CRM_LIVE_INTERVAL_MS = 5000;

export type CrmLiveTarget =
  | { list: 'contacts' | 'companies' | 'deals' | 'leads'; ids?: string[]; pipelineId?: string }
  | { record: { kind: 'contact' | 'company' | 'deal'; id: string } };

/**
 * CRM en vivo: sondea POST /api/crm/live y, cuando la firma cambia (un
 * compañero cambió algo que esta persona ve), llama a `onChange`. Por defecto
 * recarga la página del servidor (router.refresh), que vuelve a pedir todo con
 * el alcance de siempre; la vista previa pasa su propia recarga. La primera
 * firma solo se guarda. Pausado con la pestaña oculta; vuelve al enfocarla.
 *
 * `onGone`: la ficha que se veía dejó de estar (la ruta responde 404, igual si
 * otra persona la borró que si ya no está en su alcance) y la vista avisa en
 * vez de recargar a un 404. Deja de sondear.
 */
export function useCrmLive(target: CrmLiveTarget | null, onChange?: () => void, opts: { enabled?: boolean; onGone?: () => void } = {}): void {
  const router = useRouter();
  const enabled = opts.enabled ?? true;
  const onChangeRef = useRef<() => void>(() => router.refresh());
  onChangeRef.current = onChange ?? (() => router.refresh());
  const onGoneRef = useRef(opts.onGone);
  onGoneRef.current = opts.onGone;
  // Más de 500 filas (un board grande): se firman las primeras y el resto cuenta por cantidad (lib/crm-live.ts).
  const key = target ? JSON.stringify('list' in target && target.ids ? { ...target, ids: target.ids.slice(0, 500) } : target) : '';

  useEffect(() => {
    if (!key || !enabled) return;
    let last: string | null = null;
    let alive = true;
    let busy = false;
    let timer = 0;
    const tick = async () => {
      // Sin red no se sondea (y el modo offline nunca lo encola: lib/offline-queue.ts NEVER_QUEUE).
      if (!alive || busy || document.visibilityState !== 'visible' || !navigator.onLine) return;
      busy = true;
      try {
        const res = await fetch('/api/crm/live', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: key });
        if (!alive) return;
        if (res.status === 404 && last !== null && onGoneRef.current) {
          alive = false;
          window.clearInterval(timer);
          onGoneRef.current();
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as { sig?: string };
        if (!data.sig) return;
        if (last !== null && data.sig !== last) onChangeRef.current();
        last = data.sig;
      } catch {
        // Sin red: se reintenta en la próxima vuelta.
      } finally {
        busy = false;
      }
    };
    void tick();
    timer = window.setInterval(() => void tick(), CRM_LIVE_INTERVAL_MS);
    const onVisible = () => void tick();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [key, enabled]);
}
