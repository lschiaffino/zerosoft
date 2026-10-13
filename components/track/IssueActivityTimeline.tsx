'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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

// Matches @email@domain.com and @Some Name (up to 3 capitalized words).
const MENTION_RE = /@[\w.-]+(?:@[\w.-]+\.\w{2,})?|@[A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*){0,2}/g;

function MentionText({ text }: { text: string }) {
  const parts = text.split(MENTION_RE);
  const matches = text.match(MENTION_RE) ?? [];
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {matches[i] && <span className="track-mention">{matches[i]}</span>}
        </span>
      ))}
    </>
  );
}

function getMentionState(text: string, cursor: number): { active: boolean; query: string; start: number } {
  const before = text.slice(0, cursor);
  const atIndex = before.lastIndexOf('@');
  if (atIndex === -1) return { active: false, query: '', start: 0 };
  const afterAt = before.slice(atIndex + 1);
  // Stop mention if there's a space after the @ before the cursor.
  if (/\s/.test(afterAt)) return { active: false, query: '', start: 0 };
  return { active: true, query: afterAt, start: atIndex };
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
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const sorted = useMemo(
    () => [...activities].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    [activities],
  );

  const mentionMembers = useMemo(() => {
    const q = mentionQuery.toLowerCase();
    return members.filter(
      (m) =>
        m.email.toLowerCase().includes(q) || m.name?.toLowerCase().includes(q),
    );
  }, [members, mentionQuery]);

  useEffect(() => {
    if (mentionIndex >= mentionMembers.length) setMentionIndex(0);
  }, [mentionMembers.length, mentionIndex]);

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
        setShowMentions(false);
        onChange?.();
      }
    } finally {
      setSubmitting(false);
    }
  }

  function insertMention(member: ProjectMember) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const cursor = textarea.selectionStart;
    const state = getMentionState(comment, cursor);
    const mentionText = `@${member.email}`;
    const newText = comment.slice(0, state.start) + mentionText + ' ' + comment.slice(cursor);
    setComment(newText);
    setShowMentions(false);
    setMentionQuery('');
    setMentionIndex(0);
    setTimeout(() => {
      textarea.focus();
      const pos = state.start + mentionText.length + 1;
      textarea.setSelectionRange(pos, pos);
    }, 0);
  }

  function handleInput(e: React.FormEvent<HTMLTextAreaElement>) {
    const target = e.currentTarget;
    setComment(target.value);
    const cursor = target.selectionStart;
    const state = getMentionState(target.value, cursor);
    if (state.active) {
      setShowMentions(true);
      setMentionQuery(state.query);
    } else {
      setShowMentions(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!showMentions || mentionMembers.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setMentionIndex((i) => (i + 1) % mentionMembers.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setMentionIndex((i) => (i - 1 + mentionMembers.length) % mentionMembers.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      insertMention(mentionMembers[mentionIndex]);
    } else if (e.key === 'Escape') {
      setShowMentions(false);
    }
  }

  function renderActivity(activity: TrackIssueActivityWithAuthor) {
    const meta = parseMeta(activity.meta);
    const name = userName(activity);

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
              <Link href={`/app/track/issues/${relatedIssueId}`} className="track-activity-link">
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
            {body && (
              <span className="track-activity-comment">
                “<MentionText text={body} />”
              </span>
            )}
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
        <div className="track-activity-composer-input">
          <textarea
            ref={textareaRef}
            value={comment}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={labels.addComment}
            rows={3}
          />
          {showMentions && mentionMembers.length > 0 && (
            <div className="track-mention-dropdown">
              {mentionMembers.map((m, i) => (
                <button
                  key={m.id}
                  type="button"
                  className={`track-mention-option${i === mentionIndex ? ' active' : ''}`}
                  onClick={() => insertMention(m)}
                >
                  <span>{m.name ?? m.email}</span>
                  <span>{m.email}</span>
                </button>
              ))}
            </div>
          )}
        </div>
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
