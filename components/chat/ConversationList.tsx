'use client';

import { Link } from '@/i18n/navigation';
import { useTranslations, useLocale } from 'next-intl';
import type { ChatConversationListRow } from '@/lib/chat-data';
import { formatTimeAgo } from '@/lib/datetime';

interface ConversationListProps {
  conversations: ChatConversationListRow[];
  currentId?: string;
  emptyTitle?: string;
}

function initials(name: string | null, email: string | null): string {
  const base = name || email || '?';
  const parts = base.trim().split(/\s+/);
  if (parts.length > 1) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

function preview(c: ChatConversationListRow): string {
  if (c.subject) return c.subject;
  if (c.last_message_body) return c.last_message_body;
  return c.id.slice(0, 8);
}

function slaStatus(c: ChatConversationListRow, t: (k: string, v?: Record<string, string | number>) => string) {
  if (c.resolved_at) return { label: t('sla.resolved'), className: 'chat-sla-resolved' };
  const deadline = new Date(c.created_at).getTime() + 60 * 60 * 1000;
  const now = Date.now();
  if (now > deadline) return { label: t('sla.breached'), className: 'chat-sla-breached' };
  const mins = Math.ceil((deadline - now) / 60_000);
  return { label: t('sla.dueIn', { minutes: mins }), className: 'chat-sla-due' };
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
                  <span className={`chat-status chat-status-${c.status}`}>
                    {t(`conversation.${c.status}`)}
                  </span>
                  <span className="chat-priority mono">{t(`priorities.${c.priority}`)}</span>
                  {(() => {
                    const sla = slaStatus(c, t);
                    return (
                      <span className={`chat-sla-badge ${sla.className}`}>
                        {sla.label}
                      </span>
                    );
                  })()}
                  <span className="chat-row-assignee mono muted">
                    {c.assigned_name || c.assigned_email
                      ? c.assigned_name || c.assigned_email
                      : t('conversation.unassigned')}
                  </span>
                </div>
              </div>
              {unread && !active && <span className="chat-unread-dot" aria-label="Unread" />}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
