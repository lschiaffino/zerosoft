'use client';

import { useMemo } from 'react';
import { Link } from '@/i18n/navigation';
import { formatDate } from '@/lib/utils';
import type { TrackIssueWithStatus } from '@/lib/track-data';
import type { IssueLabel } from '@/lib/track-schema';
import StatusBadge from './StatusBadge';

export type SortField = 'identifier' | 'title' | 'priority' | 'created' | null;

interface IssuesTableProps {
  issues: TrackIssueWithStatus[];
  locale: string;
  labels: {
    identifier: string;
    title: string;
    status: string;
    priority: string;
    assignee: string;
    cycle: string;
    created: string;
    dueDate: string;
    labels: string;
    noAssignee: string;
    empty: string;
  };
  sort?: SortField;
  sortDir?: 'asc' | 'desc';
  onSort?: (field: SortField) => void;
}

function parseLabels(raw: string): IssueLabel[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function PriorityDot({ priority }: { priority: string }) {
  const color =
    priority === 'urgent' ? '#000000' : priority === 'high' ? '#444444' : priority === 'medium' ? '#888888' : '#bbbbbb';
  return <span className="track-priority-dot" style={{ background: color }} aria-hidden />;
}

export default function IssuesTable({
  issues,
  locale,
  labels,
  sort = null,
  sortDir = 'asc',
  onSort,
}: IssuesTableProps) {
  const sorted = useMemo(() => {
    if (!sort) return issues;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...issues].sort((a, b) => {
      let cmp = 0;
      if (sort === 'identifier') cmp = a.identifier.localeCompare(b.identifier);
      else if (sort === 'title') cmp = a.title.localeCompare(b.title);
      else if (sort === 'priority') {
        const order = { urgent: 0, high: 1, medium: 2, low: 3 };
        cmp = (order[a.priority] ?? 99) - (order[b.priority] ?? 99);
      } else if (sort === 'created') {
        cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      }
      return cmp * dir;
    });
  }, [issues, sort, sortDir]);

  if (sorted.length === 0) {
    return (
      <div className="track-empty">
        <p className="track-empty-zeros mono" aria-hidden>
          0 0 0
        </p>
        <p>{labels.empty}</p>
      </div>
    );
  }

  const header = (field: SortField, label: string) => (
    <th
      className={field ? 'track-sortable' : undefined}
      onClick={field && onSort ? () => onSort(field) : undefined}
      aria-sort={sort === field ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      {label}
      {sort === field && <span className="track-sort-arrow">{sortDir === 'asc' ? ' ↑' : ' ↓'}</span>}
    </th>
  );

  return (
    <div className="track-table-wrap">
      <table className="track-table">
        <thead>
          <tr>
            {header('identifier', labels.identifier)}
            {header('title', labels.title)}
            <th>{labels.status}</th>
            {header('priority', labels.priority)}
            <th className="hide-sm">{labels.assignee}</th>
            <th className="hide-sm">{labels.cycle}</th>
            <th className="hide-sm">{labels.dueDate}</th>
            <th className="hide-sm">{labels.labels}</th>
            {header('created', labels.created)}
          </tr>
        </thead>
        <tbody>
          {sorted.map((issue) => {
            const issueLabels = parseLabels(issue.labels);
            return (
              <tr key={issue.id}>
                <td>
                  <Link href={`/${locale}/app/track/issues/${issue.id}`}>
                    <span className="track-identifier">{issue.identifier}</span>
                  </Link>
                </td>
                <td>
                  <Link href={`/${locale}/app/track/issues/${issue.id}`}>
                    <span className="track-issue-title">{issue.title || '—'}</span>
                  </Link>
                </td>
                <td>
                  <StatusBadge name={issue.status_name} color={issue.status_color} />
                </td>
                <td className="hide-sm">
                  <span className="track-priority">
                    <PriorityDot priority={issue.priority} />
                    {issue.priority}
                  </span>
                </td>
                <td className="hide-sm">
                  {issue.assignee_name ?? issue.assignee_email ?? labels.noAssignee}
                </td>
                <td className="hide-sm">{issue.cycle_name ?? '—'}</td>
                <td className="hide-sm">{issue.due_date ? formatDate(issue.due_date, locale) : '—'}</td>
                <td className="hide-sm">
                  {issueLabels.length > 0 ? (
                    <span className="track-label-chips">
                      {issueLabels.map((l) => (
                        <span
                          key={l.id}
                          className="track-label-chip"
                          style={{ background: l.color, color: '#fff' }}
                          title={l.name}
                        >
                          {l.name}
                        </span>
                      ))}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="hide-sm">{formatDate(issue.created_at, locale)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
