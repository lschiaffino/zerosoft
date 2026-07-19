'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

export type TimelineRecordType = 'contact' | 'company' | 'deal';

export interface TimelineItem {
  id: string;
  type: 'note' | 'task' | 'call' | 'meeting' | 'email';
  subject: string;
  body: string;
  due_at: string | null;
  done: 0 | 1;
  pinned: 0 | 1;
  direction: string;
  outcome: string;
  duration_min: number | null;
  contact_name?: string | null;
  company_name?: string | null;
  deal_name?: string | null;
  created_at: string;
  /** Email sincronizado desde Gmail: read-only, sin acciones, badge "Gmail". */
  external?: boolean;
  from_email?: string;
}

interface TimelineProps {
  recordType: TimelineRecordType;
  recordId: string;
  items: TimelineItem[];
  emptyLabel: string;
  locale: string;
  /** Email precargado en el composer cuando type === email. */
  defaultEmail?: string;
}

const TYPES = ['note', 'task', 'call', 'meeting', 'email'] as const;
type ActivityType = (typeof TYPES)[number];

const SUBMIT_KEYS: Record<ActivityType, string> = {
  note: 'common.addNote',
  task: 'common.addTask',
  call: 'common.logCall',
  meeting: 'common.logMeeting',
  email: 'common.sendEmail',
};

function formatWhen(iso: string, locale: string): string {
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

function formatDay(iso: string, locale: string): string {
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' }).format(
    d,
  );
}

/**
 * Timeline reutilizable (contacts / companies / deals): composer con
 * selector de tipo + lista filtrable con done toggle y delete.
 * El padre (server) pasa los items; tras cada mutación router.refresh().
 */
export default function Timeline({
  recordType,
  recordId,
  items,
  emptyLabel,
  locale,
  defaultEmail = '',
}: TimelineProps) {
  const t = useTranslations('crm');
  const router = useRouter();

  // Composer
  const [type, setType] = useState<ActivityType>('note');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [emailTo, setEmailTo] = useState(defaultEmail);
  const [dueAt, setDueAt] = useState('');
  const [direction, setDirection] = useState('');
  const [durationMin, setDurationMin] = useState('');
  const [posting, setPosting] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  // Lista
  const [filter, setFilter] = useState<ActivityType | 'all'>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // Edición inline (subject + body)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');

  const filtered = filter === 'all' ? items : items.filter((i) => i.type === filter);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setEmailError(null);
    if (type === 'email') {
      if (!emailTo.trim() || (!subject.trim() && !body.trim())) return;
      setPosting(true);
      const res = await fetch('/api/crm/emails', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          recordType,
          recordId,
          to: emailTo.trim(),
          subject: subject.trim(),
          body: body.trim(),
        }),
      }).catch(() => null);
      setPosting(false);
      if (res && res.ok) {
        setSubject('');
        setBody('');
        setEmailTo(defaultEmail);
        router.refresh();
      } else {
        const data = await res?.json().catch(() => ({}));
        setEmailError(data.error ? t(`errors.${data.error}` as const) : t('errors.generic'));
      }
      return;
    }

    if (!subject.trim() && !body.trim()) return;
    setPosting(true);
    const payload: Record<string, unknown> = {
      type,
      subject: subject.trim() || undefined,
      body: body.trim() || undefined,
      [`${recordType}Id`]: recordId,
    };
    if (type === 'task' && dueAt) payload.dueAt = dueAt;
    if (type === 'call' && direction) payload.direction = direction;
    if (type === 'meeting' && durationMin) payload.durationMin = Number(durationMin);
    await fetch('/api/crm/activities', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => null);
    setPosting(false);
    setSubject('');
    setBody('');
    setDueAt('');
    setDirection('');
    setDurationMin('');
    router.refresh();
  }

  async function toggleDone(item: TimelineItem) {
    setBusyId(item.id);
    await fetch(`/api/crm/activities/${item.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ done: !item.done }),
    }).catch(() => null);
    setBusyId(null);
    router.refresh();
  }

  async function togglePin(item: TimelineItem) {
    setBusyId(item.id);
    await fetch(`/api/crm/activities/${item.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pinned: !item.pinned }),
    }).catch(() => null);
    setBusyId(null);
    router.refresh();
  }

  function startEdit(item: TimelineItem) {
    setEditingId(item.id);
    setEditSubject(item.subject);
    setEditBody(item.body);
  }

  async function saveEdit(item: TimelineItem) {
    setBusyId(item.id);
    const res = await fetch(`/api/crm/activities/${item.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subject: editSubject.trim(), body: editBody.trim() }),
    }).catch(() => null);
    setBusyId(null);
    if (res && res.ok) {
      setEditingId(null);
      router.refresh();
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    await fetch(`/api/crm/activities/${id}`, { method: 'DELETE' }).catch(() => null);
    setBusyId(null);
    setConfirmId(null);
    router.refresh();
  }

  return (
    <div className="timeline-wrap">
      <form className="tl-composer" onSubmit={submit}>
        <div className="tl-composer-tabs">
          {TYPES.map((v) => (
            <button
              key={v}
              type="button"
              className={`chip${type === v ? ' active' : ''}`}
              onClick={() => setType(v)}
            >
              {t(`enums.activityType.${v}`)}
            </button>
          ))}
        </div>
        {type === 'email' && (
          <input
            className="input"
            type="email"
            value={emailTo}
            onChange={(e) => setEmailTo(e.target.value)}
            placeholder={t('common.to')}
            required
          />
        )}
        <input
          className="input"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder={type === 'email' ? t('common.subject') : t('tasks.form.subject')}
          maxLength={500}
        />
        <textarea
          className="textarea"
          rows={type === 'email' ? 6 : 3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={type === 'email' ? t('common.body') : t('tasks.form.body')}
          maxLength={type === 'email' ? 20000 : 5000}
        />
        <div className="tl-composer-actions">
          <div className="tl-composer-extras">
            {type === 'task' && (
              <input
                className="input"
                type="date"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                aria-label={t('tasks.form.dueAt')}
              />
            )}
            {type === 'call' && (
              <select
                className="filter-select"
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
                aria-label={t('common.optional')}
              >
                <option value="">—</option>
                <option value="inbound">{t('enums.direction.inbound')}</option>
                <option value="outbound">{t('enums.direction.outbound')}</option>
              </select>
            )}
            {type === 'meeting' && (
              <input
                className="input tl-duration"
                type="number"
                min={0}
                value={durationMin}
                onChange={(e) => setDurationMin(e.target.value)}
                placeholder={t('common.durationMin')}
                aria-label={t('common.durationMin')}
              />
            )}
          </div>
          <button
            type="submit"
            className="btn btn-solid btn-small"
            disabled={posting || (!subject.trim() && !body.trim()) || (type === 'email' && !emailTo.trim())}
          >
            {posting ? t('common.creating') : t(SUBMIT_KEYS[type])}
          </button>
        </div>
        {emailError && <p className="form-error">{emailError}</p>}
      </form>

      <div className="filter-chips tl-filters">
        <button
          type="button"
          className={`chip${filter === 'all' ? ' active' : ''}`}
          onClick={() => setFilter('all')}
        >
          {t('common.all')}
        </button>
        {TYPES.map((v) => (
          <button
            key={v}
            type="button"
            className={`chip${filter === v ? ' active' : ''}`}
            onClick={() => setFilter(v)}
          >
            {t(`enums.activityType.${v}`)}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="muted">{emptyLabel}</p>
      ) : (
        <div className="timeline">
          {filtered.map((item) => (
            <div
              key={item.id}
              className={`tl-item${item.done ? ' tl-done' : ''}${item.pinned ? ' tl-pinned' : ''}${busyId === item.id ? ' row-busy' : ''}`}
            >
              <span className={`tl-dot ${item.type}`} aria-hidden />
              {editingId === item.id ? (
                <div className="tl-edit">
                  <input
                    className="input"
                    value={editSubject}
                    onChange={(e) => setEditSubject(e.target.value)}
                    placeholder={t('tasks.form.subject')}
                    maxLength={500}
                  />
                  <textarea
                    className="textarea"
                    rows={3}
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    placeholder={t('tasks.form.body')}
                    maxLength={5000}
                  />
                  <div className="form-actions">
                    <button
                      type="button"
                      className="btn btn-solid btn-small"
                      disabled={busyId === item.id}
                      onClick={() => saveEdit(item)}
                    >
                      {t('common.save')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-small"
                      onClick={() => setEditingId(null)}
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="tl-head">
                    <span className="tl-type">{t(`enums.activityType.${item.type}`)}</span>
                    {item.external ? <span className="badge">Gmail</span> : null}
                    {!item.external && item.type === 'email' && item.direction === 'outbound' ? (
                      <span className="badge">{t('common.sent')}</span>
                    ) : null}
                    {item.pinned ? <span className="badge">{t('common.pinned')}</span> : null}
                    <span className="tl-subject">{item.subject || '—'}</span>
                    <span className="tl-date">
                      {formatWhen(item.due_at ?? item.created_at, locale)}
                    </span>
                  </div>
                  {item.body && <p className="tl-body">{item.body}</p>}
                  <div className="tl-meta">
                    {item.type === 'task' && item.due_at && (
                      <span>
                        {t('tasks.dueLabel')} {formatDay(item.due_at, locale)}
                      </span>
                    )}
                    {item.direction && <span>{t(`enums.direction.${item.direction}`)}</span>}
                    {item.duration_min != null && <span>{item.duration_min} min</span>}
                    {item.outcome && <span>{item.outcome}</span>}
                    {item.external && item.from_email && (
                      <span className="tl-from">{item.from_email}</span>
                    )}
                    {!item.external && item.type === 'task' && (
                      <button type="button" className="icon-btn" onClick={() => toggleDone(item)}>
                        {item.done ? t('tasks.reopen') : t('tasks.complete')}
                      </button>
                    )}
                    {!item.external && (
                      <>
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => togglePin(item)}
                          title={item.pinned ? t('common.unpin') : t('common.pin')}
                          aria-label={item.pinned ? t('common.unpin') : t('common.pin')}
                        >
                          {item.pinned ? '◆' : '◇'}
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => startEdit(item)}
                          title={t('common.edit')}
                          aria-label={t('common.edit')}
                        >
                          ✎
                        </button>
                        {confirmId === item.id ? (
                          <>
                            <button
                              type="button"
                              className="icon-btn danger"
                              onClick={() => remove(item.id)}
                            >
                              {t('common.yes')}
                            </button>
                            <button type="button" className="icon-btn" onClick={() => setConfirmId(null)}>
                              {t('common.no')}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="icon-btn danger"
                            onClick={() => setConfirmId(item.id)}
                            title={t('common.delete')}
                            aria-label={t('common.delete')}
                          >
                            ✕
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
