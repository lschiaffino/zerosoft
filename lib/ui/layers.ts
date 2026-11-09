'use client';

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * Capas flotantes de la app: un solo registro para menús, popovers y paneles.
 *
 * Reglas (las mismas en toda la app):
 * - Abrir un menú cierra cualquier otro menú abierto, salvo los que lo
 *   contienen (un picker dentro de un menú o de un diálogo sigue anidado).
 * - Abrir un diálogo (⌘K, el asistente, un modal) cierra los menús de afuera.
 * - Clic afuera (pointerdown, en captura: un stopPropagation no lo esconde) y
 *   Esc cierran; Esc devuelve el foco al botón que abrió la capa.
 * - El panel se acomoda dentro de la pantalla: se da vuelta (arriba/abajo,
 *   izquierda/derecha) en vez de taparse su propio botón, y si no entra de
 *   ningún lado se achica con scroll.
 *
 * Los menús que todavía no usan el hook los cubre MenuLayerGuard (mira
 * aria-expanded de los botones con aria-haspopup).
 */

export type LayerKind = 'menu' | 'dialog';
export type CloseReason = 'outside' | 'escape' | 'other-layer';

interface Layer {
  id: number;
  kind: LayerKind;
  root: () => HTMLElement | null;
  trigger: () => HTMLElement | null;
  close: (reason: CloseReason) => void;
}

const layers: Layer[] = [];
let seq = 0;

/** Marca de los botones que abren una capa registrada (MenuLayerGuard los deja al registro). */
export const LAYER_TRIGGER_ATTR = 'data-layer-trigger';

function contains(root: HTMLElement | null, node: Node | null): boolean {
  return Boolean(root && node && root.contains(node));
}

/** ¿La capa `outer` contiene a `inner` (su botón o su panel)? Entonces `inner` es un submenú de `outer`. */
function nests(outer: Layer, inner: { root: () => HTMLElement | null; trigger: () => HTMLElement | null }): boolean {
  const root = outer.root();
  return contains(root, inner.trigger()) || contains(root, inner.root());
}

/** Cierra los menús abiertos que no contienen a `node` (un menú o diálogo que se acaba de abrir). */
export function closeMenusOutside(node: Node | null, except?: number) {
  for (const layer of [...layers]) {
    if (layer.id === except || layer.kind !== 'menu') continue;
    if (node && (contains(layer.root(), node) || contains(layer.trigger(), node))) continue;
    layer.close('other-layer');
  }
}

const POPUP_TRIGGER = '[aria-haspopup]:not([aria-haspopup="false"])';
const PANEL = '[role="menu"], [role="dialog"], [role="listbox"], [role="tree"], [role="grid"], dialog';

/**
 * Menús que todavía arman su propio estado (no usan useLayer): se los ve por
 * su botón con aria-haspopup y aria-expanded="true". Se cierran los que no
 * contienen a `opened` (lo que se acaba de abrir), apretando su botón.
 */
export function closeUnregisteredPopups(opened: HTMLElement) {
  if (typeof document === 'undefined') return;
  const stale: HTMLElement[] = [];
  for (const old of document.querySelectorAll<HTMLElement>(`${POPUP_TRIGGER}[aria-expanded="true"]`)) {
    if (old === opened || old.hasAttribute(LAYER_TRIGGER_ATTR) || opened.contains(old)) continue;
    // Copias ocultas del mismo botón (listas que se miden con un duplicado invisible) no son otro menú.
    if (!old.getClientRects().length || getComputedStyle(old).visibility === 'hidden') continue;    // Anidado: lo nuevo vive dentro del panel (menú o diálogo) que abrió el viejo.
    const host = opened.closest(PANEL);
    const scope = (old.getAttribute('aria-controls') && document.getElementById(old.getAttribute('aria-controls')!)) || old.parentElement;
    if (host && !host.contains(old) && scope?.contains(host)) continue;
    if (scope?.contains(opened) && !old.parentElement?.isSameNode(opened.parentElement)) continue;
    stale.push(old);
  }
  if (!stale.length) return;
  // Con su propio botón (alterna): un mousedown sintético sobre lo nuevo lo cerraría a él, porque muchos menús
  // cuentan su botón como "afuera" del panel.
  requestAnimationFrame(() => {
    for (const old of stale) {
      if (!old.isConnected || old.getAttribute('aria-expanded') !== 'true') continue;
      if (old instanceof HTMLButtonElement && !old.disabled) old.click();
    }
  });
}

/** Registra una capa abierta y cierra las que no la contienen. Devuelve la función para quitarla. */
export function openLayer(input: Omit<Layer, 'id'>): { id: number; release: () => void } {
  const layer: Layer = { ...input, id: ++seq };
  for (const other of [...layers]) {
    if (other.kind !== 'menu' || nests(other, layer)) continue;
    other.close('other-layer');
  }
  const anchor = layer.trigger() ?? layer.root();
  if (anchor) closeUnregisteredPopups(anchor);
  layers.push(layer);
  return {
    id: layer.id,
    release: () => {
      const i = layers.findIndex((l) => l.id === layer.id);
      if (i >= 0) layers.splice(i, 1);
    },
  };
}

/**
 * A dónde vuelve el foco cuando se cierra un diálogo abierto desde `el`: si
 * `el` es un ítem de un menú (que se cierra al abrirse el diálogo), al botón
 * de ese menú; si no, a `el`.
 */
export function focusReturnTarget(el: Element | null): HTMLElement | null {
  if (!(el instanceof HTMLElement)) return null;
  const menu = el.closest('[role="menu"], [role="listbox"]');
  if (!menu) return el;
  const owner = [...document.querySelectorAll<HTMLElement>('[aria-haspopup][aria-expanded="true"]')].find((b) => b.parentElement?.contains(menu));
  return owner ?? el;
}

/** Cantidad de capas registradas abiertas (para tests y depuración). */
export function openLayerCount(): number {
  return layers.length;
}

/** ¿Es la última capa abierta? Esc cierra solo esa. */
function isTop(id: number): boolean {
  return layers.length > 0 && layers[layers.length - 1].id === id;
}

const MARGIN = 8;
const GAP = 4;

/**
 * Acomoda un panel ya pintado dentro de la ventana sin taparle el botón: si se
 * sale por abajo y arriba hay lugar, abre para arriba (y al revés); si se sale
 * de costado, se corre; si no entra de ningún lado, se achica con scroll.
 */
export function fitToViewport(panel: HTMLElement, trigger: HTMLElement | null) {
  panel.style.translate = '';
  panel.style.maxHeight = '';
  const r = panel.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = window.innerHeight;
  const t = trigger?.getBoundingClientRect() ?? null;
  let dx = 0;
  let dy = 0;
  let maxH: number | null = null;

  const beside = t ? r.left >= t.right - 1 || r.right <= t.left + 1 : false;
  if (t && beside) {
    // Al costado del botón (sidebar colapsado): si no entra a la derecha, va a la izquierda.
    if (r.right > vw - MARGIN && t.left - GAP - r.width >= MARGIN) dx = t.left - GAP - r.width - r.left;
    if (r.bottom > vh - MARGIN) dy = vh - MARGIN - r.bottom;
    if (r.top + dy < MARGIN) dy = MARGIN - r.top;
    if (r.height > vh - 2 * MARGIN) maxH = vh - 2 * MARGIN;
  } else {
    if (r.right > vw - MARGIN) dx = vw - MARGIN - r.right;
    if (r.left + dx < MARGIN) dx = MARGIN - r.left;
    if (t) {
      const below = r.top >= t.bottom - 1;
      const spaceBelow = vh - MARGIN - t.bottom - GAP;
      const spaceAbove = t.top - GAP - MARGIN;
      if (below && r.bottom > vh - MARGIN) {
        if (r.height <= spaceAbove && spaceAbove > spaceBelow) dy = t.top - GAP - r.height - r.top;
        else maxH = Math.max(120, Math.max(spaceBelow, 0));
      } else if (!below && r.top < MARGIN) {
        if (r.height <= spaceBelow && spaceBelow > spaceAbove) dy = t.bottom + GAP - r.top;
        else {
          maxH = Math.max(120, Math.max(spaceAbove, 0));
          // Abre para arriba: achicarlo lo deja pegado al botón, sin salirse por arriba.
          dy = r.height - maxH;
        }
      }
    } else {
      if (r.bottom > vh - MARGIN) dy = vh - MARGIN - r.bottom;
      if (r.top + dy < MARGIN) dy = MARGIN - r.top;
    }
  }
  if (dx || dy) panel.style.translate = `${Math.round(dx)}px ${Math.round(dy)}px`;
  if (maxH !== null) {
    panel.style.maxHeight = `${Math.floor(maxH)}px`;
    panel.style.overflowY = 'auto';
  }
}

export interface LayerOptions {
  /** Contenedor del botón y el panel: un pointerdown adentro no cierra. */
  root: RefObject<HTMLElement | null>;
  /** Botón que abre la capa: recibe el foco al cerrar con Esc. */
  trigger?: RefObject<HTMLElement | null>;
  /** Panel a acomodar dentro de la ventana (si falta, no se mueve). */
  panel?: RefObject<HTMLElement | null>;
  kind?: LayerKind;
  /** Clic afuera cierra (por defecto sí en menús, no en diálogos). */
  outside?: boolean;
  /** Esc cierra (por defecto sí). Si el menú ya maneja Esc y hace preventDefault, no se cierra dos veces. */
  escape?: boolean;
}

/**
 * Hook de una capa: registro exclusivo, clic afuera, Esc con foco de vuelta al
 * botón y acomodo en pantalla. `close` puede cambiar en cada render.
 */
export function useLayer(open: boolean, close: (reason: CloseReason) => void, opts: LayerOptions) {
  const closeRef = useRef(close);
  closeRef.current = close;
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const kind = opts.kind ?? 'menu';
  const outside = opts.outside ?? kind === 'menu';
  const escape = opts.escape ?? true;

  useEffect(() => {
    if (!open) return;
    const root = () => optsRef.current.root.current;
    const trigger = () => optsRef.current.trigger?.current ?? null;
    const t = trigger();
    t?.setAttribute(LAYER_TRIGGER_ATTR, '');
    const { id, release } = openLayer({
      kind,
      root,
      trigger,
      close: (reason) => closeRef.current(reason),
    });

    function onPointer(e: PointerEvent | MouseEvent) {
      const target = e.target as Node | null;
      if (!target || contains(root(), target) || contains(trigger(), target)) return;
      // Un clic dentro de un submenú portaleado (capa abierta después, desde adentro) no cuenta como afuera.
      if (layers.some((l) => l.id > id && contains(l.root(), target) && contains(root(), l.trigger()))) return;
      closeRef.current('outside');
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape' || e.defaultPrevented || !isTop(id)) return;
      // Esc es de la capa de arriba: no cierra además el panel o la vista de abajo.
      e.preventDefault();
      e.stopPropagation();
      closeRef.current('escape');
      const btn = trigger();
      if (btn && document.contains(btn)) btn.focus();
    }
    if (outside) document.addEventListener('pointerdown', onPointer, true);
    if (escape) document.addEventListener('keydown', onKey);
    return () => {
      release();
      t?.removeAttribute(LAYER_TRIGGER_ATTR);
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, kind, outside, escape]);

  // Acomodo en pantalla: al abrir y cuando cambia el tamaño de la ventana.
  useIsoLayoutEffect(() => {
    if (!open) return;
    const fit = () => {
      const panel = optsRef.current.panel?.current;
      if (panel) fitToViewport(panel, optsRef.current.trigger?.current ?? null);
    };
    fit();
    // Lo que lo contiene puede estar animándose (el drawer entra deslizándose): se vuelve a medir al terminar.
    const frame = requestAnimationFrame(fit);
    window.addEventListener('resize', fit);
    document.addEventListener('transitionend', fit, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', fit);
      document.removeEventListener('transitionend', fit, true);
    };
  }, [open]);
}

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
