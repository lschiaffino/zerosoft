'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { TrackCycleRow, TrackStatusRow } from '@/lib/db';
import type { IssueLabel } from '@/lib/track-schema';
import { safeHexColor } from '@/lib/track-color';
import TrackIcon from './TrackIcon';

export interface FilterState {
  statusId: string[];
  priority: string[];
  assigneeId: string[];
  cycleId: string[];
  labelIds: string[];
  q: string;
  dueAfter: string;
  dueBefore: string;
}

export const EMPTY_FILTERS: FilterState = {
  statusId: [],
  priority: [],
  assigneeId: [],
  cycleId: [],
  labelIds: [],
  q: '',
  dueAfter: '',
  dueBefore: '',
};

interface IssueFiltersProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  onSaveView: () => void;
  statuses: TrackStatusRow[];
  priorities: Array<{ value: string; label: string }>;
  members: Array<{ id: string; name: string | null; email: string }>;
  cycles: TrackCycleRow[];
  issueLabels: IssueLabel[];
  labels: FilterLabels;
}

export interface FilterLabels {
  status: string;
  priority: string;
  assignee: string;
  cycle: string;
  labels: string;
  dueDate: string;
  search: string;
  clear: string;
  saveView: string;
}

/** Cantidad de filtros activos (sin contar la búsqueda). */
export function activeFilterCount(filters: FilterState): number {
  return (
    filters.statusId.length +
    filters.priority.length +
    filters.assigneeId.length +
    filters.cycleId.length +
    filters.labelIds.length +
    (filters.dueAfter ? 1 : 0) +
    (filters.dueBefore ? 1 : 0)
  );
}

/**
 * Botón de filtro con su menú. Se cierra con Esc (el foco vuelve al botón) o
 * con un clic afuera.
 */
function FilterMenu({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div
      className="track-filter"
      ref={wrap}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          button.current?.focus();
        }
      }}
    >
      <button
        ref={button}
        type="button"
        className={`btn btn-ghost btn-sm track-filter-toggle${count > 0 ? ' is-active' : ''}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        {count > 0 && <span className="track-filter-count">{count}</span>}
        <TrackIcon name="chevronDown" size={12} />
      </button>
      {open && (
        <div className="track-filter-menu" id={id} role="group" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  );
}

function MultiSelect({
  label,
  options,
  values,
  onChange,
}: {
  label: string;
  options: Array<{ value: string; label: string; color?: string }>;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <FilterMenu label={label} count={values.length}>
      {options.map((o) => (
        <label key={o.value} className="ui-check track-filter-option">
          <input
            type="checkbox"
            checked={values.includes(o.value)}
            onChange={(e) => {
              if (e.target.checked) onChange([...values, o.value]);
              else onChange(values.filter((v) => v !== o.value));
            }}
          />
          {o.color && <span className="track-filter-swatch" style={{ background: safeHexColor(o.color, '#767676') }} aria-hidden />}
          <span>{o.label}</span>
        </label>
      ))}
    </FilterMenu>
  );
}

function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node || typeof node.closest !== 'function') return false;
  return node.isContentEditable || Boolean(node.closest('input, textarea, select, [contenteditable="true"], dialog, [role="dialog"]'));
}

export default function IssueFilters({
  filters,
  onChange,
  onSaveView,
  statuses,
  priorities,
  members,
  cycles,
  issueLabels,
  labels,
}: IssueFiltersProps) {
  const t = useTranslations('track');
  const search = useRef<HTMLInputElement>(null);
  const activeCount = activeFilterCount(filters);
  const update = (patch: Partial<FilterState>) => onChange({ ...filters, ...patch });

  // "/" enfoca la búsqueda (como en Linear y GitHub).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      e.preventDefault();
      search.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="track-filters" role="search">
      <div className="track-filter-group">
        <MultiSelect
          label={labels.status}
          options={statuses.map((s) => ({ value: s.id, label: s.name, color: s.color }))}
          values={filters.statusId}
          onChange={(v) => update({ statusId: v })}
        />
        <MultiSelect
          label={labels.priority}
          options={priorities}
          values={filters.priority}
          onChange={(v) => update({ priority: v })}
        />
        <MultiSelect
          label={labels.assignee}
          options={members.map((m) => ({ value: m.id, label: m.name ?? m.email }))}
          values={filters.assigneeId}
          onChange={(v) => update({ assigneeId: v })}
        />
        {cycles.length > 0 && (
          <MultiSelect
            label={labels.cycle}
            options={cycles.map((c) => ({ value: c.id, label: c.name }))}
            values={filters.cycleId}
            onChange={(v) => update({ cycleId: v })}
          />
        )}
        {issueLabels.length > 0 && (
          <MultiSelect
            label={labels.labels}
            options={issueLabels.map((l) => ({ value: l.id, label: l.name, color: l.color }))}
            values={filters.labelIds}
            onChange={(v) => update({ labelIds: v })}
          />
        )}
        <FilterMenu label={labels.dueDate} count={(filters.dueAfter ? 1 : 0) + (filters.dueBefore ? 1 : 0)}>
          <div className="track-filter-dates">
            <label className="ui-field">
              <span className="label">{t('filters.dueFrom')}</span>
              <input
                className="input"
                type="date"
                value={filters.dueAfter}
                onChange={(e) => update({ dueAfter: e.target.value })}
              />
            </label>
            <label className="ui-field">
              <span className="label">{t('filters.dueTo')}</span>
              <input
                className="input"
                type="date"
                value={filters.dueBefore}
                onChange={(e) => update({ dueBefore: e.target.value })}
              />
            </label>
          </div>
        </FilterMenu>
        {(activeCount > 0 || filters.q) && (
          <button type="button" className="btn btn-ghost btn-sm track-filter-clear" onClick={() => onChange(EMPTY_FILTERS)}>
            {labels.clear}
          </button>
        )}
      </div>
      <div className="track-filter-search">
        <span className="track-search">
          <TrackIcon name="search" size={14} />
          <input
            ref={search}
            className="input"
            type="search"
            value={filters.q}
            onChange={(e) => update({ q: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && filters.q) {
                e.preventDefault();
                update({ q: '' });
              }
            }}
            placeholder={labels.search}
            aria-label={labels.search}
            aria-keyshortcuts="/"
            data-testid="track-search"
          />
          <kbd className="kbd track-search-kbd" aria-hidden>
            /
          </kbd>
        </span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onSaveView} data-testid="track-save-view">
          {labels.saveView}
        </button>
      </div>
    </div>
  );
}
