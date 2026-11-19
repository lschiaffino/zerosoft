'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

export interface PickPerson {
  id: string;
  name: string;
  email: string;
}

const GAP = 4;
const EDGE = 8;

/**
 * Elegir una persona del workspace: un botón con la persona actual y, al abrir, un buscador con la lista
 * (nombre y email). La primera opción es "nadie". Cierra con Esc (devuelve el foco), al hacer clic afuera
 * y al elegir. Teclado: ↑/↓, Enter elige. Con `help`, la lista explica debajo qué implica la elección.
 */
export default function PersonPicker({
  value,
  people,
  onChange,
  label,
  noneLabel,
  searchLabel,
  emptyLabel,
  help,
  testId,
  busy,
}: {
  /** Id de la persona elegida; '' = nadie. */
  value: string;
  people: PickPerson[];
  onChange: (id: string) => void;
  /** Nombre accesible del control. */
  label: string;
  noneLabel: string;
  searchLabel: string;
  /** Texto cuando la búsqueda no encuentra a nadie. */
  emptyLabel: string;
  help?: string;
  testId?: string;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [box, setBox] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const current = people.find((p) => p.id === value);

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hits = q ? people.filter((p) => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)) : people;
    return [...(q ? [] : [{ id: '', name: noneLabel, email: '' }]), ...hits];
  }, [people, query, noneLabel]);

  const place = useCallback(() => {
    const b = btn.current?.getBoundingClientRect();
    if (!b) return;
    const width = Math.min(300, window.innerWidth - EDGE * 2);
    const below = window.innerHeight - b.bottom - GAP - EDGE;
    const above = b.top - GAP - EDGE;
    const down = below >= 260 || below >= above;
    const maxHeight = Math.max(160, Math.min(380, down ? below : above));
    const height = Math.min(panel.current?.offsetHeight ?? maxHeight, maxHeight);
    const left = Math.max(EDGE, Math.min(b.left, window.innerWidth - width - EDGE));
    setBox({ left, top: down ? b.bottom + GAP : Math.max(EDGE, b.top - GAP - height), width, maxHeight });
  }, []);

  const close = useCallback((focus = true) => {
    setOpen(false);
    setQuery('');
    if (focus) btn.current?.focus();
  }, []);

  const show = () => {
    setActive(Math.max(0, people.findIndex((p) => p.id === value) + 1));
    setOpen(true);
  };

  const pick = (pid: string) => {
    close();
    if (pid !== value) onChange(pid);
  };

  useLayoutEffect(() => {
    if (!open) return;
    place();
    input.current?.focus({ preventScroll: true });
  }, [open, place]);
  // La lista cambia de alto al filtrar: si abre hacia arriba, se vuelve a ubicar.
  useLayoutEffect(() => {
    if (open) place();
  }, [open, options.length, place]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !btn.current?.contains(t)) close(false);
    };
    const shut = () => close(false);
    // La página se mueve con la lista abierta (también el scroll que trajo el botón a la vista justo antes del
    // clic): la lista sigue al botón, y se cierra solo si el botón salió de la pantalla.
    const onScroll = (e: Event) => {
      if (panel.current?.contains(e.target as Node)) return;
      const b = btn.current?.getBoundingClientRect();
      if (!b || b.bottom < 0 || b.top > window.innerHeight) shut();
      else place();
    };
    document.addEventListener('pointerdown', away, true);
    window.addEventListener('resize', shut);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      window.removeEventListener('resize', shut);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, close, place]);

  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const n = options.length;
    if (e.key === 'Escape') {
      // Solo cierra la lista: el diálogo o la pantalla de atrás no se enteran.
      e.stopPropagation();
      e.preventDefault();
      return close();
    }
    if (e.key === 'Tab') return close(false);
    if (!n) return;
    if (e.key === 'ArrowDown') setActive((i) => (i + 1) % n);
    else if (e.key === 'ArrowUp') setActive((i) => (i - 1 + n) % n);
    else if (e.key === 'Enter') {
      const o = options[Math.min(active, n - 1)];
      if (o) pick(o.id);
    } else return;
    e.preventDefault();
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`zs-msel gr-person-pick${open ? ' is-open' : ''}${current ? '' : ' is-none'}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current ? current.name || current.email : noneLabel}`}
        aria-busy={busy || undefined}
        data-testid={testId}
        onClick={() => (open ? close() : show())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            show();
          }
        }}
      >
        <span className="zs-msel-value">{current ? current.name || current.email : noneLabel}</span>
        <svg className="zs-msel-chevron" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4.5 6.5 8 10l3.5-3.5" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            className="zs-msel-list gr-person-panel"
            data-testid={testId ? `${testId}-panel` : undefined}
            style={box ? { left: box.left, top: box.top, width: box.width, maxHeight: box.maxHeight } : { left: -9999, top: -9999 }}
          >
            <input
              ref={input}
              type="search"
              className="input gr-person-search"
              role="combobox"
              aria-expanded="true"
              aria-controls={id}
              aria-activedescendant={options.length ? `${id}-${Math.min(active, options.length - 1)}` : undefined}
              aria-label={searchLabel}
              placeholder={searchLabel}
              autoComplete="off"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKey}
            />
            <div id={id} role="listbox" aria-label={label} className="gr-person-list">
              {options.map((o, i) => {
                const selected = o.id === value;
                return (
                  <div
                    key={o.id || 'none'}
                    id={`${id}-${i}`}
                    data-i={i}
                    role="option"
                    aria-selected={selected}
                    className={`zs-msel-opt${i === active ? ' is-active' : ''}`}
                    onPointerMove={() => i !== active && setActive(i)}
                    onClick={() => pick(o.id)}
                  >
                    <span className="zs-msel-label">{o.name || o.email}</span>
                    {o.name && o.email && <span className="zs-msel-hint gr-person-email">{o.email}</span>}
                    <svg className="zs-msel-check" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ visibility: selected ? 'visible' : 'hidden' }}>
                      <path d="M3.5 8.5l3 3 6-7" />
                    </svg>
                  </div>
                );
              })}
              {options.length === 0 && <p className="ui-help gr-person-empty">{emptyLabel}</p>}
            </div>
            {help && <p className="ui-help gr-person-help">{help}</p>}
          </div>,
          document.body,
        )}
    </>
  );
}
