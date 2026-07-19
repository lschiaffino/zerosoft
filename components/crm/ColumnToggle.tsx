'use client';

import { useEffect, useRef, useState } from 'react';

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
