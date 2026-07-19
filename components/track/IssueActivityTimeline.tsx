'use client';

import { useMemo, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { relDate } from '@/lib/utils';
import type { TrackIssueActivityWithAuthor, ProjectMember } from '@/lib/track-data';

interface ActivityLabels {
  title: string;
  created: string;
  statusChange: string;
  assigneeChange: string;
  priorityChange: string;
  cycleChange: string;
  dueDateChange: string;
  estimateChange: string;
  titleChange: string;
  descriptionChange: string;
  relationAdded: string;
  relationRemoved: string;
  attachmentAdded: string;
  subtaskAdded: string;
  closed: string;
  reopened: string;
  commented: string;
  from: string;
  to: string;
  unassigned: string;
  addComment: string;
  submitComment: string;
  empty: string;
}

interface IssueActivityTimelineProps {
  issueId: string;
  locale: string;
  activities: TrackIssueActivityWithAuthor[];
  members: ProjectMember[];
  labels: ActivityLabels;
  onChange?: () => void;
}

function parseMeta(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function Avatar({ name }: { name: string | null }) {
  const initial = name?.[0]?.toUpperCase() ?? '?';
  return <span className="track-avatar">{initial}</span>;
}

function userName(activity: TrackIssueActivityWithAuthor): string {
  return activity.user_name ?? activity.user_email ?? '?';
}

export default function IssueActivityTimeline({
  issueId,
  locale,
  activities,
  members,
  labels,
  onChange,
}: IssueActivityTimelineProps) {
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const sorted = useMemo(
    () => [...activities].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    [activities],
  );

  async function submitComment(e: React.FormEvent) {
    e.preventDefault();
    const body = comment.trim();
    if (!body) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/track/issues/${issueId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      if (res.ok) {
        setComment('');
        onChange?.();
      }
    } finally {
      setSubmitting(false);
    }
  }

  function renderActivity(activity: TrackIssueActivityWithAuthor) {
    const meta = parseMeta(activity.meta);
    const name = userName(activity);
    const time = relDate(activity.created_at, locale);

    switch (activity.type) {
      case 'created':
        return <span>{labels.created.replace('{user}', name)}</span>;
      case 'status_change': {
        const from = String(meta.from ?? '');
        const to = String(meta.to ?? '');
        return (
          <span>
            {labels.statusChange.replace('{user}', name).replace('{from}', from).replace('{to}', to)}
          </span>
        );
      }
      case 'assignee_change': {
        const fromId = String(meta.from ?? '');
        const toId = String(meta.to ?? '');
        const fromName = members.find((m) => m.id === fromId)?.name ?? members.find((m) => m.id === fromId)?.email ?? labels.unassigned;
        const toName = toId
          ? (members.find((m) => m.id === toId)?.name ?? members.find((m) => m.id === toId)?.email ?? toId)
          : labels.unassigned;
        return (
          <span>
            {labels.assigneeChange
              .replace('{user}', name)
              .replace('{from}', fromName)
              .replace('{to}', toName)}
          </span>
        );
      }
      case 'priority_change': {
        const from = String(meta.from ?? '');
        const to = String(meta.to ?? '');
        return (
          <span>
            {labels.priorityChange.replace('{user}', name).replace('{from}', from).replace('{to}', to)}
          </span>
        );
      }
      case 'cycle_change': {
        const from = String(meta.from ?? '');
        const to = String(meta.to ?? '');
        return (
          <span>
            {labels.cycleChange.replace('{user}', name).replace('{from}', from).replace('{to}', to)}
          </span>
        );
      }
      case 'due_date_change': {
        const from = String(meta.from ?? '');
        const to = String(meta.to ?? '');
        return (
          <span>
            {labels.dueDateChange.replace('{user}', name).replace('{from}', from).replace('{to}', to)}
          </span>
        );
      }
      case 'estimate_change': {
        const from = String(meta.from ?? '');
        const to = String(meta.to ?? '');
        return (
          <span>
            {labels.estimateChange.replace('{user}', name).replace('{from}', from).replace('{to}', to)}
          </span>
        );
      }
      case 'title_change': {
        const from = String(meta.from ?? '');
        const to = String(meta.to ?? '');
        return (
          <span>
            {labels.titleChange.replace('{user}', name).replace('{from}', from).replace('{to}', to)}
          </span>
        );
      }
      case 'description_change':
        return <span>{labels.descriptionChange.replace('{user}', name)}</span>;
      case 'relation_added': {
        const relatedIssueId = String(meta.relatedIssueId ?? '');
        return (
          <span>
            {labels.relationAdded.replace('{user}', name)}{' '}
            {relatedIssueId && (
              <Link href={`/${locale}/app/track/issues/${relatedIssueId}`} className="track-activity-link">
                {String(meta.identifier ?? relatedIssueId)}
              </Link>
            )}
          </span>
        );
      }
      case 'relation_removed':
        return <span>{labels.relationRemoved.replace('{user}', name)}</span>;
      case 'attachment_added': {
        const attachmentId = String(meta.attachmentId ?? '');
        const filename = String(meta.filename ?? '');
        return (
          <span>
            {labels.attachmentAdded.replace('{user}', name).replace('{filename}', filename)}{' '}
            {attachmentId && (
              <a
                href={`/api/track/issues/${issueId}/attachments?fileId=${attachmentId}`}
                target="_blank"
                rel="noreferrer"
                className="track-activity-link"
              >
                {filename}
              </a>
            )}
          </span>
        );
      }
      case 'subtask_added':
        return <span>{labels.subtaskAdded.replace('{user}', name)}</span>;
      case 'closed':
        return <span>{labels.closed.replace('{user}', name)}</span>;
      case 'reopened':
        return <span>{labels.reopened.replace('{user}', name)}</span>;
      case 'comment': {
        const body = String(meta.body ?? '');
        return (
          <span>
            {labels.commented.replace('{user}', name)}
            {body && <span className="track-activity-comment">“{body}”</span>}
          </span>
        );
      }
      default:
        return <span>{activity.type}</span>;
    }
  }

  return (
    <div className="track-activity">
      <form className="track-activity-composer" onSubmit={submitComment}>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={labels.addComment}
          rows={3}
        />
        <button type="submit" className="btn btn-solid" disabled={submitting || !comment.trim()}>
          {labels.submitComment}
        </button>
      </form>

      {sorted.length === 0 ? (
        <p className="muted">{labels.empty}</p>
      ) : (
        <div className="track-activity-list">
          {sorted.map((activity) => (
            <div key={activity.id} className="track-activity-item">
              <Avatar name={activity.user_name} />
              <div className="track-activity-body">
                <div className="track-activity-text">{renderActivity(activity)}</div>
                <time className="track-activity-time" dateTime={activity.created_at}>
                  {relDate(activity.created_at, locale)}
                </time>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
