'use client';

import { useEffect, useRef } from 'react';
import NotesIcon from './NotesIcon';

/**
 * Menú "…" de una fila o tarjeta (libretas de Notes, pizarras de Board):
 * flechas, Home/End, Esc devuelve el foco al botón, clic afuera cierra.
 */
export default function RowMenu({
  open,
  label,
  onToggle,
  items,
  className = '',
}: {
  open: boolean;
  label: string;
  onToggle: (open: boolean) => void;
  items: Array<{ label: string; onSelect: () => void; danger?: boolean; className?: string }>;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // El padre pasa una función nueva en cada render: se lee por ref para no re-enfocar.
  const toggleRef = useRef(onToggle);
  toggleRef.current = onToggle;

  useEffect(() => {
    if (!open) return;
    wrapRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const close = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) toggleRef.current(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  function onKey(e: React.KeyboardEvent) {
    const els = Array.from(wrapRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | null = null;
    if (e.key === 'ArrowDown') next = (i + 1) % els.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + els.length) % els.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = els.length - 1;
    else if (e.key === 'Escape' || e.key === 'Tab') {
      if (e.key === 'Escape') {
        e.preventDefault();
        buttonRef.current?.focus();
      }
      onToggle(false);
      return;
    }
    if (next != null) {
      e.preventDefault();
      els[next]?.focus();
    }
  }

  return (
    <div className={`row-menu-wrap ${className}`.trim()} ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-ghost btn-sm btn-icon"
        onClick={() => onToggle(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        title={label}
      >
        <NotesIcon name="more" size={16} />
      </button>
      {open && (
        <div className="row-menu" role="menu" aria-label={label} onKeyDown={onKey}>
          {items.map((it) => (
            <button key={it.label} type="button" role="menuitem" className={[it.danger ? 'is-danger' : '', it.className ?? ''].filter(Boolean).join(' ') || undefined} onClick={it.onSelect}>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
