'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from '@/i18n/navigation';

/** Cada cuánto se sondea con la pestaña visible (como Track: sin websockets en el stack). */
export const CRM_LIVE_INTERVAL_MS = 5000;

export type CrmLiveTarget =
  | { list: 'contacts' | 'companies' | 'deals'; ids?: string[]; pipelineId?: string }
  | { record: { kind: 'contact' | 'company' | 'deal'; id: string } };

/**
 * CRM en vivo: sondea POST /api/crm/live y, cuando la firma cambia (un
 * compañero cambió algo que esta persona ve), llama a `onChange`. Por defecto
 * recarga la página del servidor (router.refresh), que vuelve a pedir todo con
 * el alcance de siempre; la vista previa pasa su propia recarga. La primera
 * firma solo se guarda. Pausado con la pestaña oculta; vuelve al enfocarla.
 */
export function useCrmLive(target: CrmLiveTarget | null, onChange?: () => void, opts: { enabled?: boolean } = {}): void {
  const router = useRouter();
  const enabled = opts.enabled ?? true;
  const onChangeRef = useRef<() => void>(() => router.refresh());
  onChangeRef.current = onChange ?? (() => router.refresh());
  // Más de 500 filas (un board grande): se firman las primeras y el resto cuenta por cantidad (lib/crm-live.ts).
  const key = target ? JSON.stringify('list' in target && target.ids ? { ...target, ids: target.ids.slice(0, 500) } : target) : '';

  useEffect(() => {
    if (!key || !enabled) return;
    let last: string | null = null;
    let alive = true;
    let busy = false;
    const tick = async () => {
      if (!alive || busy || document.visibilityState !== 'visible') return;
      busy = true;
      try {
        const res = await fetch('/api/crm/live', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: key });
        if (!res.ok || !alive) return;
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
    const timer = window.setInterval(() => void tick(), CRM_LIVE_INTERVAL_MS);
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
