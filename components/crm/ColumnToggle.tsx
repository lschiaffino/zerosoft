'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface ColumnDef {
  id: string;
  label: string;
  defaultVisible?: boolean;
}

export function useColumnVisibility(
  columns: ColumnDef[],
  storageKey: string,
): [Set<string>, (id: string) => void] {
  const defaultVisible = new Set(columns.filter((c) => c.defaultVisible !== false).map((c) => c.id));
  const [visible, setVisible] = useState<Set<string>>(defaultVisible);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as string[];
        const saved = new Set(parsed.filter((id) => columns.some((c) => c.id === id)));
        if (saved.size > 0) setVisible(saved);
      }
    } catch {
      /* ignore */
    }
  }, [columns, storageKey]);

  useEffect(() => {
    if (!initialized.current) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify([...visible]));
    } catch {
      /* ignore */
    }
  }, [visible, storageKey]);

  function toggle(id: string) {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return [visible, toggle];
}

interface ColumnToggleProps {
  columns: ColumnDef[];
  visible: Set<string>;
  onToggle: (id: string) => void;
  label: string;
}

export default function ColumnToggle({ columns, visible, onToggle, label }: ColumnToggleProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  return (
    <div className="column-toggle" ref={ref}>
      <button
        type="button"
        className="column-toggle-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
          <line x1="6" y1="2.5" x2="6" y2="13.5" />
          <line x1="10.5" y1="2.5" x2="10.5" y2="13.5" />
        </svg>
        {label}
      </button>
      {open && (
        <div className="column-toggle-menu">
          {columns.map((col) => (
            <label key={col.id} className="column-toggle-row">
              <input
                type="checkbox"
                checked={visible.has(col.id)}
                onChange={() => onToggle(col.id)}
              />
              <span>{col.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/** Id del lugar en la barra de filtros donde va "Columnas" (al lado del orden). */
export const COLUMNS_SLOT_ID = 'crm-columns-slot';

/** Lugar para "Columnas" dentro de la barra de filtros. */
export function ColumnsSlot() {
  return <div id={COLUMNS_SLOT_ID} className="filter-columns" />;
}

/**
 * "Columnas" en la fila de filtros: se monta en ColumnsSlot si la página lo
 * tiene; si no, queda en su propia barra arriba de la tabla.
 */
export function ColumnToggleInBar(props: ColumnToggleProps) {
  const [slot, setSlot] = useState<HTMLElement | null | undefined>(undefined);
  useEffect(() => {
    setSlot(document.getElementById(COLUMNS_SLOT_ID));
  }, []);
  if (slot === undefined) return null;
  if (slot) return createPortal(<ColumnToggle {...props} />, slot);
  return (
    <div className="table-toolbar">
      <ColumnToggle {...props} />
    </div>
  );
}
