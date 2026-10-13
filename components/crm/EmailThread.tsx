'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { EmailThreadView } from '@/lib/crm-email';

function when(iso: string, locale: string): string {
  const d = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return url;
  }
}

function displayName(header: string): string {
  const m = /^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/.exec(header);
  return (m ? m[1] : header).trim();
}

/**
 * Un thread de emails en el timeline: colapsado muestra el último mensaje y
 * el resumen de tracking; expandido, todos los mensajes en orden.
 */
export default function EmailThread({
  thread,
  locale,
  onReply,
}: {
  thread: EmailThreadView;
  locale: string;
  onReply?: (thread: EmailThreadView) => void;
}) {
  const t = useTranslations('crm');
  const [open, setOpen] = useState(false);
  const last = thread.messages[thread.messages.length - 1];
  const count = thread.messages.length;
  const shown = open ? thread.messages : [last];

  return (
    <div className="em-thread">
      <div className="tl-head">
        <span className="tl-type">{t('enums.activityType.email')}</span>
        <span className="tl-subject">{thread.subject || '—'}</span>
        {count > 1 && <span className="em-count mono">{t('email.messages', { n: count })}</span>}
        <span className="tl-date">{when(thread.lastAt, locale)}</span>
      </div>
      <div className="em-messages">
        {shown.map((m) => (
          <div key={m.id} className={`em-msg em-${m.direction}`}>
            <div className="em-msg-head">
              <span className="em-from">{m.direction === 'out' ? t('email.you') : displayName(m.from)}</span>
              <span className="em-arrow muted" aria-hidden>
                →
              </span>
              <span className="em-to muted">{displayName(m.to)}</span>
              {!open && count > 1 ? null : <span className="em-date muted">{when(m.sentAt, locale)}</span>}
            </div>
            <p className={`em-body${open ? '' : ' clamp'}`}>{open ? m.body : m.snippet || m.body}</p>
            {m.direction === 'out' && m.tracked && (
              <p className="em-track mono">
                {m.openCount > 0 ? t('email.opened', { n: m.openCount }) : t('email.notOpened')}
                {m.clicks.map((c) => (
                  <span key={c.url}>
                    {' · '}
                    {t('email.clickedLink', { url: shortUrl(c.url) })}
                    {c.count > 1 ? ` ×${c.count}` : ''}
                  </span>
                ))}
              </p>
            )}
          </div>
        ))}
      </div>
      <div className="tl-meta">
        {count > 1 && (
          <button type="button" className="link-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? t('email.collapse') : t('email.expand')}
          </button>
        )}
        {count === 1 && last.body.length > (last.snippet || '').length + 20 && (
          <button type="button" className="link-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? t('email.collapse') : t('email.expand')}
          </button>
        )}
        {onReply && (
          <button type="button" className="link-btn" onClick={() => onReply(thread)}>
            {t('email.reply')}
          </button>
        )}
      </div>
    </div>
  );
}
