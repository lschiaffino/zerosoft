'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

export interface MenuSelectOption {
  value: string;
  label: string;
  /** Texto chico a la derecha (p. ej. el teléfono de la línea). */
  hint?: string;
  /** Sangría (carpetas anidadas). */
  depth?: number;
}

interface Box {
  left: number;
  top: number;
  minWidth: number;
  maxHeight: number;
}

const GAP = 4;
const EDGE = 8;

/**
 * Selector sutil (como los de Linear) en vez de un <select> nativo: un botón con
 * el valor y un chevron chico; la lista abre debajo (arriba solo si no entra),
 * con la opción elegida tildada. Teclado: ↑/↓, Home/End, letras para saltar,
 * Enter o Espacio elige, Esc cierra y devuelve el foco.
 */
export default function MenuSelect({
  value,
  options,
  onChange,
  label,
  className,
  testId,
}: {
  value: string;
  options: MenuSelectOption[];
  onChange: (v: string) => void;
  /** Nombre accesible del selector. */
  label: string;
  className?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const id = useId();
  const current = options.find((o) => o.value === value) ?? options[0];

  const place = useCallback(() => {
    const b = btn.current?.getBoundingClientRect();
    if (!b) return;
    const below = window.innerHeight - b.bottom - GAP - EDGE;
    const above = b.top - GAP - EDGE;
    const want = Math.min(320, (list.current?.scrollHeight ?? 320) + 2);
    const down = below >= Math.min(want, 160) || below >= above;
    const maxHeight = Math.max(120, Math.min(320, down ? below : above));
    const height = Math.min(want, maxHeight);
    const minWidth = Math.min(Math.max(b.width, 180), window.innerWidth - EDGE * 2);
    // El ancho real de la lista (puede ser más que el mínimo por los nombres): nunca sale de la pantalla.
    const width = Math.min(Math.max(list.current?.offsetWidth ?? 0, minWidth), window.innerWidth - EDGE * 2);
    const left = Math.min(b.left, window.innerWidth - width - EDGE);
    setBox({ left: Math.max(EDGE, left), top: down ? b.bottom + GAP : b.top - GAP - height, minWidth, maxHeight });
  }, []);

  const show = (at?: number) => {
    const i = options.findIndex((o) => o.value === value);
    setActive(at ?? Math.max(0, i));
    setOpen(true);
  };
  const close = (focus = true) => {
    setOpen(false);
    if (focus) btn.current?.focus();
  };
  const pick = (v: string) => {
    close();
    if (v !== value) onChange(v);
  };

  useLayoutEffect(() => {
    if (!open) return;
    place();
    list.current?.focus({ preventScroll: true });
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!list.current?.contains(t) && !btn.current?.contains(t)) close(false);
    };
    const shut = () => close(false);
    document.addEventListener('pointerdown', away, true);
    window.addEventListener('resize', shut);
    window.addEventListener('blur', shut);
    const onScroll = (e: Event) => {
      if (!list.current?.contains(e.target as Node)) shut();
    };
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      window.removeEventListener('resize', shut);
      window.removeEventListener('blur', shut);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const onButtonKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      show();
    }
  };

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = options.length;
    if (e.key === 'ArrowDown') setActive((i) => (i + 1) % n);
    else if (e.key === 'ArrowUp') setActive((i) => (i - 1 + n) % n);
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(n - 1);
    else if (e.key === 'Enter' || e.key === ' ') pick(options[active].value);
    else if (e.key === 'Escape' || e.key === 'Tab') {
      if (e.key === 'Tab') return close(false);
      close();
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + e.key.toLowerCase(), at: now };
      const hit = options.findIndex((o) => o.label.toLowerCase().startsWith(typed.current.text));
      if (hit >= 0) setActive(hit);
      else return;
    } else return;
    e.preventDefault();
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`zs-msel${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`${label}: ${current?.label ?? ''}`}
        data-testid={testId}
        onClick={() => (open ? close() : show())}
        onKeyDown={onButtonKey}
      >
        <span className="zs-msel-value">{current?.label}</span>
        <svg className="zs-msel-chevron" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4.5 6.5 8 10l3.5-3.5" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div
            ref={list}
            id={id}
            role="listbox"
            aria-label={label}
            aria-activedescendant={`${id}-${active}`}
            tabIndex={-1}
            className="zs-msel-list"
            style={box ? { left: box.left, top: box.top, minWidth: box.minWidth, maxHeight: box.maxHeight } : { left: -9999, top: -9999 }}
            onKeyDown={onListKey}
          >
            {options.map((o, i) => {
              const selected = o.value === value;
              return (
                <div
                  key={o.value}
                  id={`${id}-${i}`}
                  data-i={i}
                  role="option"
                  aria-selected={selected}
                  className={`zs-msel-opt${i === active ? ' is-active' : ''}`}
                  style={o.depth ? { paddingInlineStart: 10 + o.depth * 12 } : undefined}
                  onPointerMove={() => i !== active && setActive(i)}
                  onClick={() => pick(o.value)}
                >
                  <span className="zs-msel-label">{o.label}</span>
                  {o.hint && <span className="zs-msel-hint">{o.hint}</span>}
                  <svg className="zs-msel-check" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ visibility: selected ? 'visible' : 'hidden' }}>
                    <path d="M3.5 8.5l3 3 6-7" />
                  </svg>
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
