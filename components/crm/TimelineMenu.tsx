'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

/**
 * Menú chico del timeline (filtrar actividad, personas, crear, acciones de una tarjeta): un botón y una
 * lista flotante con role="menu". Cierra con Esc (devuelve el foco al botón), con un clic o toque afuera y
 * al elegir una acción; los ítems de tilde (menuitemcheckbox) lo dejan abierto. Flechas, Home y End mueven
 * el foco. Nunca sale de la pantalla: si no entra a la derecha, se corre.
 */
export default function TimelineMenu({
  label,
  button,
  buttonClassName = 'btn btn-secondary btn-sm',
  align = 'start',
  testId,
  children,
}: {
  /** Nombre accesible del botón. */
  label: string;
  /** Contenido visible del botón (por defecto, el label). */
  button?: ReactNode;
  buttonClassName?: string;
  align?: 'start' | 'end';
  testId?: string;
  /** Los ítems; `close` cierra el menú (para acciones). */
  children: (close: () => void) => ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const close = useCallback((focus = true) => {
    setOpen(false);
    setShift(0);
    if (focus) btn.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Node && wrap.current?.contains(e.target)) return;
      close(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    menu.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, close]);

  // Que la lista entre en la pantalla (a 390 px un menú alineado a la izquierda puede pasarse).
  useLayoutEffect(() => {
    if (!open || !menu.current) return;
    const r = menu.current.getBoundingClientRect();
    const edge = 8;
    if (r.right > window.innerWidth - edge) setShift(Math.round(window.innerWidth - edge - r.right));
    else if (r.left < edge) setShift(Math.round(edge - r.left));
  }, [open]);

  function onMenuKey(e: KeyboardEvent<HTMLDivElement>) {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])') ?? [])];
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = (i + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else if (e.key === 'Tab') {
      close(false);
      return;
    }
    if (next < 0) return;
    e.preventDefault();
    items[next].focus();
  }

  return (
    <div className="atl-menu-wrap" ref={wrap}>
      <button
        ref={btn}
        type="button"
        className={buttonClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={button ? label : undefined}
        title={button ? label : undefined}
        data-testid={testId}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {button ?? label}
      </button>
      {open && (
        <div
          ref={menu}
          id={id}
          role="menu"
          aria-label={label}
          className={`atl-menu atl-menu-${align}`}
          style={shift ? { transform: `translateX(${shift}px)` } : undefined}
          onKeyDown={onMenuKey}
          data-testid={testId ? `${testId}-menu` : undefined}
        >
          {children(() => close())}
        </div>
      )}
    </div>
  );
}
