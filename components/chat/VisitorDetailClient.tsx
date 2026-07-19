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
  const base = name || email || '?';
  const parts = base.trim().split(/\s+/);
  if (parts.length > 1) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

export default function VisitorDetailClient({ initialVisitor }: VisitorDetailClientProps) {
  const t = useTranslations('chat');
  const locale = useLocale();
  const [visitor, setVisitor] = useState<ChatVisitorWithStats>(initialVisitor);
  const [notes, setNotes] = useState(visitor.notes ?? '');
  const [editing, setEditing] = useState(false);
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
      setEditing(false);
    } catch {
      setError(t('errors.generic'));
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setNotes(visitor.notes ?? '');
    setEditing(false);
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
            <dt className="mono muted">{t('people.conversations', { count: visitor.conversations.length })}</dt>
            <dd>{visitor.conversations.length}</dd>
          </div>
          <div className="chat-visitor-detail">
            <dt className="mono muted">{t('visitorPanel.notes')}</dt>
            <dd>{visitor.total_messages}</dd>
          </div>
        </dl>
      </section>

      <section className="panel chat-visitor-notes">
        <div className="panel-head">
          <p className="section-label">{t('people.notes')}</p>
          {!editing && (
            <button type="button" className="btn btn-small" onClick={() => setEditing(true)}>
              {t('people.editNotes')}
            </button>
          )}
        </div>
        {editing ? (
          <div className="chat-notes-editor">
            <textarea
              className="textarea"
              rows={6}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('people.notes')}
            />
            {error && <p className="form-error">{error}</p>}
            <div className="form-actions">
              <button type="button" className="btn btn-small" onClick={cancel} disabled={saving}>
                {t('common.cancel')}
              </button>
              <button type="button" className="btn btn-solid btn-small" onClick={saveNotes} disabled={saving}>
                {saving ? t('common.loading') : t('common.save')}
              </button>
            </div>
          </div>
        ) : (
          <p className="chat-notes-body">{visitor.notes || <span className="muted">{t('common.empty')}</span>}</p>
        )}
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
