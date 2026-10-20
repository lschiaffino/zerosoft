'use client';

import { useState } from 'react';
import { Link } from '@/i18n/navigation';
import { useTranslations, useLocale } from 'next-intl';
import type { ChatConversationWithVisitor } from '@/lib/chat-data';
import { formatDateTime, formatTimeAgo } from '@/lib/datetime';
import { readVisitorForm, readVisitorPage } from '@/lib/chat-visitor-context';

/** "acme.com/precios": la URL sin protocolo para leerla de un vistazo. */
function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = `${u.pathname}${u.search}`;
    return `${u.host}${path === '/' ? '' : path}`;
  } catch {
    return url;
  }
}

/** Nombre del idioma en el idioma del inbox ("es-AR" → "español (Argentina)"). */
function languageName(tag: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

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
  // El email sin verificar coincide con un contacto: el agente tiene que confirmarlo.
  const [needsConfirm, setNeedsConfirm] = useState(false);

  async function sendToCrm(confirm = false) {
    setCrmBusy(true);
    setCrmNotice(null);
    const res = await fetch(`/api/chat/conversations/${conversation.id}/crm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm }),
    }).catch(() => null);
    setCrmBusy(false);
    const data = res ? ((await res.json().catch(() => null)) as { contactId?: string; error?: string } | null) : null;
    if (res?.ok && data?.contactId) {
      setNeedsConfirm(false);
      setLinkedId(data.contactId);
      setCrmNotice({ tone: 'ok', text: t('visitorPanel.loggedToCrm') });
    } else if (res?.status === 409 && data?.error === 'unverified_email') {
      setNeedsConfirm(true);
    } else {
      setCrmNotice({ tone: 'error', text: t('visitorPanel.crmError') });
    }
  }

  const visitor = conversation.visitor;
  const page = readVisitorPage(visitor.metadata);
  const formAnswers = readVisitorForm(visitor.metadata);
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
              <dd className="ui-help">
                {visitor.email_verified === 1 ? t('visitorPanel.emailVerified') : t('visitorPanel.emailUnverified')}
              </dd>
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

      {(page || formAnswers.length > 0) && (
        <section className="chat-details-section" aria-labelledby="chat-details-context">
          <h3 id="chat-details-context" className="chat-details-label">
            {t('visitorPanel.context')}
          </h3>
          <dl className="chat-dl">
            {page?.url && (
              <div>
                <dt>{t('visitorPanel.page')}</dt>
                <dd>
                  <a href={page.url} target="_blank" rel="noopener noreferrer nofollow" title={page.url}>
                    {page.title || shortUrl(page.url)}
                  </a>
                </dd>
                {page.title && <dd className="ui-help data">{shortUrl(page.url)}</dd>}
                {page.seenAt && (
                  <dd className="ui-help" suppressHydrationWarning>
                    {t('visitorPanel.pageSeen', { when: formatTimeAgo(page.seenAt, locale) })}
                  </dd>
                )}
              </div>
            )}
            {page?.referrer && (
              <div>
                <dt>{t('visitorPanel.referrer')}</dt>
                <dd className="data">
                  <a href={page.referrer} target="_blank" rel="noopener noreferrer nofollow" title={page.referrer}>
                    {shortUrl(page.referrer)}
                  </a>
                </dd>
              </div>
            )}
            {page?.browser && (
              <div>
                <dt>{t('visitorPanel.browser')}</dt>
                <dd>{page.browser}</dd>
              </div>
            )}
            {page?.language && (
              <div>
                <dt>{t('visitorPanel.language')}</dt>
                <dd>{languageName(page.language, locale)}</dd>
              </div>
            )}
            {formAnswers.map((a) => (
              <div key={a.label}>
                <dt>{a.label}</dt>
                <dd>{a.value}</dd>
              </div>
            ))}
          </dl>
          {formAnswers.length > 0 && <p className="ui-help">{t('visitorPanel.formNote')}</p>}
        </section>
      )}

      <section className="chat-details-section" aria-labelledby="chat-details-crm">
        <h3 id="chat-details-crm" className="chat-details-label">
          {t('visitorPanel.crmContact')}
        </h3>
        {contactId && (
          <Link href={`/app/crm/contacts/${contactId}`} className="chat-crm-link">
            {contactName}
          </Link>
        )}
        {visitor.email && needsConfirm ? (
          <>
            <p className="ui-help">{t('visitorPanel.confirmUnverified')}</p>
            <button
              type="button"
              className="btn btn-secondary btn-sm btn-block"
              disabled={crmBusy}
              aria-busy={crmBusy || undefined}
              onClick={() => sendToCrm(true)}
            >
              {t('visitorPanel.confirmLog')}
            </button>
          </>
        ) : visitor.email ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm btn-block"
            disabled={crmBusy}
            aria-busy={crmBusy || undefined}
            onClick={() => sendToCrm()}
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
