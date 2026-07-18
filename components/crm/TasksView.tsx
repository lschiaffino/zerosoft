'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';

export interface TaskRow {
  id: string;
  subject: string;
  due: string | null;
  overdue: boolean;
  done: boolean;
  record: { href: string; name: string } | null;
}

type Bucket = 'overdue' | 'today' | 'upcoming' | 'done';

interface TasksViewProps {
  bucket: Bucket;
  rows: TaskRow[];
}

interface ContactOption {
  id: string;
  name: string;
}

const BUCKETS: Bucket[] = ['overdue', 'today', 'upcoming', 'done'];

/** datetime-local (hora local) → 'YYYY-MM-DD HH:MM' UTC (formato de la DB). */
function localToUtc(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export default function TasksView({ bucket, rows }: TasksViewProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  const [subject, setSubject] = useState('');
  const [due, setDue] = useState('');
  const [contactId, setContactId] = useState('');
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [composerBusy, setComposerBusy] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/crm/contacts?pageSize=100')
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((data: { rows: Array<{ id: string; first_name: string; last_name: string; email: string }> }) => {
        if (cancelled) return;
        setContacts(
          data.rows.map((c) => ({
            id: c.id,
            name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email,
          })),
        );
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, []);

  async function setDone(id: string, done: boolean) {
    setBusyId(id);
    await fetch(`/api/crm/activities/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ done }),
    }).catch(() => null);
    setBusyId(null);
    router.refresh();
  }

  async function remove(id: string) {
    setBusyId(id);
    await fetch(`/api/crm/activities/${id}`, { method: 'DELETE' }).catch(() => null);
    setBusyId(null);
    router.refresh();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setComposerError(null);
    if (!subject.trim()) {
      setComposerError(t('errors.missing_name'));
      return;
    }
    setComposerBusy(true);
    const res = await fetch('/api/crm/activities', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'task',
        subject: subject.trim(),
        dueAt: localToUtc(due),
        ...(contactId ? { contactId } : {}),
      }),
    }).catch(() => null);
    setComposerBusy(false);
    if (res && res.status === 201) {
      setSubject('');
      setDue('');
      setContactId('');
      router.refresh();
      return;
    }
    setComposerError(t('errors.generic'));
  }

  return (
    <>
      <div className="filter-chips">
        {BUCKETS.map((b) => (
          <Link
            key={b}
            href={{ pathname: '/app/crm/tasks', query: b === 'today' ? {} : { bucket: b } }}
            className={`chip${bucket === b ? ' active' : ''}`}
          >
            {t(`tasks.${b}`)}
          </Link>
        ))}
      </div>

      <form className="task-composer" onSubmit={onSubmit}>
        <input
          className="input task-composer-subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder={t('tasks.form.subject')}
          aria-label={t('tasks.form.subject')}
          maxLength={500}
        />
        <input
          className="input"
          type="datetime-local"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          aria-label={t('tasks.form.dueAt')}
        />
        <select
          className="select"
          value={contactId}
          onChange={(e) => setContactId(e.target.value)}
          aria-label={t('tasks.form.contact')}
        >
          <option value="">{t('tasks.form.contact')}</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-solid btn-small" disabled={composerBusy}>
          {composerBusy ? t('common.creating') : t('common.add')}
        </button>
        {composerError && <p className="form-error">{composerError}</p>}
      </form>

      {rows.length === 0 ? (
        <div className="empty-state">
          <p className="empty-zeros mono" aria-hidden>
            0 0 0 0 0 0 0
          </p>
          <p className="muted">{t('tasks.empty')}</p>
        </div>
      ) : (
        <div className="task-list">
          {rows.map((row) => (
            <div
              key={row.id}
              className={`task-row${row.done ? ' done' : ''}${busyId === row.id ? ' row-busy' : ''}`}
            >
              <button
                type="button"
                className={`task-check${row.done ? ' checked' : ''}`}
                aria-label={row.done ? t('tasks.reopen') : t('tasks.complete')}
                title={row.done ? t('tasks.reopen') : t('tasks.complete')}
                onClick={() => setDone(row.id, !row.done)}
              >
                ✓
              </button>
              <span className="task-subject">{row.subject}</span>
              <span className="task-meta">
                {row.due ? (
                  <span className={`badge${row.overdue ? ' task-overdue' : row.done ? ' task-done' : ''}`}>
                    {row.due}
                  </span>
                ) : (
                  <span className="muted">{t('tasks.noDue')}</span>
                )}
                {row.record?.name && (
                  <Link href={row.record.href} className="cell-email muted">
                    {row.record.name}
                  </Link>
                )}
              </span>
              <button
                type="button"
                className="icon-btn danger"
                aria-label={t('common.delete')}
                title={t('common.delete')}
                onClick={() => remove(row.id)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
