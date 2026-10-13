'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { IssueLabel } from '@/lib/track-schema';

export interface WorkspaceLabel {
  id: string;
  name: string;
  color: string;
}

let cache: Promise<WorkspaceLabel[]> | null = null;

/** Labels del workspace (cacheados por página; `refresh` fuerza recarga). */
export function fetchWorkspaceLabels(refresh = false): Promise<WorkspaceLabel[]> {
  if (!cache || refresh) {
    cache = fetch('/api/track/labels')
      .then((r) => (r.ok ? (r.json() as Promise<{ rows: WorkspaceLabel[] }>) : { rows: [] }))
      .then((d) => d.rows)
      .catch(() => []);
  }
  return cache;
}

export function useWorkspaceLabels(): [WorkspaceLabel[], () => void] {
  const [labels, setLabels] = useState<WorkspaceLabel[]>([]);
  useEffect(() => {
    let alive = true;
    void fetchWorkspaceLabels().then((l) => alive && setLabels(l));
    return () => {
      alive = false;
    };
  }, []);
  const refresh = () => void fetchWorkspaceLabels(true).then(setLabels);
  return [labels, refresh];
}

interface LabelPickerProps {
  value: IssueLabel[];
  /** Ids de labels del workspace o `{ name }` para crear uno nuevo. */
  onChange: (next: Array<{ id: string } | { name: string }>) => void;
}

/** Selector de labels del workspace con alta rápida por nombre. */
export default function LabelPicker({ value, onChange }: LabelPickerProps) {
  const t = useTranslations('track');
  const [all, refresh] = useWorkspaceLabels();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const selected = new Set(value.map((l) => l.id));
  const q = query.trim().toLowerCase();
  const options = useMemo(
    () => all.filter((l) => !value.some((v) => v.id === l.id) && (!q || l.name.toLowerCase().includes(q))).slice(0, 8),
    [all, value, q],
  );
  const exact = all.some((l) => l.name.toLowerCase() === q);

  const keep = value.map((l) => ({ id: l.id }));
  const add = (id: string) => {
    if (selected.has(id) || value.length >= 10) return;
    onChange([...keep, { id }]);
    setQuery('');
  };
  const create = () => {
    const name = query.trim();
    if (!name || value.length >= 10) return;
    onChange([...keep, { name }]);
    setQuery('');
    window.setTimeout(refresh, 400);
  };

  return (
    <div className="track-label-picker" data-testid="track-label-picker">
      {value.length > 0 && (
        <span className="track-label-chips">
          {value.map((l) => (
            <span key={l.id} className="track-label-tag">
              <span className="track-label-tag-dot" style={{ background: l.color }} aria-hidden />
              {l.name}
              <button
                type="button"
                className="track-label-remove"
                onClick={() => onChange(value.filter((v) => v.id !== l.id).map((v) => ({ id: v.id })))}
                aria-label={t('bulk.removeLabel', { name: l.name })}
              >
                ×
              </button>
            </span>
          ))}
        </span>
      )}
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (options[0] && (exact || !q || options[0].name.toLowerCase() === q)) add(options[0].id);
            else if (q) create();
          }
          if (e.key === 'Escape') setOpen(false);
        }}
        placeholder={t('labelsSettings.newPlaceholder')}
        aria-label={t('issues.labels')}
        maxLength={50}
      />
      {open && (options.length > 0 || (q && !exact)) && (
        <ul className="track-label-options" role="listbox">
          {options.map((l) => (
            <li key={l.id}>
              <button type="button" role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onClick={() => add(l.id)}>
                <span className="track-label-tag-dot" style={{ background: l.color }} aria-hidden />
                {l.name}
              </button>
            </li>
          ))}
          {q && !exact && (
            <li>
              <button type="button" role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onClick={create}>
                {t('bulk.addLabel', { name: query.trim() })}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
