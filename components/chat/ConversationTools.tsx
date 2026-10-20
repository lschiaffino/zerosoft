'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { ChatConversationWithVisitor } from '@/lib/chat-data';
import type { MergeCandidate } from '@/lib/chat-merge';
import {
  isAttributeFilled,
  parseAttributeDefs,
  parseAttributeValues,
  type ChatAttributeDef,
  type ChatAttributeValue,
} from '@/lib/chat-attributes';
import { formatDateTime, formatTimeAgo } from '@/lib/datetime';
import { sendErrorKey } from '@/lib/chat-schema';

type Patch = Record<string, ChatAttributeValue | null>;

/**
 * Atributos de la conversación (los define el widget). Cada cambio se guarda
 * solo; los obligatorios sin completar bloquean resolver.
 */
export function ConversationAttributes({
  conversation,
  onSaved,
}: {
  conversation: ChatConversationWithVisitor;
  onSaved: (next: ChatConversationWithVisitor) => void;
}) {
  const t = useTranslations('chat');
  const defs = parseAttributeDefs(conversation.widget_attributes);
  const saved = parseAttributeValues(conversation.attributes);
  // Texto y número se editan en borrador y se guardan al salir del campo.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (defs.length === 0) return null;

  async function save(patch: Patch) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/chat/conversations/${conversation.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attributes: patch }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(t(sendErrorKey(data.error)));
        return;
      }
      onSaved((await res.json()) as ChatConversationWithVisitor);
      setDrafts((prev) => {
        const next = { ...prev };
        for (const k of Object.keys(patch)) delete next[k];
        return next;
      });
    } catch {
      setError(t('errors.generic'));
    } finally {
      setBusy(false);
    }
  }

  function commitDraft(def: ChatAttributeDef) {
    const draft = drafts[def.id];
    if (draft === undefined) return;
    const current = saved[def.id];
    if (draft.trim() === (current === undefined ? '' : String(current))) return;
    void save({ [def.id]: draft.trim() === '' ? null : def.type === 'number' ? Number(draft) : draft });
  }

  return (
    <section className="chat-details-section" aria-labelledby="chat-details-attrs" aria-busy={busy || undefined}>
      <h3 id="chat-details-attrs" className="chat-details-label">
        {t('attributes.title')}
      </h3>
      {defs.map((d) => {
        const inputId = `chat-attr-${d.id}`;
        const value = saved[d.id];
        const missing = d.required && !isAttributeFilled(d, value);
        const label = (
          <label className="label" htmlFor={inputId}>
            {d.name}
            {d.required && <span className="chat-attr-required"> {t('attributes.required')}</span>}
          </label>
        );
        return (
          <div key={d.id} className="ui-field" data-missing={missing || undefined}>
            {label}
            {d.type === 'select' ? (
              <select
                id={inputId}
                className="select"
                value={typeof value === 'string' ? value : ''}
                aria-invalid={missing || undefined}
                onChange={(e) => void save({ [d.id]: e.target.value || null })}
              >
                <option value="">{t('attributes.none')}</option>
                {d.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : d.type === 'boolean' ? (
              <select
                id={inputId}
                className="select"
                value={value === true ? 'yes' : value === false ? 'no' : ''}
                aria-invalid={missing || undefined}
                onChange={(e) => void save({ [d.id]: e.target.value === '' ? null : e.target.value === 'yes' })}
              >
                <option value="">{t('attributes.none')}</option>
                <option value="yes">{t('attributes.yes')}</option>
                <option value="no">{t('attributes.no')}</option>
              </select>
            ) : (
              <input
                id={inputId}
                className="input"
                type={d.type === 'number' ? 'number' : 'text'}
                inputMode={d.type === 'number' ? 'decimal' : undefined}
                maxLength={d.type === 'text' ? 500 : undefined}
                aria-invalid={missing || undefined}
                value={drafts[d.id] ?? (value === undefined ? '' : String(value))}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [d.id]: e.target.value }))}
                onBlur={() => commitDraft(d)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitDraft(d);
                  }
                }}
              />
            )}
          </div>
        );
      })}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** Nombres de los obligatorios que faltan (el inbox avisa antes de pedir resolver). */
export function missingAttributeNames(conversation: Pick<ChatConversationWithVisitor, 'widget_attributes' | 'attributes'>): string[] {
  const values = parseAttributeValues(conversation.attributes);
  return parseAttributeDefs(conversation.widget_attributes)
    .filter((d) => d.required && !isAttributeFilled(d, values[d.id]))
    .map((d) => d.name);
}

/** Descargar el transcript y mandárselo al visitante por email. */
export function TranscriptActions({ conversation }: { conversation: ChatConversationWithVisitor }) {
  const t = useTranslations('chat');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const base = `/api/chat/conversations/${conversation.id}/transcript`;
  const email = conversation.visitor.email;

  async function send() {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(base, { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as { to?: string; error?: string };
      if (res.ok) setNotice({ tone: 'ok', text: t('transcriptUi.sent', { email: data.to ?? email ?? '' }) });
      else setNotice({ tone: 'error', text: data.error === 'rate_limited' ? t('transcriptUi.rateLimited') : t('transcriptUi.sendFailed') });
    } catch {
      setNotice({ tone: 'error', text: t('transcriptUi.sendFailed') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="chat-details-section" aria-labelledby="chat-details-transcript">
      <h3 id="chat-details-transcript" className="chat-details-label">
        {t('transcriptUi.title')}
      </h3>
      <div className="chat-transcript-links">
        <a className="btn btn-secondary btn-sm" href={`${base}?format=txt`} download>
          {t('transcriptUi.downloadText')}
        </a>
        <a className="btn btn-ghost btn-sm" href={`${base}?format=txt&notes=1`} download>
          {t('transcriptUi.downloadWithNotes')}
        </a>
        <a className="btn btn-ghost btn-sm" href={`${base}?format=json&notes=1`} download>
          {t('transcriptUi.downloadJson')}
        </a>
      </div>
      {email ? (
        <>
          <button
            type="button"
            className="btn btn-secondary btn-sm btn-block"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={() => void send()}
          >
            {t('transcriptUi.email')}
          </button>
          <p className="ui-help">{t('transcriptUi.emailHint', { email })}</p>
        </>
      ) : (
        <p className="ui-help">{t('transcriptUi.needsEmail')}</p>
      )}
      {notice && (
        <p className={notice.tone === 'ok' ? 'ui-help chat-ok' : 'ui-error'} role="status">
          {notice.text}
        </p>
      )}
    </section>
  );
}

/** Otras conversaciones del mismo visitante: se pueden unir a esta. */
export function MergeConversations({
  conversation,
  onMerged,
}: {
  conversation: ChatConversationWithVisitor;
  onMerged: (next: ChatConversationWithVisitor) => void;
}) {
  const t = useTranslations('chat');
  const locale = useLocale();
  const [candidates, setCandidates] = useState<MergeCandidate[] | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  async function load() {
    try {
      const res = await fetch(`/api/chat/conversations/${conversation.id}/merge`);
      if (!res.ok) return;
      setCandidates(((await res.json()) as { candidates: MergeCandidate[] }).candidates);
    } catch {
      // sin lista: la sección no se muestra
    }
  }

  useEffect(() => {
    setCandidates(null);
    setConfirmId(null);
    setNotice(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id]);

  async function merge(sourceId: string) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/chat/conversations/${conversation.id}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId }),
      });
      if (!res.ok) {
        setNotice({ tone: 'error', text: t('merge.failed') });
        return;
      }
      const data = (await res.json()) as { moved: number; conversation: ChatConversationWithVisitor };
      setConfirmId(null);
      setNotice({ tone: 'ok', text: t('merge.done', { count: data.moved }) });
      onMerged(data.conversation);
      await load();
    } catch {
      setNotice({ tone: 'error', text: t('merge.failed') });
    } finally {
      setBusy(false);
    }
  }

  if (!candidates || (candidates.length === 0 && !notice)) return null;

  return (
    <section className="chat-details-section" aria-labelledby="chat-details-merge">
      <h3 id="chat-details-merge" className="chat-details-label">
        {t('merge.title')}
      </h3>
      {candidates.length > 0 && <p className="ui-help">{t('merge.hint')}</p>}
      <ul className="chat-merge-list">
        {candidates.map((c) => (
          <li key={c.id} className="chat-merge-item">
            <Link href={`/app/chat/inbox/${c.id}`} className="chat-merge-link">
              <span className="chat-merge-title">{c.subject || c.last_message_body || t('conversation.noMessages')}</span>
              <span className="ui-help" suppressHydrationWarning title={formatDateTime(c.created_at, locale)}>
                {t(`conversation.${c.status}`)} · {t('merge.messages', { count: c.message_count })} ·{' '}
                {formatTimeAgo(c.updated_at, locale)}
              </span>
            </Link>
            {confirmId === c.id ? (
              <span className="chat-merge-confirm">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busy}
                  aria-busy={busy || undefined}
                  onClick={() => void merge(c.id)}
                >
                  {t('merge.confirm')}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmId(null)}>
                  {t('common.cancel')}
                </button>
              </span>
            ) : (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmId(c.id)}>
                {t('merge.action')}
              </button>
            )}
          </li>
        ))}
      </ul>
      {confirmId && <p className="ui-help">{t('merge.confirmHint')}</p>}
      {notice && (
        <p className={notice.tone === 'ok' ? 'ui-help chat-ok' : 'ui-error'} role="status">
          {notice.text}
        </p>
      )}
    </section>
  );
}
