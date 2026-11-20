'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePathname } from '@/i18n/navigation';
import { anchorFromHash, SETTING_FOCUS_EVENT } from '@/lib/settings-search';

const FLASH_MS = 2400;
const WAIT_MS = 8000;
let stop: (() => void) | null = null;

/**
 * Centra el ajuste en su contenedor con scroll (el contenido de la app o la
 * ventana). scrollIntoView también mueve los contenedores con overflow oculto
 * del marco de la app y deja un hueco arriba de la banda.
 */
function scrollToCenter(el: HTMLElement, behavior: ScrollBehavior) {
  let box: HTMLElement | null = el.parentElement;
  while (box && box !== document.body && box !== document.documentElement) {
    const o = getComputedStyle(box).overflowY;
    if ((o === 'auto' || o === 'scroll') && box.scrollHeight > box.clientHeight) break;
    box = box.parentElement;
  }
  const r = el.getBoundingClientRect();
  if (!box || box === document.body || box === document.documentElement) {
    const top = r.top + window.scrollY - Math.max(96, (window.innerHeight - r.height) / 2);
    window.scrollTo({ top: Math.max(0, top), behavior });
    return;
  }
  const b = box.getBoundingClientRect();
  const top = r.top - b.top + box.scrollTop - Math.max(24, (box.clientHeight - r.height) / 2);
  box.scrollTo({ top: Math.max(0, top), behavior });
}

/** Baja hasta el ajuste y lo marca un momento; deja `data-setting-flashed` en <html> (lo miran los tests). */
function mark(el: HTMLElement, anchor: string) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  scrollToCenter(el, reduce ? 'auto' : 'smooth');
  el.classList.remove('st-flash');
  void el.offsetWidth;
  el.classList.add('st-flash');
  el.setAttribute('data-flash', '');
  document.documentElement.setAttribute('data-setting-flashed', anchor);
  window.setTimeout(() => {
    el.classList.remove('st-flash');
    el.removeAttribute('data-flash');
  }, FLASH_MS);
  // El hash ya cumplió: sin él, recargar no vuelve a marcar.
  if (anchorFromHash(window.location.hash) === anchor) window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
}

/** Espera a que el ajuste esté en la página (pestañas que cargan, paneles que hidratan) y lo marca. */
function flash(anchor: string) {
  stop?.();
  const started = performance.now();
  let timer = 0;
  const tick = () => {
    const el = document.querySelector<HTMLElement>(`[data-setting="${CSS.escape(anchor)}"]`);
    if (el && el.getClientRects().length > 0) {
      stop = null;
      mark(el, anchor);
      return;
    }
    if (performance.now() - started < WAIT_MS) timer = window.setTimeout(tick, 80);
  };
  stop = () => window.clearTimeout(timer);
  tick();
}

/**
 * Marca el ajuste que pidió la búsqueda de Ajustes (o ⌘K): al llegar a una
 * página con #setting-<ancla>, o con el evento SETTING_FOCUS_EVENT cuando la
 * página no cambia. Va una vez en el layout de la app.
 */
export default function SettingHighlighter() {
  const pathname = usePathname();
  const search = useSearchParams();
  const query = search?.toString() ?? '';

  useEffect(() => {
    const anchor = anchorFromHash(window.location.hash);
    if (anchor) flash(anchor);
  }, [pathname, query]);

  useEffect(() => {
    const onEvent = (e: Event) => {
      const anchor = (e as CustomEvent<{ anchor?: string }>).detail?.anchor;
      if (anchor) flash(anchor);
    };
    const onHash = () => {
      const anchor = anchorFromHash(window.location.hash);
      if (anchor) flash(anchor);
    };
    window.addEventListener(SETTING_FOCUS_EVENT, onEvent);
    window.addEventListener('hashchange', onHash);
    return () => {
      window.removeEventListener(SETTING_FOCUS_EVENT, onEvent);
      window.removeEventListener('hashchange', onHash);
      stop?.();
    };
  }, []);

  return null;
}
