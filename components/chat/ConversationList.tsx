'use client';

import { Link } from '@/i18n/navigation';
import { useTranslations, useLocale } from 'next-intl';
import type { ChatConversationListRow } from '@/lib/chat-data';
import { formatTimeAgo, formatDateTime } from '@/lib/datetime';
import EmptyState from '@/components/ui/EmptyState';
import { initials } from './icons';
import SlaNote from './SlaNote';

interface ConversationListProps {
  conversations: ChatConversationListRow[];
  currentId?: string;
  emptyTitle?: string;
  emptyBody?: string;
}

function preview(c: ChatConversationListRow): string {
  // Con búsqueda: el fragmento del mensaje que coincide (si no, la última línea del hilo).
  return c.match_snippet || c.last_message_body || c.subject || '';
}

/**
 * Filas de conversación densas: placa con iniciales, nombre y hora, la última
 * línea del hilo y una sola fila de metadatos. Solo lo que pide atención
 * (prioridad, SLA, estado distinto de abierta) va en tinta; la única placa
 * es Urgente.
 */
export default function ConversationList({ conversations, currentId, emptyTitle, emptyBody }: ConversationListProps) {
  const t = useTranslations('chat');
  const locale = useLocale();

  if (conversations.length === 0) {
    return <EmptyState quiet title={emptyTitle ?? t('inbox.empty')} body={emptyBody} product="chat" />;
  }

  return (
    <ul className="chat-list" aria-label={t('inbox.listLabel')}>
      {conversations.map((c) => {
        const active = c.id === currentId;
        const assignee = c.assigned_name || c.assigned_email;
        const name = c.visitor_name || c.visitor_email || t('conversation.anonymous');
        const text = preview(c);
        const tags = c.tags ? c.tags.split(',').filter(Boolean) : [];
        return (
          <li key={c.id}>
            <Link
              href={`/app/chat/inbox/${c.id}`}
              className="chat-row"
              aria-current={active ? 'page' : undefined}
              data-status={c.status}
            >
              <span className="chat-plate" aria-hidden="true">
                {c.visitor_name || c.visitor_email ? initials(c.visitor_name, c.visitor_email) : '?'}
              </span>
              <span className="chat-row-main">
                <span className="chat-row-top">
                  <span className="chat-row-name">{name}</span>
                  <time suppressHydrationWarning className="chat-row-time" dateTime={c.updated_at} title={formatDateTime(c.updated_at, locale)}>
                    {formatTimeAgo(c.updated_at, locale)}
                  </time>
                </span>
                {c.subject && c.last_message_body && <span className="chat-row-subject">{c.subject}</span>}
                <span className="chat-row-preview">{text || t('conversation.noMessages')}</span>
                <span className="chat-row-meta">
                  {c.priority === 'urgent' && <span className="badge badge-ink">{t('priorities.urgent')}</span>}
                  {c.priority === 'high' && <span className="chat-row-priority">{t('priorities.high')}</span>}
                  <SlaNote c={c} />
                  {c.status !== 'open' && (
                    <span className="chat-row-status" suppressHydrationWarning>
                      {c.status === 'snoozed' && c.snoozed_until
                        ? t('inbox.snoozedUntil', { when: formatTimeAgo(c.snoozed_until, locale) })
                        : t(`conversation.${c.status}`)}
                    </span>
                  )}
                  <span className="chat-row-assignee">{assignee ?? t('conversation.unassigned')}</span>
                  {tags.length > 0 && <span className="chat-row-tags">{tags.map((tag) => `#${tag}`).join(' ')}</span>}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
