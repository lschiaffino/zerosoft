'use client';

import { Link } from '@/i18n/navigation';
import { formatDate } from '@/lib/utils';
import type { TrackIssueWithStatus } from '@/lib/track-data';
import StatusBadge from './StatusBadge';

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
    noAssignee: string;
    empty: string;
  };
}

export default function IssuesTable({ issues, locale, labels }: IssuesTableProps) {
  if (issues.length === 0) {
    return (
      <div className="track-empty">
        <p className="track-empty-zeros mono" aria-hidden>
          0 0 0
        </p>
        <p>{labels.empty}</p>
      </div>
    );
  }

  return (
    <div className="track-table-wrap">
      <table className="track-table">
        <thead>
          <tr>
            <th>{labels.identifier}</th>
            <th>{labels.title}</th>
            <th>{labels.status}</th>
            <th className="hide-sm">{labels.priority}</th>
            <th className="hide-sm">{labels.assignee}</th>
            <th className="hide-sm">{labels.cycle}</th>
            <th className="hide-sm">{labels.created}</th>
          </tr>
        </thead>
        <tbody>
          {issues.map((issue) => (
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
                <span className="track-priority">{issue.priority}</span>
              </td>
              <td className="hide-sm">
                {issue.assignee_name ?? issue.assignee_email ?? labels.noAssignee}
              </td>
              <td className="hide-sm">{issue.cycle_name ?? '—'}</td>
              <td className="hide-sm">{formatDate(issue.created_at, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
