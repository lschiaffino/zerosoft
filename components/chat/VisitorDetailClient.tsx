'use client';

import { useState } from 'react';
import { Link } from '@/i18n/navigation';
import { useTranslations, useLocale } from 'next-intl';
import type { ChatVisitorWithStats } from '@/lib/chat-data';
import { formatDateTime, formatTimeAgo } from '@/lib/datetime';

interface VisitorDetailClientProps {
  initialVisitor: ChatVisitorWithStats;
}

function initials(name: string | null, email: string | null): string {
  const base = (name || email || '?').replace(/[^\p{L}\p{N}\s@.]/gu, ' ').trim() || '?';
  const parts = base.split(/\s+/);
  if (parts.length > 1) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

export default function VisitorDetailClient({ initialVisitor }: VisitorDetailClientProps) {
  const t = useTranslations('chat');
  const locale = useLocale();
  const [visitor, setVisitor] = useState<ChatVisitorWithStats>(initialVisitor);
  const [notes, setNotes] = useState(visitor.notes ?? '');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveNotes() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/chat/visitors/${visitor.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: notes.trim() || null }),
      });
      if (!res.ok) throw new Error('save_failed');
      const updated = (await res.json()) as ChatVisitorWithStats;
      setVisitor((prev) => ({ ...prev, notes: updated.notes }));
      setSaved(true);
    } catch {
      setError(t('errors.generic'));
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setNotes(visitor.notes ?? '');
    setError(null);
  }

  return (
    <div className="chat-visitor-detail-layout">
      <section className="panel chat-visitor-detail-card">
        <div className="chat-visitor-card">
          <span className="chat-visitor-avatar">{initials(visitor.name, visitor.email)}</span>
          <div className="chat-visitor-card-meta">
            <p className="chat-visitor-name">{visitor.name || visitor.email || visitor.external_id}</p>
            {visitor.email && <p className="chat-visitor-email mono muted">{visitor.email}</p>}
          </div>
        </div>

        <dl className="chat-visitor-details">
          <div className="chat-visitor-detail">
            <dt className="mono muted">{t('visitorPanel.firstSeen')}</dt>
            <dd className="mono">{formatDateTime(visitor.created_at, locale)}</dd>
          </div>
          <div className="chat-visitor-detail">
            <dt className="mono muted">{t('overview.conversations')}</dt>
            <dd>{visitor.conversations.length}</dd>
          </div>
          <div className="chat-visitor-detail">
            <dt className="mono muted">{t('conversation.messages')}</dt>
            <dd>{visitor.total_messages}</dd>
          </div>
        </dl>
      </section>

      <section className="panel chat-visitor-notes">
        <div className="panel-head">
          <p className="section-label">{t('people.notes')}</p>
          {saving ? (
            <span className="mono muted chat-notes-status">{t('common.loading')}</span>
          ) : saved ? (
            <span className="mono muted chat-notes-status">{t('sla.saved')}</span>
          ) : null}
        </div>
        <textarea
          className="textarea chat-notes-inline"
          rows={4}
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setSaved(false);
          }}
          onBlur={() => {
            if ((notes.trim() || null) !== (visitor.notes ?? null)) saveNotes();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              saveNotes();
            }
            if (e.key === 'Escape') cancel();
          }}
          placeholder={t('people.notesPlaceholder')}
          aria-label={t('people.notes')}
        />
        {error && <p className="form-error">{error}</p>}
      </section>

      <section className="panel">
        <div className="panel-head">
          <p className="section-label">{t('people.conversations', { count: visitor.conversations.length })}</p>
        </div>
        {visitor.conversations.length === 0 ? (
          <p className="muted">{t('common.empty')}</p>
        ) : (
          <ul className="chat-visitor-conversations">
            {visitor.conversations.map((c) => (
              <li key={c.id}>
                <Link href={`/app/chat/inbox/${c.id}`} className="chat-visitor-conversation-row">
                  <div className="chat-visitor-conversation-main">
                    <span className="chat-visitor-conversation-subject">{c.subject || c.id.slice(0, 8)}</span>
                    <span className={`chat-status chat-status-${c.status}`}>
                      {t(`conversation.${c.status}`)}
                    </span>
                  </div>
                  <div className="chat-visitor-conversation-meta">
                    <span className="mono muted">{c.message_count} {t('conversation.messages')}</span>
                    <span className="mono muted" title={formatDateTime(c.updated_at, locale)}>
                      {formatTimeAgo(c.updated_at, locale)}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
