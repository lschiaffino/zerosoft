'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/**
 * Botón con un panel que se despliega debajo (chips de la reunión, menú ⋯).
 * Clic afuera o Esc cierran y devuelven el foco al botón. Con `menu`, el
 * panel es un menú: flechas para moverse entre las opciones.
 */
export default function Pop({
  label,
  ariaLabel,
  panelLabel,
  buttonClass = 'vc-chip',
  panelClass = '',
  align = 'start',
  menu = false,
  open: openProp,
  onOpenChange,
  testId,
  children,
}: {
  label: ReactNode;
  ariaLabel?: string;
  /** Nombre del panel (si el botón ya tiene texto visible). */
  panelLabel?: string;
  buttonClass?: string;
  panelClass?: string;
  align?: 'start' | 'end';
  menu?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  testId?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (v: boolean) => {
    setOpenState(v);
    onOpenChange?.(v);
  };
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    // Primer elemento enfocable del panel (o la primera opción del menú).
    requestAnimationFrame(() => {
      const fields = 'input, button:not([disabled]), [href], select, textarea';
      const first = (menu ? panel.current?.querySelector<HTMLElement>('[role^="menuitem"]:not([disabled])') : null) ?? panel.current?.querySelector<HTMLElement>(fields);
      first?.focus();
    });
    return () => document.removeEventListener('mousedown', onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Si el foco se perdió (se quitó el botón que lo tenía), Esc igual cierra.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (wrap.current?.contains(document.activeElement)) return;
      setOpen(false);
      btn.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => {
    setOpen(false);
    btn.current?.focus();
  };

  return (
    <div
      className="vc-pop-wrap"
      ref={wrap}
      onKeyDown={(e) => {
        if (!open) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close();
          return;
        }
        if (menu && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End')) {
          const items = [...(panel.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])') ?? [])];
          if (!items.length) return;
          e.preventDefault();
          const i = items.indexOf(document.activeElement as HTMLElement);
          const next =
            e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
          items[next].focus();
        }
      }}
    >
      <button
        ref={btn}
        type="button"
        className={buttonClass}
        aria-label={ariaLabel}
        aria-haspopup={menu ? 'menu' : 'dialog'}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        data-testid={testId}
        onClick={() => setOpen(!open)}
      >
        {label}
      </button>
      {open && (
        <div
          ref={panel}
          id={id}
          className={`vc-pop is-${align} ${panelClass}`}
          role={menu ? 'menu' : 'dialog'}
          aria-label={panelLabel ?? ariaLabel}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}
