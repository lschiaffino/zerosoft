'use client';

import { useState } from 'react';
import { Link } from '@/i18n/navigation';
import { useTranslations, useLocale } from 'next-intl';
import type { ChatVisitorWithStats } from '@/lib/chat-data';
import { formatDateTime, formatTimeAgo } from '@/lib/datetime';
import EmptyState from '@/components/ui/EmptyState';

interface VisitorDetailClientProps {
  initialVisitor: ChatVisitorWithStats;
}

/** Ficha de una persona: sus conversaciones a la izquierda, datos y notas a la derecha. */
export default function VisitorDetailClient({ initialVisitor }: VisitorDetailClientProps) {
  const t = useTranslations('chat');
  const locale = useLocale();
  const [visitor, setVisitor] = useState<ChatVisitorWithStats>(initialVisitor);
  const [notes, setNotes] = useState(visitor.notes ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  async function saveNotes() {
    setState('saving');
    try {
      const res = await fetch(`/api/chat/visitors/${visitor.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: notes.trim() || null }),
      });
      if (!res.ok) throw new Error('save_failed');
      const updated = (await res.json()) as ChatVisitorWithStats;
      setVisitor((prev) => ({ ...prev, notes: updated.notes }));
      setState('saved');
    } catch {
      setState('error');
    }
  }

  const status =
    state === 'saving'
      ? t('people.notesSaving')
      : state === 'saved'
        ? t('people.notesSaved')
        : state === 'error'
          ? t('people.notesError')
          : t('people.notesHint');

  return (
    <div className="chat-person">
      <section className="chat-pane" aria-labelledby="chat-person-convs">
        <div className="chat-pane-head">
          <h2 id="chat-person-convs" className="ui-section-title">
            {t('people.conversations', { count: visitor.conversations.length })}
          </h2>
        </div>
        {visitor.conversations.length === 0 ? (
          <EmptyState quiet title={t('people.noConversations')} product="chat" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('conversation.subject')}</th>
                  <th scope="col">{t('conversation.statusLabel')}</th>
                  <th scope="col" className="num">
                    {t('conversation.messages')}
                  </th>
                  <th scope="col">{t('people.updated')}</th>
                </tr>
              </thead>
              <tbody>
                {visitor.conversations.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/app/chat/inbox/${c.id}`} className="cell-link">
                        {c.subject || t('people.noSubject')}
                      </Link>
                    </td>
                    <td>{t(`conversation.${c.status}`)}</td>
                    <td className="num data">{c.message_count}</td>
                    <td>
                      <time suppressHydrationWarning dateTime={c.updated_at} title={formatDateTime(c.updated_at, locale)}>
                        {formatTimeAgo(c.updated_at, locale)}
                      </time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <aside className="chat-person-side">
        <section className="panel chat-person-panel" aria-labelledby="chat-person-data">
          <h2 id="chat-person-data" className="chat-details-label">
            {t('people.data')}
          </h2>
          <dl className="chat-dl">
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
              <dt>{t('conversation.messages')}</dt>
              <dd className="data">{visitor.total_messages}</dd>
            </div>
          </dl>
        </section>

        <section className="panel chat-person-panel" aria-labelledby="chat-person-notes">
          <label id="chat-person-notes" htmlFor="chat-person-notes-input" className="chat-details-label">
            {t('people.notes')}
          </label>
          <textarea
            id="chat-person-notes-input"
            className="textarea"
            rows={5}
            value={notes}
            aria-describedby="chat-person-notes-status"
            onChange={(e) => {
              setNotes(e.target.value);
              setState('idle');
            }}
            onBlur={() => {
              if ((notes.trim() || null) !== (visitor.notes ?? null)) void saveNotes();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void saveNotes();
              }
              if (e.key === 'Escape') {
                setNotes(visitor.notes ?? '');
                setState('idle');
              }
            }}
            placeholder={t('people.notesPlaceholder')}
          />
          <p
            id="chat-person-notes-status"
            className={state === 'error' ? 'ui-error' : state === 'saved' ? 'ui-help chat-ok' : 'ui-help'}
            role="status"
            aria-live="polite"
          >
            {status}
          </p>
        </section>
      </aside>
    </div>
  );
}
