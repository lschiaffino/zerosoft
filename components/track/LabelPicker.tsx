'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { safeHexColor } from '@/lib/track-color';
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
  const [active, setActive] = useState(-1);
  const listId = useId();

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

  // Combobox WAI-ARIA: el foco queda en el input y la opción activa se
  // anuncia con aria-activedescendant (flechas para moverse, Enter elige).
  const canCreate = Boolean(q) && !exact;
  const itemCount = options.length + (canCreate ? 1 : 0);
  const expanded = open && itemCount > 0;
  const optionId = (i: number) => `${listId}-opt-${i}`;
  const choose = (i: number) => {
    if (i < options.length) add(options[i].id);
    else if (canCreate) create();
    setActive(-1);
  };

  return (
    <div className="track-label-picker" data-testid="track-label-picker">
      {value.length > 0 && (
        <span className="track-label-chips">
          {value.map((l) => (
            <span key={l.id} className="track-label-tag">
              <span className="track-label-tag-dot" style={{ background: safeHexColor(l.color, '#666666') }} aria-hidden />
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
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!open) setOpen(true);
            if (itemCount === 0) return;
            const step = e.key === 'ArrowDown' ? 1 : -1;
            setActive((i) => (i < 0 ? (step > 0 ? 0 : itemCount - 1) : (i + step + itemCount) % itemCount));
            return;
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            if (expanded && active >= 0) choose(active);
            else if (options[0] && (exact || !q || options[0].name.toLowerCase() === q)) add(options[0].id);
            else if (q) create();
          }
          if (e.key === 'Escape') {
            setOpen(false);
            setActive(-1);
          }
        }}
        placeholder={t('labelsSettings.newPlaceholder')}
        aria-label={t('issues.labels')}
        maxLength={50}
      />
      {expanded && (
        <ul className="track-label-options" role="listbox" id={listId} aria-label={t('issues.labels')}>
          {options.map((l, i) => (
            <li key={l.id} role="presentation">
              <button
                type="button"
                id={optionId(i)}
                role="option"
                tabIndex={-1}
                aria-selected={i === active}
                className={i === active ? 'is-active' : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => add(l.id)}
              >
                <span className="track-label-tag-dot" style={{ background: safeHexColor(l.color, '#666666') }} aria-hidden />
                {l.name}
              </button>
            </li>
          ))}
          {canCreate && (
            <li role="presentation">
              <button
                type="button"
                id={optionId(options.length)}
                role="option"
                tabIndex={-1}
                aria-selected={active === options.length}
                className={active === options.length ? 'is-active' : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={create}
              >
                {t('bulk.addLabel', { name: query.trim() })}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
