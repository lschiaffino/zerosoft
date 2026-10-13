'use client';

import { Link } from '@/i18n/navigation';
import { useTranslations, useLocale } from 'next-intl';
import type { ChatConversationListRow } from '@/lib/chat-data';
import { formatTimeAgo, formatDateTime } from '@/lib/datetime';

interface ConversationListProps {
  conversations: ChatConversationListRow[];
  currentId?: string;
  emptyTitle?: string;
}

function initials(name: string | null, email: string | null): string {
  const base = (name || email || '?').replace(/[^\p{L}\p{N}\s@.]/gu, ' ').trim() || '?';
  const parts = base.split(/\s+/);
  if (parts.length > 1) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

function preview(c: ChatConversationListRow): string {
  if (c.subject) return c.subject;
  if (c.last_message_body) return c.last_message_body;
  return c.id.slice(0, 8);
}

export default function ConversationList({
  conversations,
  currentId,
  emptyTitle,
}: ConversationListProps) {
  const t = useTranslations('chat');
  const locale = useLocale();

  if (conversations.length === 0) {
    return (
      <div className="chat-list-empty">
        <p className="empty-zeros mono" aria-hidden>0 0 0</p>
        <p className="muted">{emptyTitle ?? t('inbox.empty')}</p>
      </div>
    );
  }

  return (
    <ul className="chat-conversation-list">
      {conversations.map((c) => {
        const active = c.id === currentId;
        const unread = c.status === 'open';
        const assignee = c.assigned_name || c.assigned_email;
        return (
          <li key={c.id}>
            <Link
              href={`/app/chat/inbox/${c.id}`}
              className={`chat-conversation-row${active ? ' active' : ''}${unread ? ' unread' : ''}`}
              aria-current={active ? 'page' : undefined}
            >
              <span className="chat-row-avatar">{initials(c.visitor_name, c.visitor_email)}</span>
              <div className="chat-row-main">
                <div className="chat-row-top">
                  <span className="chat-row-name">
                    {c.visitor_name || c.visitor_email || c.visitor_external_id}
                  </span>
                  <span className="chat-row-time mono">{formatTimeAgo(c.updated_at, locale)}</span>
                </div>
                <div className="chat-row-preview">{preview(c)}</div>
                <div className="chat-row-meta">
                  {c.status !== 'open' && (
                    <span className={`chat-status chat-status-${c.status}`}>
                      {t(`conversation.${c.status}`)}
                    </span>
                  )}
                  {c.priority !== 'medium' && (
                    <span className={`chat-priority chat-priority-${c.priority} mono`}>
                      {t(`priorities.${c.priority}`)}
                    </span>
                  )}
                  {c.sla_breached === 1 ? (
                    <span className="chat-sla-badge chat-sla-breached">
                      {c.sla_breach_kind === 'resolution'
                        ? t('sla.breachedResolution')
                        : t('sla.breachedFirst')}
                    </span>
                  ) : c.resolved_at ? null : c.sla_due_in_minutes != null ? (
                    <span className="chat-sla-badge chat-sla-due">
                      {t('sla.dueIn', { minutes: c.sla_due_in_minutes })}
                    </span>
                  ) : null}
                  {c.status === 'snoozed' && c.snoozed_until && (
                    <span
                      className="chat-row-snoozed mono muted"
                      title={formatDateTime(c.snoozed_until, locale)}
                    >
                      {formatTimeAgo(c.snoozed_until, locale)}
                    </span>
                  )}
                  <span className="chat-row-assignee mono muted">
                    {assignee ? (
                      <>
                        <span className="chat-assignee-avatar" aria-hidden>
                          {initials(c.assigned_name, c.assigned_email)}
                        </span>
                        {assignee}
                      </>
                    ) : (
                      t('conversation.unassigned')
                    )}
                  </span>
                  {c.tags && (
                    <span className="chat-row-tags mono muted">
                      {c.tags
                        .split(',')
                        .map((tag) => `#${tag}`)
                        .join(' ')}
                    </span>
                  )}
                </div>
              </div>
              {unread && !active && <span className="chat-unread-dot" aria-label={t('inbox.unread')} />}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
