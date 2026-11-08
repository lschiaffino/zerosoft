'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { PrefetchKind } from 'next/dist/client/components/router-reducer/router-reducer-types';
import { INTENT_DWELL_MS, INTENT_FRESH_MS, INTENT_REFRESH_AFTER_MS, INTENT_SELECTOR, intentTarget, needsPrefetch } from '@/lib/intent-prefetch';

/** PrefetchKind.FULL (el enum es interno de Next; su valor es estable). */
const FULL = 'full' as PrefetchKind;

/**
 * Navegar entre apps sin esperar: con el puntero quieto un momento sobre un
 * link del sidebar o de las apps del inicio se precarga la página entera
 * (las rutas de la app son dinámicas y Next, solo, no las precarga). El clic
 * que sigue se resuelve con lo precargado. Si esa precarga ya tenía más de
 * un segundo, se refresca en segundo plano: nunca queda a la vista algo viejo.
 * Táctil no aplica (no hay hover); el teclado navega como siempre.
 */
export default function IntentPrefetch() {
  const router = useRouter();
  const pathname = usePathname();
  const fetchedAt = useRef(new Map<string, number>());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: Element | null = null;
    const cancel = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    };
    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const a = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>(INTENT_SELECTOR) : null;
      if (!a || a === pending) return;
      cancel();
      const target = intentTarget(
        { href: a.href, target: a.target, hasDownload: a.hasAttribute('download') },
        { origin: location.origin, pathname: location.pathname, search: location.search },
      );
      if (!target || !needsPrefetch(fetchedAt.current.get(target), Date.now())) return;
      pending = a;
      timer = setTimeout(() => {
        timer = null;
        pending = null;
        fetchedAt.current.set(target, Date.now());
        router.prefetch(target, { kind: FULL });
      }, INTENT_DWELL_MS);
    };
    const onOut = (e: PointerEvent) => {
      if (pending && !(e.relatedTarget instanceof Node && pending.contains(e.relatedTarget))) cancel();
    };
    document.addEventListener('pointerover', onOver, true);
    document.addEventListener('pointerout', onOut, true);
    return () => {
      cancel();
      document.removeEventListener('pointerover', onOver, true);
      document.removeEventListener('pointerout', onOut, true);
    };
  }, [router]);

  // Llegamos con una precarga de hace unos segundos: se pide la versión de ahora sin tapar la vista.
  useEffect(() => {
    const key = `${pathname}${location.search}`;
    const at = fetchedAt.current.get(key);
    if (at === undefined) return;
    fetchedAt.current.delete(key);
    // Vencida (más de INTENT_FRESH_MS), Next ya la pidió de nuevo al navegar: no hace falta.
    const age = Date.now() - at;
    if (age > INTENT_REFRESH_AFTER_MS && age < INTENT_FRESH_MS) router.refresh();
  }, [pathname, router]);

  return null;
}
