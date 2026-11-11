'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { isMenuKey, newWindowModifiers, nextIndex, placeMenu, placeSubmenu, type MenuBox } from '@/lib/context-menu';
import { desktopBridge } from '@/lib/desktop-bridge';

/**
 * Menú contextual en el puntero (clic derecho sobre un chat, como WhatsApp).
 *
 * - Se abre donde está el puntero, o al lado del elemento con foco si vino
 *   del teclado (tecla de menú o Shift+F10), sin salir de la ventana.
 * - Flechas para moverse, → o Enter abren un submenú, ← vuelve, Esc cierra
 *   (y devuelve el foco a donde estaba), Tab cierra.
 * - Un clic afuera, correr lo de atrás, cambiar el tamaño de la ventana o
 *   que la ventana pierda el foco lo cierran.
 */

export interface ContextMenuItem {
  key: string;
  label: string;
  onSelect?: () => void;
  danger?: boolean;
  /** Separa este ítem de los anteriores. */
  divider?: boolean;
  /** Abre un submenú (Silenciar ›). */
  submenu?: ContextMenuItem[];
}

export interface ContextMenuAnchor {
  x: number;
  y: number;
  /** Nombre del menú para lectores de pantalla ("Opciones de Ana"). */
  label: string;
  /** Adónde vuelve el foco al cerrar con Esc. */
  returnFocus?: HTMLElement | null;
}

const OFF: MenuBox = { left: -9999, top: -9999, maxHeight: 0 };

function List({
  items,
  label,
  box,
  listRef,
  onKey,
  onPick,
  sub,
  openSub,
  activeSub,
  level,
}: {
  items: ContextMenuItem[];
  label: string;
  box: MenuBox;
  listRef: (el: HTMLDivElement | null) => void;
  onKey: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
  onPick: (it: ContextMenuItem, el: HTMLButtonElement) => void;
  sub?: boolean;
  openSub?: (key: string | null, el?: HTMLButtonElement) => void;
  activeSub?: string | null;
  level: number;
}) {
  return (
    <div
      ref={listRef}
      className="zs-ctx-menu"
      role="menu"
      aria-label={label}
      data-level={level}
      data-testid={sub ? 'context-submenu' : 'context-menu'}
      tabIndex={-1}
      onKeyDown={onKey}
      onContextMenu={(e) => e.preventDefault()}
      style={{ left: box.left, top: box.top, maxHeight: box.maxHeight || undefined }}
    >
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          role="menuitem"
          data-key={it.key}
          tabIndex={-1}
          className={`zs-ctx-item${it.danger ? ' is-danger' : ''}${it.divider ? ' has-divider' : ''}`}
          aria-haspopup={it.submenu ? 'menu' : undefined}
          aria-expanded={it.submenu ? activeSub === it.key : undefined}
          onClick={(e) => onPick(it, e.currentTarget)}
          onPointerEnter={(e) => {
            if (e.pointerType === 'touch') return;
            e.currentTarget.focus({ preventScroll: true });
            openSub?.(it.submenu ? it.key : null, e.currentTarget);
          }}
        >
          <span className="zs-ctx-label">{it.label}</span>
          {it.submenu && (
            <svg className="zs-ctx-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m9 6 6 6-6 6" />
            </svg>
          )}
        </button>
      ))}
    </div>
  );
}

// Con qué se tocó por última vez: en Android el toque largo también manda `contextmenu`, y ese es de los gestos de la fila.
let lastPointer = 'mouse';
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => (lastPointer = e.pointerType || 'mouse'), { capture: true, passive: true });
}

/**
 * Menú contextual para las filas de una lista: clic derecho en el puntero, o
 * la tecla de menú / Shift+F10 con el foco adentro de la fila. Con el dedo no
 * hace nada (el toque largo ya tiene lo suyo).
 */
export function useRowContextMenu() {
  const [open, setOpen] = useState<{ id: string; anchor: ContextMenuAnchor } | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const handlers = useCallback(
    (id: string, label: string, enabled = true) => ({
      onContextMenu: (e: ReactMouseEvent<HTMLElement>) => {
        if (!enabled) return;
        const pt = (e.nativeEvent as PointerEvent).pointerType || lastPointer;
        e.preventDefault();
        if (pt === 'touch' || pt === 'pen') return;
        e.stopPropagation();
        const focus = (document.activeElement as HTMLElement | null) ?? null;
        const back = focus && e.currentTarget.contains(focus) ? focus : e.currentTarget.querySelector<HTMLElement>('a[href], button');
        setOpen({ id, anchor: { x: e.clientX, y: e.clientY, label, returnFocus: back } });
      },
      onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => {
        if (!enabled || !isMenuKey(e) || (e.target as HTMLElement).closest('input, textarea, select')) return;
        e.preventDefault();
        e.stopPropagation();
        const el = e.target as HTMLElement;
        const r = el.getBoundingClientRect();
        setOpen({ id, anchor: { x: r.left + Math.min(24, r.width / 2), y: r.top + r.height / 2, label, returnFocus: el } });
      },
    }),
    [],
  );
  return { open, close, handlers };
}

/**
 * Abre una ruta de la app en otra ventana: en la app de escritorio, con las
 * teclas que su barra de pestañas reconoce en un link (otra ventana); en el
 * navegador, en una pestaña nueva.
 */
export function openInNewWindow(path: string) {
  const bridge = desktopBridge();
  if (bridge) {
    const a = document.createElement('a');
    a.href = path;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.addEventListener('click', (e) => e.preventDefault());
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...newWindowModifiers(bridge.platform) }));
    a.remove();
    return;
  }
  window.open(path, '_blank', 'noopener');
}

export function ContextMenu({ anchor, items, onClose }: { anchor: ContextMenuAnchor | null; items: ContextMenuItem[]; onClose: () => void }) {
  const main = useRef<HTMLDivElement | null>(null);
  const subEl = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<MenuBox>(OFF);
  const [sub, setSub] = useState<{ key: string; item: HTMLButtonElement } | null>(null);
  const [subBox, setSubBox] = useState<MenuBox>(OFF);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const close = useCallback((restore: boolean) => {
    if (restore) anchor?.returnFocus?.focus({ preventScroll: true });
    closeRef.current();
  }, [anchor]);

  // Cada apertura empieza de cero: sin submenú y fuera de la pantalla hasta medirse.
  useLayoutEffect(() => {
    setSub(null);
    setBox(OFF);
  }, [anchor]);

  useLayoutEffect(() => {
    if (!anchor || !main.current || box !== OFF) return;
    const r = main.current.getBoundingClientRect();
    setBox(placeMenu({ x: anchor.x, y: anchor.y, w: r.width, h: main.current.scrollHeight, vw: window.innerWidth, vh: window.innerHeight }));
  }, [anchor, box]);

  useEffect(() => {
    if (!anchor || box === OFF) return;
    main.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [anchor, box]);

  useLayoutEffect(() => {
    if (!sub || !subEl.current || !main.current) {
      setSubBox(OFF);
      return;
    }
    const p = main.current.getBoundingClientRect();
    const it = sub.item.getBoundingClientRect();
    const r = subEl.current.getBoundingClientRect();
    setSubBox(placeSubmenu({ parent: { left: p.left, right: p.right }, item: { top: it.top - 4, bottom: it.bottom }, w: r.width, h: subEl.current.scrollHeight, vw: window.innerWidth, vh: window.innerHeight }));
  }, [sub]);

  useEffect(() => {
    if (!anchor) return;
    const inside = (t: EventTarget | null) => t instanceof Node && (main.current?.contains(t) || subEl.current?.contains(t));
    const down = (e: PointerEvent) => {
      if (!inside(e.target)) close(false);
    };
    const scroll = (e: Event) => {
      if (!inside(e.target)) close(false);
    };
    const away = () => close(false);
    // Un clic derecho afuera abre otro menú (el de esa fila) o el del navegador: este se cierra.
    const ctx = (e: MouseEvent) => {
      if (!inside(e.target)) close(false);
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('contextmenu', ctx, true);
    window.addEventListener('scroll', scroll, { capture: true, passive: true });
    window.addEventListener('resize', away);
    window.addEventListener('blur', away);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('contextmenu', ctx, true);
      window.removeEventListener('scroll', scroll, { capture: true });
      window.removeEventListener('resize', away);
      window.removeEventListener('blur', away);
    };
  }, [anchor, close]);

  const subItems = sub ? (items.find((x) => x.key === sub.key)?.submenu ?? []) : [];

  const openSub = (key: string | null, el?: HTMLButtonElement) => {
    if (!key || !el) {
      setSub(null);
      return;
    }
    setSub((s) => (s?.key === key ? s : { key, item: el }));
  };

  const pick = (it: ContextMenuItem, el: HTMLButtonElement) => {
    if (it.submenu) {
      openSub(it.key, el);
      // Desde el teclado o un clic, el foco pasa al primer ítem del submenú.
      window.requestAnimationFrame(() => subEl.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true }));
      return;
    }
    close(false);
    it.onSelect?.();
  };

  const keys = (list: () => HTMLDivElement | null, level: number) => (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const el = list();
    if (!el) return;
    const all = [...el.querySelectorAll<HTMLButtonElement>(':scope > [role="menuitem"]')];
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    // Con el menú abierto, las teclas son suyas: los atajos de una letra de la página no corren.
    e.stopPropagation();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      e.stopPropagation();
      all[nextIndex(i, e.key, all.map(() => false))]?.focus({ preventScroll: true });
    } else if (e.key === 'ArrowRight' && level === 0 && i >= 0 && all[i].getAttribute('aria-haspopup')) {
      e.preventDefault();
      e.stopPropagation();
      all[i].click();
    } else if ((e.key === 'ArrowLeft' || e.key === 'Escape') && level === 1) {
      e.preventDefault();
      e.stopPropagation();
      const parent = sub?.item;
      setSub(null);
      parent?.focus({ preventScroll: true });
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      close(true);
    }
  };

  if (!anchor || typeof document === 'undefined' || items.length === 0) return null;
  return createPortal(
    <>
      <List
        items={items}
        label={anchor.label}
        box={box}
        level={0}
        listRef={(el) => {
          main.current = el;
        }}
        onKey={keys(() => main.current, 0)}
        onPick={pick}
        openSub={openSub}
        activeSub={sub?.key ?? null}
      />
      {sub && subItems.length > 0 && (
        <List
          sub
          items={subItems}
          label={items.find((x) => x.key === sub.key)?.label ?? ''}
          box={subBox}
          level={1}
          listRef={(el) => {
            subEl.current = el;
          }}
          onKey={keys(() => subEl.current, 1)}
          onPick={pick}
        />
      )}
    </>,
    document.body,
  );
}
