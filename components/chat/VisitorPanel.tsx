'use client';

import { useState } from 'react';
import { Link } from '@/i18n/navigation';
import { useTranslations, useLocale } from 'next-intl';
import type { ChatConversationWithVisitor } from '@/lib/chat-data';
import { formatDateTime } from '@/lib/datetime';

interface VisitorPanelProps {
  conversation: ChatConversationWithVisitor;
  onToggleResolved: () => void;
}

function initials(name: string | null, email: string | null): string {
  const base = name || email || '?';
  const parts = base.trim().split(/\s+/);
  if (parts.length > 1) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

export default function VisitorPanel({ conversation, onToggleResolved }: VisitorPanelProps) {
  const t = useTranslations('chat');
  const locale = useLocale();
  const [collapsed, setCollapsed] = useState(false);
  const [crmBusy, setCrmBusy] = useState(false);
  const [linkedId, setLinkedId] = useState<string | null>(null);
  const [crmNotice, setCrmNotice] = useState<string | null>(null);

  async function sendToCrm() {
    setCrmBusy(true);
    setCrmNotice(null);
    const res = await fetch(`/api/chat/conversations/${conversation.id}/crm`, { method: 'POST' }).catch(() => null);
    setCrmBusy(false);
    const data = res ? ((await res.json().catch(() => null)) as { contactId?: string } | null) : null;
    if (res?.ok && data?.contactId) {
      setLinkedId(data.contactId);
      setCrmNotice(t('visitorPanel.loggedToCrm'));
    } else {
      setCrmNotice(t('visitorPanel.crmError'));
    }
  }

  const visitor = conversation.visitor;
  const contact = conversation.crm_contact;
  const isResolved = conversation.status === 'resolved';

  return (
    <aside className={`chat-visitor-panel${collapsed ? ' collapsed' : ''}`}>
      <button
        type="button"
        className="chat-visitor-panel-toggle"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
      >
        <span>{t('visitorPanel.title')}</span>
        <span aria-hidden>{collapsed ? '‹' : '›'}</span>
      </button>

      <div className="chat-visitor-panel-body">
        <div className="chat-visitor-card">
          <span className="chat-visitor-avatar">{initials(visitor.name, visitor.email)}</span>
          <div className="chat-visitor-card-meta">
            <p className="chat-visitor-name">
              {visitor.name || visitor.email || visitor.external_id}
            </p>
            {visitor.email && visitor.name && (
              <p className="chat-visitor-email mono muted">{visitor.email}</p>
            )}
          </div>
        </div>

        <dl className="chat-visitor-details">
          {visitor.email && (
            <div className="chat-visitor-detail">
              <dt className="mono muted">{t('visitorPanel.email')}</dt>
              <dd>{visitor.email}</dd>
            </div>
          )}
          {visitor.name && (
            <div className="chat-visitor-detail">
              <dt className="mono muted">{t('visitorPanel.name')}</dt>
              <dd>{visitor.name}</dd>
            </div>
          )}
          <div className="chat-visitor-detail">
            <dt className="mono muted">{t('visitorPanel.firstSeen')}</dt>
            <dd className="mono">{formatDateTime(visitor.created_at, locale)}</dd>
          </div>
          <div className="chat-visitor-detail">
            <dt className="mono muted">{t('visitorPanel.widget')}</dt>
            <dd>{conversation.widget_name}</dd>
          </div>
        </dl>

        <div className="chat-visitor-crm">
          <p className="mono muted">{t('visitorPanel.crmContact')}</p>
          {contact || linkedId ? (
            <Link href={`/app/crm/contacts/${contact?.id ?? linkedId}`} className="chat-visitor-crm-link">
              {contact
                ? contact.first_name || contact.last_name
                  ? `${contact.first_name} ${contact.last_name}`.trim()
                  : contact.email
                : visitor.name || visitor.email}
            </Link>
          ) : null}
          {visitor.email ? (
            <button type="button" className="btn btn-ghost btn-small" disabled={crmBusy} onClick={sendToCrm}>
              {contact || linkedId ? t('visitorPanel.logToCrm') : t('visitorPanel.createContact')}
            </button>
          ) : (
            !contact && <p className="muted chat-visitor-crm-hint">{t('visitorPanel.needsEmail')}</p>
          )}
          {crmNotice && <p className="mono muted chat-visitor-crm-hint">{crmNotice}</p>}
        </div>

        <div className="chat-visitor-props">
          <p className="chat-visitor-props-title mono muted">{t('conversation.subject')}</p>
          <p className="chat-visitor-subject">{conversation.subject || '—'}</p>

          <div className="chat-visitor-prop-row">
            <span className="mono muted">{t('conversation.assignedTo')}</span>
            <span>
              {conversation.assigned_name || conversation.assigned_email || t('conversation.unassigned')}
            </span>
          </div>
          <div className="chat-visitor-prop-row">
            <span className="mono muted">{t('conversation.priority')}</span>
            <span>{t(`priorities.${conversation.priority}`)}</span>
          </div>
          <div className="chat-visitor-prop-row">
            <span className="mono muted">{t(`conversation.${conversation.status}`)}</span>
            <span className={`chat-status chat-status-${conversation.status}`}>
              {t(`conversation.${conversation.status}`)}
            </span>
          </div>
          {conversation.status === 'snoozed' && conversation.snoozed_until && (
            <div className="chat-visitor-prop-row">
              <span className="mono muted">{t('conversation.snoozeUntil')}</span>
              <span className="mono">{formatDateTime(conversation.snoozed_until, locale)}</span>
            </div>
          )}
          {conversation.csat_score != null && (
            <div className="chat-visitor-prop-row">
              <span className="mono muted">{t('visitorPanel.csat')}</span>
              <span className="mono">{'★'.repeat(conversation.csat_score)}</span>
            </div>
          )}
          <div className="chat-visitor-prop-row">
            <span className="mono muted">{t('visitorPanel.firstSeen')}</span>
            <span className="mono">{formatDateTime(conversation.created_at, locale)}</span>
          </div>
        </div>

        <button
          type="button"
          className={`btn btn-small${isResolved ? '' : ' btn-ghost'}`}
          onClick={onToggleResolved}
        >
          {isResolved ? t('conversation.reopen') : t('conversation.resolve')}
        </button>
      </div>
    </aside>
  );
}
