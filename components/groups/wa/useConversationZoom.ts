'use client';

import { useEffect } from 'react';
import { ZOOM_MIN, ZOOM_PANE, ZOOM_STORAGE_KEY, clampZoom, isPinchWheel, readStoredZoom, zoomAfterGesture, zoomAfterWheel } from '@/lib/wa-conversation-zoom';

/** El evento de pellizco de Safari y WKWebView (no está en lib.dom). */
type GestureEvent = UIEvent & { scale: number; clientX: number; clientY: number };

const paneOf = (target: EventTarget | null): HTMLElement | null => (target instanceof Element ? target.closest<HTMLElement>(ZOOM_PANE) : null);

/**
 * El pellizco del trackpad en Lines e Inbox: sobre los mensajes agranda solo
 * la conversación (hasta 200%, nunca por debajo de 100%); sobre el resto de la
 * app no hace nada. Antes agrandaba la página entera y rompía el diseño.
 *
 * - El nivel va en `--wa-zoom` sobre <html>; styles/groups-wa.css escala con
 *   él la tipografía y los adjuntos del panel de mensajes. No se usa `zoom` ni
 *   `transform`: así las burbujas se reacomodan y no aparece scroll lateral.
 * - Se recuerda por navegador (localStorage).
 * - Vuelve a 100% pellizcando hacia afuera, o con Cmd/Ctrl+0 con el foco en
 *   los mensajes o el puntero encima (solo si hay zoom: sin zoom el atajo es
 *   del navegador).
 * - No toca Cmd/Ctrl +/−, ni Ctrl + rueda del mouse, ni el zoom de
 *   accesibilidad del sistema. Si la página ya está ampliada por el navegador
 *   no intercepta nada, para que se pueda volver.
 */
export function useConversationZoom(): void {
  useEffect(() => {
    const root = document.documentElement;
    let zoom = ZOOM_MIN;
    try {
      zoom = readStoredZoom(window.localStorage.getItem(ZOOM_STORAGE_KEY));
    } catch {
      /* sin almacenamiento: vale para esta visita */
    }
    let frame = 0;
    let settle: ReturnType<typeof setTimeout> | undefined;
    let anchor: { pane: HTMLElement; y: number } | null = null;

    const paint = () => {
      frame = 0;
      // El punto bajo el puntero queda en su lugar (y el final de la conversación sigue siendo el final).
      const a = anchor;
      const before = a ? { atEnd: a.pane.scrollHeight - a.pane.scrollTop - a.pane.clientHeight < 4, ratio: (a.pane.scrollTop + a.y) / Math.max(1, a.pane.scrollHeight) } : null;
      if (zoom === ZOOM_MIN) {
        root.style.removeProperty('--wa-zoom');
        root.removeAttribute('data-wa-zoom');
      } else {
        root.style.setProperty('--wa-zoom', String(zoom));
        root.setAttribute('data-wa-zoom', String(Math.round(zoom * 100)));
      }
      if (a && before) a.pane.scrollTop = before.atEnd ? a.pane.scrollHeight : before.ratio * a.pane.scrollHeight - a.y;
    };
    const store = () => {
      try {
        if (clampZoom(zoom) === ZOOM_MIN) window.localStorage.removeItem(ZOOM_STORAGE_KEY);
        else window.localStorage.setItem(ZOOM_STORAGE_KEY, String(clampZoom(zoom)));
      } catch {
        /* queda para esta visita */
      }
    };
    const apply = (next: number, at?: { pane: HTMLElement; clientY: number }) => {
      if (next === zoom) return;
      zoom = next;
      anchor = at ? { pane: at.pane, y: at.clientY - at.pane.getBoundingClientRect().top } : null;
      if (!frame) frame = requestAnimationFrame(paint);
      // Al soltar: el nivel se redondea (cerca de 100% vuelve a 100% justo) y se guarda.
      if (settle) clearTimeout(settle);
      settle = setTimeout(() => {
        settle = undefined;
        const rounded = clampZoom(zoom);
        if (rounded !== zoom) {
          zoom = rounded;
          if (!frame) frame = requestAnimationFrame(paint);
        }
        store();
      }, 250);
    };
    /** La página ya está ampliada por el navegador: no se intercepta, para que el mismo gesto la devuelva. */
    const pageMagnified = () => (window.visualViewport?.scale ?? 1) > 1.01;

    const onWheel = (e: WheelEvent) => {
      if (!isPinchWheel(e) || pageMagnified()) return;
      e.preventDefault();
      const pane = paneOf(e.target);
      if (pane) apply(zoomAfterWheel(zoom, e.deltaY), { pane, clientY: e.clientY });
    };

    let gesture: { start: number; pane: HTMLElement | null } | null = null;
    const onGestureStart = (ev: Event) => {
      if (pageMagnified()) {
        gesture = null;
        return;
      }
      ev.preventDefault();
      gesture = { start: zoom, pane: paneOf(ev.target) };
    };
    const onGestureChange = (ev: Event) => {
      if (!gesture) return;
      ev.preventDefault();
      const e = ev as GestureEvent;
      if (gesture.pane) apply(zoomAfterGesture(gesture.start, e.scale), { pane: gesture.pane, clientY: e.clientY });
    };
    const onGestureEnd = (ev: Event) => {
      if (!gesture) return;
      ev.preventDefault();
      gesture = null;
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '0' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || zoom === ZOOM_MIN) return;
      // Con el foco en los mensajes o el puntero encima (el panel de Lines no toma foco al hacer clic).
      const pane = paneOf(document.activeElement) ?? Array.from(document.querySelectorAll<HTMLElement>(ZOOM_PANE)).find((el) => el.matches(':hover')) ?? null;
      if (!pane) return;
      e.preventDefault();
      apply(ZOOM_MIN, { pane, clientY: pane.getBoundingClientRect().top + pane.clientHeight / 2 });
    };

    if (zoom !== ZOOM_MIN) paint();
    // No pasivos: hace falta preventDefault. En captura: ningún panel con su propio manejo de la rueda lo deja pasar.
    window.addEventListener('wheel', onWheel, { passive: false, capture: true });
    window.addEventListener('gesturestart', onGestureStart, { passive: false, capture: true });
    window.addEventListener('gesturechange', onGestureChange, { passive: false, capture: true });
    window.addEventListener('gestureend', onGestureEnd, { passive: false, capture: true });
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('wheel', onWheel, { capture: true });
      window.removeEventListener('gesturestart', onGestureStart, { capture: true });
      window.removeEventListener('gesturechange', onGestureChange, { capture: true });
      window.removeEventListener('gestureend', onGestureEnd, { capture: true });
      window.removeEventListener('keydown', onKey, true);
      if (frame) cancelAnimationFrame(frame);
      if (settle) {
        clearTimeout(settle);
        store();
      }
      root.style.removeProperty('--wa-zoom');
      root.removeAttribute('data-wa-zoom');
    };
  }, []);
}
