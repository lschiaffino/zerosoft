'use client';

import { ISSUE_SORTS, type IssueGroupBy, type IssueSort } from '@/lib/track-views';

export interface DisplayLabels {
  groupBy: string;
  sortBy: string;
  groups: Record<IssueGroupBy, string>;
  sorts: Record<IssueSort, string>;
}

interface IssueDisplayOptionsProps {
  group: IssueGroupBy;
  /** Agrupados que ofrece la vista (el tablero no tiene "ninguno"; un proyecto no agrupa por proyecto). */
  groups: readonly IssueGroupBy[];
  sort: IssueSort;
  onGroupChange: (group: IssueGroupBy) => void;
  onSortChange: (sort: IssueSort) => void;
  labels: DisplayLabels;
}

/** Agrupar y ordenar la lista o el tablero: dos selects chicos en la barra de la vista. */
export default function IssueDisplayOptions({
  group,
  groups,
  sort,
  onGroupChange,
  onSortChange,
  labels,
}: IssueDisplayOptionsProps) {
  return (
    <div className="track-display-options">
      <label className="track-display-option">
        <span>{labels.groupBy}</span>
        <select
          className="select"
          value={group}
          onChange={(e) => onGroupChange(e.target.value as IssueGroupBy)}
          data-testid="track-group-by"
        >
          {groups.map((g) => (
            <option key={g} value={g}>
              {labels.groups[g]}
            </option>
          ))}
        </select>
      </label>
      <label className="track-display-option">
        <span>{labels.sortBy}</span>
        <select
          className="select"
          value={sort}
          onChange={(e) => onSortChange(e.target.value as IssueSort)}
          data-testid="track-sort-by"
        >
          {ISSUE_SORTS.map((s) => (
            <option key={s} value={s}>
              {labels.sorts[s]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
