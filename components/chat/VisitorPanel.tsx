'use client';

import { useState } from 'react';
import { Link } from '@/i18n/navigation';
import { useTranslations, useLocale } from 'next-intl';
import type { ChatConversationWithVisitor } from '@/lib/chat-data';
import { formatDateTime } from '@/lib/datetime';

interface VisitorPanelProps {
  conversation: ChatConversationWithVisitor;
}

/** Quién escribe y qué hay de esa persona en el CRM (tercera columna de la bandeja). */
export default function VisitorPanel({ conversation }: VisitorPanelProps) {
  const t = useTranslations('chat');
  const locale = useLocale();
  const [crmBusy, setCrmBusy] = useState(false);
  const [linkedId, setLinkedId] = useState<string | null>(null);
  const [crmNotice, setCrmNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  async function sendToCrm() {
    setCrmBusy(true);
    setCrmNotice(null);
    const res = await fetch(`/api/chat/conversations/${conversation.id}/crm`, { method: 'POST' }).catch(() => null);
    setCrmBusy(false);
    const data = res ? ((await res.json().catch(() => null)) as { contactId?: string } | null) : null;
    if (res?.ok && data?.contactId) {
      setLinkedId(data.contactId);
      setCrmNotice({ tone: 'ok', text: t('visitorPanel.loggedToCrm') });
    } else {
      setCrmNotice({ tone: 'error', text: t('visitorPanel.crmError') });
    }
  }

  const visitor = conversation.visitor;
  const contact = conversation.crm_contact;
  const contactId = contact?.id ?? linkedId;
  const contactName = contact
    ? `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim() || contact.email
    : visitor.name || visitor.email;

  return (
    <>
      <section className="chat-details-section" aria-labelledby="chat-details-visitor">
        <h3 id="chat-details-visitor" className="chat-details-label">
          {t('visitorPanel.title')}
        </h3>
        <dl className="chat-dl">
          <div>
            <dt>{t('visitorPanel.name')}</dt>
            <dd>
              <Link href={`/app/chat/people/${visitor.id}`}>{visitor.name || t('conversation.anonymous')}</Link>
            </dd>
          </div>
          {visitor.email && (
            <div>
              <dt>{t('visitorPanel.email')}</dt>
              <dd className="data">{visitor.email}</dd>
            </div>
          )}
          <div>
            <dt>{t('visitorPanel.firstSeen')}</dt>
            <dd className="data" suppressHydrationWarning>{formatDateTime(visitor.created_at, locale)}</dd>
          </div>
          <div>
            <dt>{t('visitorPanel.started')}</dt>
            <dd className="data" suppressHydrationWarning>{formatDateTime(conversation.created_at, locale)}</dd>
          </div>
          {conversation.subject && (
            <div>
              <dt>{t('conversation.subject')}</dt>
              <dd>{conversation.subject}</dd>
            </div>
          )}
          {conversation.csat_score != null && (
            <div>
              <dt>{t('visitorPanel.csat')}</dt>
              <dd className="data">{conversation.csat_score} / 5</dd>
            </div>
          )}
        </dl>
      </section>

      <section className="chat-details-section" aria-labelledby="chat-details-crm">
        <h3 id="chat-details-crm" className="chat-details-label">
          {t('visitorPanel.crmContact')}
        </h3>
        {contactId && (
          <Link href={`/app/crm/contacts/${contactId}`} className="chat-crm-link">
            {contactName}
          </Link>
        )}
        {visitor.email ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm btn-block"
            disabled={crmBusy}
            aria-busy={crmBusy || undefined}
            onClick={sendToCrm}
          >
            {contactId ? t('visitorPanel.logToCrm') : t('visitorPanel.createContact')}
          </button>
        ) : (
          !contact && <p className="ui-help">{t('visitorPanel.needsEmail')}</p>
        )}
        {crmNotice && (
          <p className={crmNotice.tone === 'ok' ? 'ui-help chat-ok' : 'ui-error'} role="status">
            {crmNotice.text}
          </p>
        )}
      </section>
    </>
  );
}
