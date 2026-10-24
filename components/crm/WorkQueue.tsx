'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import EmptyState from '@/components/ui/EmptyState';
import type { QueueTask, SnoozeOption } from '@/lib/crm-work-queue';
import PhoneTouch from './PhoneTouch';
import RecordPreview, { type PreviewType } from './RecordPreview';

type ItemStatus = 'open' | 'done' | 'skipped' | 'snoozed' | 'deleted';

const SNOOZES: SnoozeOption[] = ['1h', '3h', 'tomorrow', 'two_days', 'next_week'];

interface WorkQueueProps {
  tasks: QueueTask[];
  locale: string;
  timeZone: string;
}

/** Registro principal de la tarea: contacto, si no deal, si no empresa. */
function recordOf(task: QueueTask): { type: PreviewType; id: string; name: string; href: string } | null {
  if (task.contact) return { type: 'contact', id: task.contact.id, name: task.contact.name, href: `/app/crm/contacts/${task.contact.id}` };
  if (task.deal) return { type: 'deal', id: task.deal.id, name: task.deal.name, href: `/app/crm/deals/${task.deal.id}` };
  if (task.company) return { type: 'company', id: task.company.id, name: task.company.name, href: `/app/crm/companies/${task.company.id}` };
  return null;
}

/**
 * Cola de trabajo: recorre las tareas una por una. Completar (D), saltar (S),
 * posponer (Z), abrir la vista previa del registro (P) o el registro (O),
 * anterior y siguiente con las flechas; Esc vuelve a Tareas. Completar o
 * posponer avanza sola a la próxima pendiente.
 */
export default function WorkQueue({ tasks, locale, timeZone }: WorkQueueProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState<Record<string, ItemStatus>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [preview, setPreview] = useState<{ type: PreviewType; id: string } | null>(null);
  const [announce, setAnnounce] = useState('');
  const [finished, setFinished] = useState(tasks.length === 0);
  const cardRef = useRef<HTMLElement>(null);
  const snoozeRef = useRef<HTMLDivElement>(null);

  const task = tasks[index] ?? null;
  const record = task ? recordOf(task) : null;
  const counts = useMemo(() => {
    const c = { done: 0, skipped: 0, snoozed: 0 };
    for (const s of Object.values(status)) {
      if (s === 'done') c.done++;
      else if (s === 'skipped') c.skipped++;
      else if (s === 'snoozed') c.snoozed++;
    }
    return c;
  }, [status]);
  const handled = counts.done + counts.snoozed + Object.values(status).filter((s) => s === 'deleted').length;

  const fmtDue = useCallback(
    (iso: string) =>
      new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(
        new Date(`${iso.replace(' ', 'T')}Z`),
      ),
    [locale, timeZone],
  );
  const fmtMoney = (amount: number, currency: string) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(amount);

  useEffect(() => {
    setNote('');
    setError(null);
    setSnoozeOpen(false);
    cardRef.current?.focus();
  }, [index]);

  /** Próxima tarea sin tocar después de la actual (da la vuelta); null = no queda ninguna. */
  function nextPending(from: number, st: Record<string, ItemStatus>): number | null {
    for (let k = 1; k <= tasks.length; k++) {
      const i = (from + k) % tasks.length;
      if (!st[tasks[i].id]) return i;
    }
    return null;
  }

  function advance(st: Record<string, ItemStatus>) {
    const n = nextPending(index, st);
    if (n === null) setFinished(true);
    else setIndex(n);
  }

  function mark(id: string, s: ItemStatus) {
    const next = { ...status, [id]: s };
    setStatus(next);
    return next;
  }

  async function complete() {
    if (!task || busy || status[task.id] === 'done') return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/crm/activities/${task.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ done: true }),
    }).catch(() => null);
    if (!res?.ok) {
      setBusy(false);
      setError(t('queue.errorSave'));
      return;
    }
    // La nota opcional queda en el timeline del registro.
    const text = note.trim();
    if (text && record) {
      await fetch('/api/crm/activities', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'note', body: text, [`${record.type}Id`]: record.id }),
      }).catch(() => null);
    }
    setBusy(false);
    setAnnounce(t('queue.completedOne', { subject: task.subject || t('queue.untitled') }));
    advance(mark(task.id, 'done'));
  }

  function skip() {
    if (!task) return;
    setAnnounce(t('queue.skippedOne'));
    advance(status[task.id] ? status : mark(task.id, 'skipped'));
  }

  async function snooze(option: SnoozeOption) {
    if (!task || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/crm/tasks/${task.id}/snooze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ option }),
    }).catch(() => null);
    setBusy(false);
    setSnoozeOpen(false);
    if (!res?.ok) {
      setError(t('queue.errorSave'));
      return;
    }
    setAnnounce(t('queue.snoozedOne', { when: t(`queue.snooze.${option}`) }));
    advance(mark(task.id, 'snoozed'));
  }

  function go(delta: number) {
    const i = index + delta;
    if (i >= 0 && i < tasks.length) setIndex(i);
  }

  // Atajos de la cola (fuera de inputs y diálogos).
  const handlers = useRef({ complete, skip, go, setSnoozeOpen, setPreview, record, router, finished });
  handlers.current = { complete, skip, go, setSnoozeOpen, setPreview, record, router, finished };
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      const inField = !!el?.closest('input, textarea, select, [contenteditable="true"]');
      const h = handlers.current;
      if (e.key === 'Escape') {
        if (inField || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
        if (snoozeRef.current?.contains(document.activeElement)) return;
        e.preventDefault();
        h.router.push('/app/crm/tasks');
        return;
      }
      if (inField || h.finished || document.querySelector('[role="dialog"]')) return;
      const k = e.key.toLowerCase();
      if (k === 'd') {
        e.preventDefault();
        void h.complete();
      } else if (k === 's') {
        e.preventDefault();
        h.skip();
      } else if (k === 'z') {
        e.preventDefault();
        h.setSnoozeOpen(true);
      } else if (k === 'p' && h.record) {
        e.preventDefault();
        h.setPreview({ type: h.record.type, id: h.record.id });
      } else if (k === 'o' && h.record) {
        e.preventDefault();
        h.router.push(h.record.href);
      } else if (e.key === 'ArrowRight' || k === 'j') {
        e.preventDefault();
        h.go(1);
      } else if (e.key === 'ArrowLeft' || k === 'k') {
        e.preventDefault();
        h.go(-1);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Menú de posponer: foco en la primera opción, Esc lo cierra.
  useEffect(() => {
    if (!snoozeOpen) return;
    snoozeRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [snoozeOpen]);

  if (tasks.length === 0) {
    return (
      <EmptyState
        title={t('queue.emptyTitle')}
        body={t('queue.emptyBody')}
        action={{ label: t('queue.backToTasks'), href: '/app/crm/tasks?bucket=upcoming' }}
      />
    );
  }

  if (finished) {
    const pending = tasks.filter((x) => !status[x.id] || status[x.id] === 'skipped').length;
    return (
      <section className="wq-done" data-testid="queue-finished" aria-labelledby="wq-done-title">
        <h2 id="wq-done-title" className="wq-title">
          {t('queue.finishedTitle')}
        </h2>
        <p className="muted">
          {t('queue.finishedSummary', { done: counts.done, snoozed: counts.snoozed, skipped: pending })}
        </p>
        <div className="form-actions">
          {pending > 0 && (
            <button
              type="button"
              className="btn btn-solid btn-small"
              onClick={() => {
                const first = tasks.findIndex((x) => !status[x.id] || status[x.id] === 'skipped');
                setStatus((s) => Object.fromEntries(Object.entries(s).filter(([, v]) => v !== 'skipped')));
                setFinished(false);
                setIndex(Math.max(0, first));
              }}
            >
              {t('queue.reviewSkipped', { count: pending })}
            </button>
          )}
          <Link href="/app/crm/tasks" className="btn btn-small" onClick={() => router.refresh()}>
            {t('queue.backToTasks')}
          </Link>
        </div>
      </section>
    );
  }

  if (!task) return null;
  const st = status[task.id];
  const pct = Math.round((handled / tasks.length) * 100);

  return (
    <div className="wq">
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
      <div className="wq-progress">
        <span className="num" data-testid="queue-counter">
          {t('queue.counter', { current: index + 1, total: tasks.length })}
        </span>
        <span className="wq-bar" role="progressbar" aria-valuemin={0} aria-valuemax={tasks.length} aria-valuenow={handled} aria-label={t('queue.progress')}>
          <span className="wq-bar-fill" style={{ width: `${pct}%` }} />
        </span>
        <span className="muted num">{t('queue.doneCount', { done: counts.done })}</span>
      </div>

      <article className="wq-card" ref={cardRef} tabIndex={-1} aria-labelledby="wq-subject" data-testid="queue-card">
        <header className="wq-card-head">
          <div className="wq-tags">
            {task.overdue && <span className="badge prio-high">{t('queue.overdue')}</span>}
            {task.sequence && <span className="badge" data-testid="queue-sequence">{t('queue.fromSequence', { name: task.sequence.name })}</span>}
            {st && st !== 'open' && <span className="badge">{t(`queue.status.${st}`)}</span>}
          </div>
          <h2 id="wq-subject" className="wq-title">
            {task.subject || t('queue.untitled')}
          </h2>
          {task.due_at && <p className="muted wq-due">{t('queue.due', { date: fmtDue(task.due_at) })}</p>}
        </header>
        {task.body && <p className="wq-body">{task.body}</p>}

        {(task.contact || task.company || task.deal) && (
          <dl className="wq-record">
            {task.contact && (
              <div>
                <dt>{t('tasks.form.contact')}</dt>
                <dd>
                  <Link href={`/app/crm/contacts/${task.contact.id}`}>{task.contact.name}</Link>
                  {(task.contact.job_title || task.contact.company_name) && (
                    <span className="muted">{[task.contact.job_title, task.contact.company_name].filter(Boolean).join(' · ')}</span>
                  )}
                  {task.contact.email && <a href={`mailto:${task.contact.email}`}>{task.contact.email}</a>}
                  {task.contact.phone && (
                    <span className="wq-phone">
                      <span className="num">{task.contact.phone}</span>
                      <PhoneTouch phone={task.contact.phone} contactId={task.contact.id} dealId={task.deal?.id} />
                    </span>
                  )}
                </dd>
              </div>
            )}
            {task.company && (
              <div>
                <dt>{t('tasks.form.company')}</dt>
                <dd>
                  <Link href={`/app/crm/companies/${task.company.id}`}>{task.company.name}</Link>
                  {task.company.domain && <span className="muted">{task.company.domain}</span>}
                </dd>
              </div>
            )}
            {task.deal && (
              <div>
                <dt>{t('tasks.form.deal')}</dt>
                <dd>
                  <Link href={`/app/crm/deals/${task.deal.id}`}>{task.deal.name}</Link>
                  <span className="muted num">
                    {fmtMoney(task.deal.amount, task.deal.currency)}
                    {task.deal.stage ? ` · ${task.deal.stage}` : ''}
                  </span>
                </dd>
              </div>
            )}
          </dl>
        )}

        <label className="field wq-note">
          <span className="prop-label">{t('queue.noteLabel')}</span>
          <textarea
            className="textarea"
            rows={2}
            maxLength={5000}
            value={note}
            disabled={!record}
            placeholder={record ? t('queue.notePlaceholder') : t('queue.noRecord')}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                void complete();
              }
            }}
          />
        </label>
        {error && <p className="form-error">{error}</p>}

        <div className="wq-actions">
          <button type="button" className="btn btn-solid btn-small" onClick={() => void complete()} disabled={busy || st === 'done'} data-testid="queue-complete">
            {t('queue.complete')} <kbd className="kbd" aria-hidden>D</kbd>
          </button>
          <button type="button" className="btn btn-small" onClick={skip} disabled={busy} data-testid="queue-skip">
            {t('queue.skip')} <kbd className="kbd" aria-hidden>S</kbd>
          </button>
          <div className="wq-snooze">
            <button
              type="button"
              className="btn btn-small"
              aria-haspopup="menu"
              aria-expanded={snoozeOpen}
              onClick={() => setSnoozeOpen((v) => !v)}
              disabled={busy || st === 'done'}
              data-testid="queue-snooze"
            >
              {t('queue.snoozeBtn')} <kbd className="kbd" aria-hidden>Z</kbd>
            </button>
            {snoozeOpen && (
              <div
                className="wq-menu"
                role="menu"
                ref={snoozeRef}
                aria-label={t('queue.snoozeBtn')}
                onKeyDown={(e) => {
                  const items = Array.from(snoozeRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
                  const i = items.indexOf(document.activeElement as HTMLButtonElement);
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    setSnoozeOpen(false);
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    items[(i + 1) % items.length]?.focus();
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    items[(i - 1 + items.length) % items.length]?.focus();
                  }
                }}
              >
                {SNOOZES.map((o) => (
                  <button key={o} type="button" role="menuitem" className="wq-menu-item" onClick={() => void snooze(o)}>
                    {t(`queue.snooze.${o}`)}
                  </button>
                ))}
              </div>
            )}
          </div>
          {record && (
            <>
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setPreview({ type: record.type, id: record.id })}>
                {t('queue.preview')} <kbd className="kbd" aria-hidden>P</kbd>
              </button>
              <Link href={record.href} className="btn btn-ghost btn-small">
                {t('queue.openRecord')} <kbd className="kbd" aria-hidden>O</kbd>
              </Link>
            </>
          )}
          <span className="wq-nav">
            <button type="button" className="btn btn-ghost btn-small" onClick={() => go(-1)} disabled={index === 0} aria-label={t('queue.prev')}>
              ←
            </button>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => go(1)} disabled={index >= tasks.length - 1} aria-label={t('queue.next')}>
              →
            </button>
          </span>
        </div>
        <p className="muted wq-keys">{t('queue.keysHint')}</p>
      </article>

      {preview && <RecordPreview type={preview.type} id={preview.id} locale={locale} onClose={() => setPreview(null)} />}
    </div>
  );
}
