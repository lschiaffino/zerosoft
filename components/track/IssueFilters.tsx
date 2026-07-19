'use client';

import { useState } from 'react';
import type { TrackCycleRow, TrackStatusRow } from '@/lib/db';
import type { IssueLabel } from '@/lib/track-schema';

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

function parseLabels(raw: string): IssueLabel[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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
  const [open, setOpen] = useState(false);
  const selected = options.filter((o) => values.includes(o.value));

  return (
    <div className="track-filter-dropdown">
      <button type="button" className="track-filter-toggle" onClick={() => setOpen((v) => !v)}>
        {label}
        {selected.length > 0 && <span className="track-filter-count">{selected.length}</span>}
      </button>
      {open && (
        <div className="track-filter-menu">
          {options.map((o) => (
            <label key={o.value} className="track-filter-option">
              <input
                type="checkbox"
                checked={values.includes(o.value)}
                onChange={(e) => {
                  if (e.target.checked) onChange([...values, o.value]);
                  else onChange(values.filter((v) => v !== o.value));
                }}
              />
              {o.color && <span className="track-filter-dot" style={{ background: o.color }} />}
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
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
  const allLabels = issueLabels;

  const activeCount =
    filters.statusId.length +
    filters.priority.length +
    filters.assigneeId.length +
    filters.cycleId.length +
    filters.labelIds.length +
    (filters.dueAfter ? 1 : 0) +
    (filters.dueBefore ? 1 : 0);

  const update = (patch: Partial<FilterState>) => onChange({ ...filters, ...patch });

  return (
    <div className="track-filter-bar">
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
        <MultiSelect
          label={labels.cycle}
          options={cycles.map((c) => ({ value: c.id, label: c.name }))}
          values={filters.cycleId}
          onChange={(v) => update({ cycleId: v })}
        />
        {allLabels.length > 0 && (
          <MultiSelect
            label={labels.labels}
            options={allLabels.map((l) => ({ value: l.id, label: l.name, color: l.color }))}
            values={filters.labelIds}
            onChange={(v) => update({ labelIds: v })}
          />
        )}
        <div className="track-filter-field">
          <label>{labels.dueDate}</label>
          <div className="track-filter-dates">
            <input
              type="date"
              value={filters.dueAfter}
              onChange={(e) => update({ dueAfter: e.target.value })}
              placeholder="From"
            />
            <span>→</span>
            <input
              type="date"
              value={filters.dueBefore}
              onChange={(e) => update({ dueBefore: e.target.value })}
              placeholder="To"
            />
          </div>
        </div>
      </div>
      <div className="track-filter-search">
        <input
          type="search"
          value={filters.q}
          onChange={(e) => update({ q: e.target.value })}
          placeholder={labels.search}
        />
        <button
          type="button"
          className="track-filter-clear"
          onClick={() =>
            onChange({
              statusId: [],
              priority: [],
              assigneeId: [],
              cycleId: [],
              labelIds: [],
              q: '',
              dueAfter: '',
              dueBefore: '',
            })
          }
          disabled={activeCount === 0 && !filters.q}
        >
          {labels.clear}
        </button>
        <button type="button" className="btn btn-solid track-filter-save" onClick={onSaveView}>
          {labels.saveView}
        </button>
      </div>
    </div>
  );
}
