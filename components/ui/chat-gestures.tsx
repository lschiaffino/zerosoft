'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  autoScrollSpeed,
  chipPosition,
  commitAt,
  EXPAND_MS,
  HOLD_MS,
  holdBroken,
  openWidth,
  swipeCount,
  swipeEnd,
  swipeMove,
  swipeStart,
  SWIPE_SLOP,
  trayPlacement,
  type SwipeSide,
  type SwipeTrack,
  type TrayPlacement,
} from '@/lib/chat-gestures';

/**
 * Gestos de una fila de chat, compartidos por Lines e Inbox.
 *
 * - Deslizar a los costados (dedo, mouse o trackpad): atrás de la fila
 *   aparecen las acciones, como en WhatsApp. Soltar a mitad de camino las
 *   deja abiertas; deslizar hasta el fondo ejecuta la principal. Un gesto
 *   tiene un solo lado: volver frena en la fila cerrada y no abre el otro.
 *   Con la fila abierta, arrastrarla de vuelta (o tocarla, tocar otra o
 *   correr la lista) la cierra sin abrir el chat. Las cuentas están en
 *   lib/chat-gestures.ts (swipeStart, swipeMove, swipeEnd).
 * - Mantener apretado (o arrastrar con el mouse hacia arriba, abajo o fuera
 *   de la lista) levanta la conversación: una ficha chica sigue al puntero
 *   sin tapar lo que hay debajo, y se suelta sobre una carpeta. Las carpetas
 *   son cualquier elemento con `data-chat-drop` del mismo `scope` (el árbol
 *   del sidebar); si no hay ninguna a la vista aparece una bandeja con el
 *   árbol.
 *
 * El gesto vive fuera del render (las listas se vuelven a dibujar cada pocos
 * segundos): se guarda en un ref y se pinta con atributos y variables CSS
 * sobre la fila. React solo se entera de qué fila tiene acciones a la vista
 * y de si hay algo levantado.
 */

export type SwipeIcon = 'read' | 'unread' | 'pin' | 'unpin' | 'archive' | 'unarchive' | 'more';

export interface SwipeAction {
  key: string;
  label: string;
  icon: SwipeIcon;
  onSelect: () => void;
  /** La fila se va de la lista al ejecutarla (archivar): queda corrida hasta que desaparece. */
  leaves?: boolean;
}

/** Acciones por lado, de afuera hacia adentro: la primera es la principal (la que ejecuta el deslizado completo). */
export interface SwipeActions {
  /** Al deslizar hacia la izquierda (aparecen a la derecha). */
  left: SwipeAction[];
  /** Al deslizar hacia la derecha (aparecen a la izquierda). */
  right: SwipeAction[];
}

export interface TrayItem {
  id: string;
  name: string;
  depth: number;
}

export interface ChatGesturesOptions {
  /** Nombre del producto: une las filas con sus carpetas (`data-chat-drop-scope`). */
  scope: string;
  /** Acciones del deslizado para un chat; null si no se puede deslizar (modo selección). */
  actionsFor: (id: string) => SwipeActions | null;
  /** Chats que viajan al levantar este (la selección entera si está adentro). */
  idsFor: (id: string) => string[];
  /** Lo que muestra la ficha: el nombre del chat o "3 chats". */
  chipFor: (id: string, ids: string[]) => { label: string; avatar?: ReactNode };
  /** ¿Sirve soltar estos chats en esa carpeta? (false si ya están ahí). */
  canDrop: (ids: string[], target: string) => boolean;
  onDrop: (ids: string[], target: string, name: string) => void;
  /** Toque largo sin mover, con el dedo: el menú de la fila. */
  onHoldTap?: (id: string, row: HTMLElement) => void;
  /** Bandeja de carpetas para cuando el sidebar no está a la vista. */
  tray: { title: string; empty: string; items: TrayItem[] };
}

interface DragView {
  label: string;
  avatar?: ReactNode;
  count: number;
  touch: boolean;
  tray: TrayPlacement | null;
}

interface Live {
  phase: 'idle' | 'pending' | 'swipe' | 'drag' | 'dead';
  id: string;
  row: HTMLElement | null;
  pointerId: number;
  touch: boolean;
  sx: number;
  sy: number;
  x: number;
  y: number;
  /** El deslizado (lib/chat-gestures.ts). */
  track: SwipeTrack | null;
  /** La fila estaba abierta al apoyar: el gesto la sigue desde ahí. */
  wasOpen: boolean;
  list: DOMRect | null;
  hold: number;
  ready: boolean;
  ids: string[];
  moved: boolean;
  hover: HTMLElement | null;
  hoverOk: boolean;
  expand: number;
  raf: number;
  marker: number;
  scrollers: HTMLElement[];
  detach: (() => void) | null;
}

const idle = (): Live => ({
  phase: 'idle',
  id: '',
  row: null,
  pointerId: -1,
  touch: false,
  sx: 0,
  sy: 0,
  x: 0,
  y: 0,
  track: null,
  wasOpen: false,
  list: null,
  hold: 0,
  ready: false,
  ids: [],
  moved: false,
  hover: null,
  hoverOk: false,
  expand: 0,
  raf: 0,
  marker: 0,
  scrollers: [],
  detach: null,
});

const SETTLE_MS = 200;

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function buzz(ms: number) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // Sin vibración.
  }
}

/** Cada fila lleva la cuenta de su última animación: una nueva cancela el final de la anterior. */
const settleSeq = new WeakMap<HTMLElement, number>();

function paint(row: HTMLElement, x: number, side: SwipeSide) {
  row.style.setProperty('--swipe-x', `${x}px`);
  row.style.setProperty('--swipe-w', `${Math.abs(x)}px`);
  row.setAttribute('data-swipe', side);
}

function clearRow(row: HTMLElement) {
  settleSeq.set(row, (settleSeq.get(row) ?? 0) + 1);
  row.style.removeProperty('--swipe-x');
  row.style.removeProperty('--swipe-w');
  for (const a of ['data-swipe', 'data-swipe-commit', 'data-swipe-settling']) row.removeAttribute(a);
}

/** Lleva la fila a `x` con una transición corta y avisa al terminar. */
function settle(row: HTMLElement, x: number, side: SwipeSide, then?: () => void) {
  const mine = (settleSeq.get(row) ?? 0) + 1;
  settleSeq.set(row, mine);
  row.setAttribute('data-swipe-settling', '');
  paint(row, x, side);
  window.setTimeout(
    () => {
      if (settleSeq.get(row) !== mine) return;
      row.removeAttribute('data-swipe-settling');
      then?.();
    },
    reducedMotion() ? 0 : SETTLE_MS,
  );
}

/** ¿Hay alguna carpeta del producto a la vista? (el sidebar puede estar colapsado, o ser un cajón cerrado en el teléfono). */
function zoneOnScreen(scope: string): boolean {
  for (const zone of Array.from(document.querySelectorAll<HTMLElement>(`[data-chat-drop-zone="${scope}"]`))) {
    if (!zone.querySelector('[data-chat-drop]')) continue;
    const r = zone.getBoundingClientRect();
    const left = Math.max(r.left, 0);
    const right = Math.min(r.right, window.innerWidth);
    const top = Math.max(r.top, 0);
    const bottom = Math.min(r.bottom, window.innerHeight);
    if (right - left < 24 || bottom - top < 16) continue;
    const x = (left + right) / 2;
    for (const y of [top + 8, (top + bottom) / 2, bottom - 8]) {
      const el = document.elementFromPoint(x, y);
      if (el && zone.contains(el)) return true;
    }
  }
  return false;
}

/** Los contenedores que pueden correr alrededor de las carpetas (el sidebar, la bandeja). */
function scrollersOf(scope: string): HTMLElement[] {
  const out = new Set<HTMLElement>();
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(`[data-chat-drop-zone="${scope}"]`))) {
    let node: HTMLElement | null = el;
    while (node && node !== document.body) {
      const oy = getComputedStyle(node).overflowY;
      if (oy === 'auto' || oy === 'scroll') {
        out.add(node);
        break;
      }
      node = node.parentElement;
    }
  }
  return [...out];
}

const ICONS: Record<SwipeIcon, ReactNode> = {
  read: (
    <>
      <path d="M4 5h16v11H9l-5 4z" />
      <path d="m8.5 10.5 2.5 2.5 4.5-5" />
    </>
  ),
  unread: (
    <>
      <path d="M4 5h11.5M20 10.5V16H9l-5 4V5" />
      <circle cx="19" cy="5.5" r="2.5" fill="currentColor" stroke="none" />
    </>
  ),
  pin: <path d="M9 4h6l-1 6 3 3v2H7v-2l3-3zM12 15v6" />,
  unpin: (
    <>
      <path d="M9 4h6l-1 6 3 3v2H7v-2l3-3zM12 15v6" />
      <path d="M4 4l16 16" />
    </>
  ),
  archive: (
    <>
      <path d="M3 4h18v5H3zM5 9v11h14V9" />
      <path d="M12 12v5m-2.5-2.5L12 17l2.5-2.5" />
    </>
  ),
  unarchive: (
    <>
      <path d="M3 4h18v5H3zM5 9v11h14V9" />
      <path d="M12 17v-5m-2.5 2.5L12 12l2.5 2.5" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
};

function ActionStrip({ side, actions, onPick }: { side: SwipeSide; actions: SwipeAction[]; onPick: (a: SwipeAction) => void }) {
  return (
    <span className="zs-swipe-actions" data-side={side} data-testid="swipe-actions">
      {actions.map((a, i) => (
        <button key={a.key} type="button" className="zs-swipe-action" data-action={a.key} data-primary={i === 0 ? '' : undefined} onClick={() => onPick(a)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {ICONS[a.icon]}
          </svg>
          <span className="zs-swipe-action-label">{a.label}</span>
        </button>
      ))}
    </span>
  );
}

export interface ChatGestures {
  /** Props para el `<li>` de la fila. */
  rowProps: (id: string) => {
    'data-chat-row': string;
    draggable: false;
    ref: (el: HTMLLIElement | null) => void;
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    onClickCapture: (e: ReactMouseEvent<HTMLElement>) => void;
    onDragStart: (e: ReactDragEvent<HTMLElement>) => void;
  };
  /** Las acciones del deslizado, para dibujar adentro de la fila (null si esa fila no las tiene a la vista). */
  actions: (id: string) => ReactNode;
  /** La ficha que sigue al puntero y la bandeja de carpetas (un portal; va una vez por lista). */
  layer: ReactNode;
  closeSwipe: () => void;
}

export function useChatGestures(options: ChatGesturesOptions): ChatGestures {
  const opts = useRef(options);
  useEffect(() => {
    opts.current = options;
  });
  const live = useRef<Live>(idle());
  const open = useRef<{ id: string; row: HTMLElement } | null>(null);
  const swallowUntil = useRef(0);
  const closedByTap = useRef(false);
  const chipRef = useRef<HTMLDivElement>(null);
  const destRef = useRef<HTMLSpanElement>(null);
  const [swipe, setSwipe] = useState<{ id: string; side: SwipeSide } | null>(null);
  const [drag, setDrag] = useState<DragView | null>(null);

  const closeSwipe = useCallback((instant = false) => {
    const o = open.current;
    open.current = null;
    if (!o) return;
    const done = () => {
      clearRow(o.row);
      setSwipe((s) => (s?.id === o.id ? null : s));
    };
    if (instant || !o.row.isConnected) done();
    else settle(o.row, 0, (o.row.getAttribute('data-swipe') as SwipeSide | null) ?? 'left', done);
  }, []);

  const placeChip = useCallback(() => {
    const chip = chipRef.current;
    const L = live.current;
    if (!chip || L.phase !== 'drag') return;
    const p = chipPosition({ x: L.x, y: L.y, w: chip.offsetWidth, h: chip.offsetHeight, vw: window.innerWidth, vh: window.innerHeight, touch: L.touch });
    chip.style.transform = `translate3d(${p.left}px, ${p.top}px, 0)`;
    chip.setAttribute('data-placed', '');
  }, []);

  const markTargets = useCallback(() => {
    const L = live.current;
    const scope = opts.current.scope;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(`[data-chat-drop][data-chat-drop-scope="${scope}"]`))) {
      el.toggleAttribute('data-drop-disabled', !opts.current.canDrop(L.ids, el.dataset.chatDrop ?? ''));
    }
    for (const id of L.ids) {
      for (const row of Array.from(document.querySelectorAll<HTMLElement>(`[data-chat-row="${CSS.escape(id)}"]`))) row.setAttribute('data-chat-dragging', '');
    }
    // La bandeja aparece después de levantar, y abrir una carpeta cambia los altos: los contenedores se vuelven a buscar.
    L.scrollers = scrollersOf(scope);
  }, []);

  const setHover = useCallback((target: HTMLElement | null) => {
    const L = live.current;
    if (target === L.hover) return;
    L.hover?.removeAttribute('data-drop-hover');
    window.clearTimeout(L.expand);
    L.hover = target;
    L.hoverOk = !!target && opts.current.canDrop(L.ids, target.dataset.chatDrop ?? '');
    if (target && L.hoverOk) target.setAttribute('data-drop-hover', '');
    if (destRef.current) destRef.current.textContent = L.hoverOk ? (target?.dataset.chatDropName ?? '') : '';
    chipRef.current?.toggleAttribute('data-over', L.hoverOk);
    placeChip();
    // Una carpeta plegada con subcarpetas se abre sola al quedarse encima.
    const chevron = target?.querySelector<HTMLElement>('[data-chat-drop-expand][aria-expanded="false"]');
    if (chevron) {
      L.expand = window.setTimeout(() => {
        if (live.current.phase === 'drag' && live.current.hover === target && chevron.isConnected) {
          chevron.click();
          window.setTimeout(markTargets, 60);
        }
      }, EXPAND_MS);
    }
  }, [markTargets, placeChip]);

  /** La carpeta que está debajo del puntero (la ficha no cuenta: no recibe eventos). */
  const hitTest = useCallback(() => {
    const L = live.current;
    if (L.phase !== 'drag' || !L.moved) return;
    const el = document.elementFromPoint(L.x, L.y);
    setHover(el?.closest<HTMLElement>(`[data-chat-drop][data-chat-drop-scope="${opts.current.scope}"]`) ?? null);
  }, [setHover]);

  const frame = useCallback(() => {
    const L = live.current;
    if (L.phase !== 'drag') return;
    for (const s of L.scrollers) {
      if (!s.isConnected || s.scrollHeight <= s.clientHeight + 1) continue;
      const r = s.getBoundingClientRect();
      if (L.x < r.left || L.x > r.right) continue;
      const v = autoScrollSpeed(L.y, r.top, r.bottom);
      if (v) s.scrollTop += v;
    }
    placeChip();
    hitTest();
    L.raf = requestAnimationFrame(frame);
  }, [placeChip, hitTest]);

  const finish = useCallback(() => {
    const L = live.current;
    window.clearTimeout(L.hold);
    window.clearTimeout(L.expand);
    window.clearInterval(L.marker);
    cancelAnimationFrame(L.raf);
    L.detach?.();
    document.body.removeAttribute('data-chat-gesture');
    document.body.removeAttribute('data-chat-dragging');
    live.current = idle();
  }, []);

  /** Deja la pantalla como antes de levantar: sin resaltados, sin ficha. El gesto sigue vivo hasta soltar. */
  const dropVisuals = useCallback(() => {
    const L = live.current;
    window.clearTimeout(L.expand);
    window.clearInterval(L.marker);
    cancelAnimationFrame(L.raf);
    for (const a of ['data-drop-hover', 'data-drop-disabled', 'data-chat-dragging']) {
      for (const el of Array.from(document.querySelectorAll(`[${a}]`))) el.removeAttribute(a);
    }
    document.body.removeAttribute('data-chat-dragging');
    L.hover = null;
    setDrag(null);
  }, []);

  const beginDrag = useCallback(() => {
    const L = live.current;
    const row = L.row;
    if (!row) return;
    window.clearTimeout(L.hold);
    if (L.phase === 'swipe') {
      clearRow(row);
      setSwipe(null);
    }
    closeSwipe(true);
    const o = opts.current;
    L.phase = 'drag';
    L.ids = o.idsFor(L.id);
    L.moved = false;
    L.sx = L.x;
    L.sy = L.y;
    if (L.touch) buzz(10);
    document.body.setAttribute('data-chat-gesture', 'drag');
    document.body.setAttribute('data-chat-dragging', o.scope);
    const list = (row.closest<HTMLElement>('[data-chat-list]') ?? row.parentElement ?? row).getBoundingClientRect();
    const tray = zoneOnScreen(o.scope) ? null : trayPlacement(list, window.innerWidth);
    setDrag({ ...o.chipFor(L.id, L.ids), count: L.ids.length, touch: L.touch, tray });
    markTargets();
    L.marker = window.setInterval(markTargets, 300);
    L.raf = requestAnimationFrame(frame);
  }, [closeSwipe, frame, markTargets]);

  const endDrag = useCallback(
    (drop: boolean) => {
      const L = live.current;
      // Al soltar se mira de nuevo: el puntero pudo llegar a la carpeta después del último cuadro.
      if (drop) hitTest();
      const target = L.hoverOk ? L.hover : null;
      const { ids, id, row, moved, touch } = L;
      dropVisuals();
      if (moved || touch) swallowUntil.current = Date.now() + 400;
      if (!drop) return;
      if (target && moved) opts.current.onDrop(ids, target.dataset.chatDrop ?? '', target.dataset.chatDropName ?? '');
      else if (!moved && touch && row) opts.current.onHoldTap?.(id, row);
    },
    [dropVisuals, hitTest],
  );

  const endSwipe = useCallback(
    (cancel: boolean, at?: number) => {
      const L = live.current;
      const row = L.row;
      if (!row) return;
      swallowUntil.current = Date.now() + 400;
      const tr = L.track;
      if (!tr?.side) return;
      const { id } = L;
      const { side, width } = tr;
      const count = swipeCount(tr);
      const end = cancel ? 'close' : swipeEnd(tr, at);
      row.removeAttribute('data-swipe-commit');
      const sign = side === 'left' ? -1 : 1;
      if (end === 'open') {
        open.current = { id, row };
        settle(row, sign * openWidth(count, width), side);
        return;
      }
      const close = () => {
        clearRow(row);
        setSwipe((s) => (s?.id === id ? null : s));
      };
      if (end === 'close') {
        settle(row, 0, side, close);
        return;
      }
      const action = opts.current.actionsFor(id)?.[side][0];
      row.setAttribute('data-swipe-commit', '');
      buzz(8);
      settle(row, sign * width, side, () => {
        action?.onSelect();
        if (action?.leaves) {
          // La fila se va con la recarga de la lista; si al final se queda (falló), vuelve a su lugar.
          window.setTimeout(() => {
            if (row.isConnected && row.getAttribute('data-swipe')) settle(row, 0, side, close);
            else close();
          }, 1500);
        } else {
          row.removeAttribute('data-swipe-commit');
          settle(row, 0, side, close);
        }
      });
    },
    [],
  );

  /** Corta el gesto en curso sin ejecutar nada (el navegador se lo llevó, la ventana perdió el foco, se soltó afuera). */
  const abort = useCallback(() => {
    const L = live.current;
    if (L.phase === 'swipe') endSwipe(true);
    else if (L.phase === 'drag') endDrag(false);
    // Se apoyó sobre la fila abierta y el navegador se llevó el gesto (scroll): la fila se cierra.
    else if (L.phase === 'pending' && L.wasOpen && open.current?.row === L.row) closeSwipe();
    finish();
  }, [closeSwipe, endDrag, endSwipe, finish]);

  const onPointerDown = useCallback(
    (id: string, e: ReactPointerEvent<HTMLElement>) => {
      // Un toque nuevo: lo que quedó del gesto anterior ya no traga clics (salvo que este toque haya cerrado unas acciones abiertas).
      swallowUntil.current = closedByTap.current ? Date.now() + 600 : 0;
      closedByTap.current = false;
      // Un gesto que quedó colgado (se soltó fuera de la ventana) o un segundo dedo: se corta y se empieza de nuevo.
      if (live.current.phase !== 'idle') abort();
      const row = e.currentTarget;
      const wasOpen = open.current?.row === row ? open.current : null;
      const target = e.target as HTMLElement;
      if ((e.pointerType === 'mouse' && (e.button !== 0 || e.ctrlKey)) || target.closest('input, select, textarea, [data-no-gesture], .zs-swipe-actions')) {
        // Sobre la fila abierta, fuera de sus botones: la cierra y no hace nada más.
        if (wasOpen && !target.closest('.zs-swipe-actions')) {
          closeSwipe();
          swallowUntil.current = Date.now() + 600;
        }
        return;
      }
      const acts = opts.current.actionsFor(id);
      const L = idle();
      live.current = L;
      L.phase = 'pending';
      L.id = id;
      L.row = row;
      L.pointerId = e.pointerId;
      L.touch = e.pointerType === 'touch' || e.pointerType === 'pen';
      L.sx = L.x = e.clientX;
      L.sy = L.y = e.clientY;
      L.wasOpen = !!wasOpen;
      const openSide = wasOpen ? ((row.getAttribute('data-swipe') as SwipeSide | null) ?? null) : null;
      L.track = swipeStart({ x: e.clientX, y: e.clientY, t: e.timeStamp, width: row.offsetWidth, counts: { left: acts?.left.length ?? 0, right: acts?.right.length ?? 0 }, open: openSide });
      // Con la fila abierta, apoyar es para cerrarla o arrastrarla: no levanta la conversación.
      if (!wasOpen) {
        L.hold = window.setTimeout(() => {
          if (live.current === L && L.phase === 'pending') beginDrag();
        }, HOLD_MS);
      }

      /** La fila abierta se cierra (un toque, scroll, o un gesto que no es deslizar) y el clic de este toque no abre el chat. */
      const shut = () => {
        if (!L.wasOpen) return;
        L.wasOpen = false;
        if (open.current?.row === row) closeSwipe();
        swallowUntil.current = Date.now() + 600;
      };

      const move = (ev: PointerEvent) => {
        if (live.current !== L || ev.pointerId !== L.pointerId) return;
        // El botón se soltó fuera de la ventana: el mouse vuelve sin nada apretado.
        if (ev.pointerType === 'mouse' && ev.buttons === 0) return abort();
        const dx = ev.clientX - L.sx;
        const dy = ev.clientY - L.sy;
        L.x = ev.clientX;
        L.y = ev.clientY;
        const tr = L.track ? swipeMove(L.track, { x: ev.clientX, y: ev.clientY, t: ev.timeStamp }) : null;
        L.track = tr;
        if (L.phase === 'pending') {
          if (holdBroken(dx, dy)) window.clearTimeout(L.hold);
          if (!tr?.axis) return;
          L.list = (row.closest<HTMLElement>('[data-chat-list]') ?? row.parentElement ?? row).getBoundingClientRect();
          // Deslizar de costado es siempre deslizar (archivar, más…), aunque el mouse salga de la lista:
          // a una carpeta se lleva levantando la conversación hacia arriba o abajo, o manteniéndola apretada.
          if (tr.axis === 'x' && swipeCount(tr) === 0) {
            L.phase = 'dead';
            return;
          }
          if (tr.axis === 'x') {
            L.phase = 'swipe';
            if (L.wasOpen) {
              // La fila abierta pasa a ser de este gesto: sigue desde donde estaba, del mismo lado.
              open.current = null;
            } else {
              closeSwipe(true);
            }
            document.body.setAttribute('data-chat-gesture', 'swipe');
            settleSeq.set(row, (settleSeq.get(row) ?? 0) + 1);
            row.removeAttribute('data-swipe-settling');
            paint(row, tr.offset, tr.side!);
            setSwipe({ id, side: tr.side! });
          } else if (L.wasOpen) {
            // Con la fila abierta, cualquier otro gesto (scroll, arrastre vertical) solo la cierra.
            shut();
            if (L.touch) finish();
            else L.phase = 'dead';
          } else if (!L.touch) {
            // Con el mouse, arrastrar hacia arriba o abajo levanta la conversación sin esperar.
            L.sx = ev.clientX;
            L.sy = ev.clientY;
            beginDrag();
            L.moved = true;
          } else {
            // Con el dedo, vertical es scroll.
            finish();
          }
          return;
        }
        if (L.phase === 'swipe' && tr?.side) {
          paint(row, tr.offset, tr.side);
          const ready = Math.abs(tr.offset) >= commitAt(tr.width, swipeCount(tr));
          if (ready !== L.ready) {
            L.ready = ready;
            row.toggleAttribute('data-swipe-commit', ready);
            if (ready) buzz(8);
          }
          return;
        }
        if (L.phase === 'drag' && !L.moved && Math.hypot(dx, dy) >= SWIPE_SLOP) L.moved = true;
      };
      const up = (ev: PointerEvent) => {
        if (live.current !== L || ev.pointerId !== L.pointerId) return;
        L.x = ev.clientX;
        L.y = ev.clientY;
        if (L.phase === 'swipe') endSwipe(false, ev.timeStamp);
        else if (L.phase === 'drag') endDrag(true);
        else if (L.phase === 'dead') swallowUntil.current = Date.now() + 400;
        else if (L.phase === 'pending') shut();
        finish();
      };
      const cancel = (ev: PointerEvent) => {
        if (live.current === L && ev.pointerId === L.pointerId) abort();
      };
      const blur = () => {
        if (live.current === L) abort();
      };
      const key = (ev: KeyboardEvent) => {
        if (ev.key !== 'Escape' || live.current !== L || (L.phase !== 'swipe' && L.phase !== 'drag')) return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        if (L.phase === 'swipe') endSwipe(true);
        else endDrag(false);
        document.body.removeAttribute('data-chat-gesture');
        L.phase = 'dead';
      };
      // Con el dedo levantando un chat, el toque largo no abre además el menú del sistema.
      const menu = (ev: Event) => {
        if (L.phase !== 'drag') return;
        ev.preventDefault();
        ev.stopPropagation();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
      window.addEventListener('keydown', key, true);
      window.addEventListener('contextmenu', menu, true);
      window.addEventListener('blur', blur);
      L.detach = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
        window.removeEventListener('keydown', key, true);
        window.removeEventListener('contextmenu', menu, true);
        window.removeEventListener('blur', blur);
      };
    },
    [abort, beginDrag, closeSwipe, endDrag, endSwipe, finish],
  );

  // Acciones abiertas: tocar en otro lado, correr la lista o Esc las cierra (y ese toque no abre nada).
  // Sobre la misma fila decide su propio gesto (onPointerDown): un toque la cierra, arrastrarla la lleva.
  useEffect(() => {
    if (!swipe) return;
    const down = (e: PointerEvent) => {
      const o = open.current;
      if (!o) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('.zs-swipe-actions')) return;
      if (t && o.row.contains(t)) return;
      closedByTap.current = !!t?.closest('[data-chat-row]');
      closeSwipe();
    };
    const scroll = (e: Event) => {
      const o = open.current;
      const t = e.target;
      if (!o || live.current.phase === 'swipe') return;
      if (t === document || (t instanceof Node && t.contains(o.row))) closeSwipe();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !open.current) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      closeSwipe();
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('scroll', scroll, { capture: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('scroll', scroll, { capture: true });
    };
  }, [swipe, closeSwipe]);

  // Si la lista se desmonta en medio de un gesto, no queda nada colgado.
  useEffect(
    () => () => {
      if (live.current.phase === 'drag') dropVisuals();
      finish();
    },
    [dropVisuals, finish],
  );

  useLayoutEffect(() => {
    if (!drag) return;
    placeChip();
    markTargets();
  }, [drag, placeChip, markTargets]);

  // Con el dedo, una vez que el gesto es nuestro la página no corre. El aviso tiene que estar puesto
  // en la fila antes de que empiece el toque (y no ser pasivo), así que va por ref y no por onTouchMove.
  const wired = useRef(new WeakSet<HTMLElement>());
  const guard = useCallback((ev: TouchEvent) => {
    const p = live.current.phase;
    if ((p === 'swipe' || p === 'drag') && ev.cancelable) ev.preventDefault();
  }, []);

  const rowProps = useCallback(
    (id: string) => ({
      'data-chat-row': id,
      draggable: false as const,
      ref: (el: HTMLLIElement | null) => {
        if (!el || wired.current.has(el)) return;
        wired.current.add(el);
        el.addEventListener('touchmove', guard, { passive: false });
      },
      onPointerDown: (e: ReactPointerEvent<HTMLElement>) => onPointerDown(id, e),
      onClickCapture: (e: ReactMouseEvent<HTMLElement>) => {
        if (Date.now() >= swallowUntil.current || (e.target as HTMLElement).closest('.zs-swipe-actions')) return;
        swallowUntil.current = 0;
        e.preventDefault();
        e.stopPropagation();
      },
      // El arrastre lo lleva el puntero: sin el fantasma del navegador (los enlaces y las fotos lo traen de fábrica).
      onDragStart: (e: ReactDragEvent<HTMLElement>) => e.preventDefault(),
    }),
    [onPointerDown, guard],
  );

  const actions = (id: string): ReactNode => {
    if (swipe?.id !== id) return null;
    const list = options.actionsFor(id)?.[swipe.side] ?? [];
    if (!list.length) return null;
    return (
      <ActionStrip
        side={swipe.side}
        actions={list}
        onPick={(a) => {
          closeSwipe();
          a.onSelect();
        }}
      />
    );
  };

  const tray = drag?.tray ?? null;
  const layer =
    drag && typeof document !== 'undefined'
      ? createPortal(
          <>
            <div ref={chipRef} className="zs-drag-chip" data-scope={options.scope} data-testid="drag-chip" aria-hidden="true">
              {drag.count > 1 ? <span className="zs-drag-chip-count">{drag.count}</span> : drag.avatar ? <span className="zs-drag-chip-avatar">{drag.avatar}</span> : null}
              <span className="zs-drag-chip-label">{drag.label}</span>
              <span className="zs-drag-chip-dest">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14m-6-6 6 6-6 6" />
                </svg>
                <span ref={destRef} />
              </span>
            </div>
            {tray && (
              <div
                className="zs-drag-tray"
                data-scope={options.scope}
                data-mode={tray.mode}
                data-chat-drop-zone={options.scope}
                data-testid="drag-tray"
                style={tray.mode === 'side' ? ({ left: tray.left, top: tray.top } as CSSProperties) : undefined}
              >
                <p className="zs-drag-tray-title">{options.tray.title}</p>
                {options.tray.items.length === 0 ? (
                  <p className="zs-drag-tray-empty">{options.tray.empty}</p>
                ) : (
                  <ul className="zs-drag-tray-list">
                    {options.tray.items.map((it) => (
                      <li
                        key={it.id}
                        className="zs-drag-tray-item"
                        data-chat-drop={it.id}
                        data-chat-drop-scope={options.scope}
                        data-chat-drop-name={it.name}
                        style={{ ['--d' as string]: it.depth }}
                      >
                        <span className="zs-drag-tray-swatch" aria-hidden="true" />
                        <span className="zs-drag-tray-name">{it.name}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>,
          document.body,
        )
      : null;

  return { rowProps, actions, layer, closeSwipe };
}
