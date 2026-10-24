'use client';

import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { announceQueued, isQueuedResponse } from '@/lib/offline-queue';
import { Link, useRouter, usePathname } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import QuickModal, { useKeyShortcut } from '@/components/app/QuickModal';
import CrmIcon from './CrmIcon';
import { TASK_REPEATS, type TaskRepeat } from '@/lib/crm-task-repeat';

export interface TaskRow {
  id: string;
  subject: string;
  type: string;
  due: string | null;
  dueRel: string | null;
  overdue: boolean;
  done: boolean;
  pinned: boolean;
  record: { href: string; name: string } | null;
  ownerId?: string;
  ownerName?: string;
  projectId?: string;
  projectName?: string;
  projectColor?: string;
  /** Repetición de una tarea abierta (lib/crm-task-repeat.ts). */
  repeat?: TaskRepeat;
}

type Bucket = 'overdue' | 'today' | 'upcoming' | 'done';

interface TasksViewProps {
  bucket: Bucket;
  rows: TaskRow[];
  members: Array<{ value: string; label: string }>;
  projects: Array<{ value: string; label: string; color: string }>;
  ownerId?: string;
  projectId?: string;
  /** Título de la página: el header (título + CTA) lo arma la vista. */
  title: string;
  /** Contenido bajo el header (p. ej. el gestor de proyectos). */
  children?: ReactNode;
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

export default function TasksView({
  bucket,
  rows,
  members,
  projects,
  ownerId,
  projectId,
  title,
  children,
}: TasksViewProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [busyId, setBusyId] = useState<string | null>(null);
  // ?new=1 (menú "+ Nuevo" del sidebar / ⌘K): abre el composer de entrada.
  const [showComposer, setShowComposer] = useState(() => searchParams.get('new') === '1');

  const [subject, setSubject] = useState('');
  const [due, setDue] = useState('');
  const [type, setType] = useState<'task' | 'call' | 'meeting' | 'email' | 'note'>('task');
  const [contactId, setContactId] = useState('');
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [projectIdDraft, setProjectIdDraft] = useState(projectId ?? '');
  const [ownerIdDraft, setOwnerIdDraft] = useState(ownerId ?? '');
  const [repeat, setRepeat] = useState<TaskRepeat>('none');
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

  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    setShowComposer(true);
    const params = new URLSearchParams(searchParams.toString());
    params.delete('new');
    router.replace(`${pathname}${params.toString() ? `?${params.toString()}` : ''}`);
  }, [searchParams, pathname, router]);

  function setQuery(updates: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    if (params.get('bucket') === 'today') params.delete('bucket');
    router.push(`${pathname}${params.toString() ? `?${params.toString()}` : ''}`);
  }

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

  useKeyShortcut('c', () => setShowComposer(true), !showComposer);

  async function onSubmit(e?: FormEvent) {
    e?.preventDefault();
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
        type,
        subject: subject.trim(),
        dueAt: localToUtc(due),
        ...(contactId ? { contactId } : {}),
        ...(projectIdDraft ? { projectId: projectIdDraft } : {}),
        ...(ownerIdDraft ? { ownerId: ownerIdDraft } : {}),
        ...(type === 'task' && repeat !== 'none' ? { repeat } : {}),
      }),
    }).catch(() => null);
    setComposerBusy(false);
    const queued = isQueuedResponse(res);
    if (queued) announceQueued('/api/crm/activities');
    if (res && (res.status === 201 || queued)) {
      setSubject('');
      setDue('');
      setType('task');
      setContactId('');
      setProjectIdDraft('');
      setOwnerIdDraft('');
      setRepeat('none');
      setShowComposer(false);
      router.refresh();
      return;
    }
    setComposerError(t('errors.generic'));
  }

  function taskTypeLabel(value: string): string {
    return t(`enums.activityType.${value as 'task' | 'call' | 'meeting' | 'email' | 'note'}`);
  }

  return (
    <>
      <PageHeader
        title={title}
        actions={
          <>
            {children}
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setShowComposer(true)}
              data-testid="crm-quick-task"
            >
              {t('record.createTask')}
              <kbd className="kbd" aria-hidden>
                C
              </kbd>
            </button>
          </>
        }
      />
      <div className="task-controls">
        <nav className="ui-tabs task-buckets" aria-label={t('record.taskBuckets')}>
          {BUCKETS.map((b) => (
            <Link
              key={b}
              href={{ pathname: '/app/crm/tasks', query: b === 'today' ? {} : { bucket: b } }}
              className="ui-tab"
              aria-current={bucket === b ? 'page' : undefined}
            >
              {t(`tasks.${b}`)}
            </Link>
          ))}
        </nav>

        <div className="task-filters">
          <select
            className="select filter-select"
            value={ownerId ?? ''}
            onChange={(e) => setQuery({ owner: e.target.value || undefined })}
            aria-label={t('tasks.filterOwner')}
          >
            <option value="">{t('tasks.filterOwner')}</option>
            {members.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>

          <select
            className="select filter-select"
            value={projectId ?? ''}
            onChange={(e) => setQuery({ project: e.target.value || undefined })}
            aria-label={t('tasks.filterProject')}
          >
            <option value="">{t('tasks.filterProject')}</option>
            {projects.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <QuickModal
        open={showComposer}
        onClose={() => setShowComposer(false)}
        crumb={`CRM › ${t('quick.task.title')}`}
        onSubmit={() => onSubmit()}
        submitLabel={composerBusy ? t('common.creating') : t('common.create')}
        cancelLabel={t('common.cancel')}
        submitDisabled={!subject.trim()}
        busy={composerBusy}
        error={composerError}
        hint={t('quick.hint')}
      >
        <input
          data-autofocus
          className="qm-title"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder={t('tasks.form.subject')}
          aria-label={t('tasks.form.subject')}
          maxLength={500}
        />
        <div className="qm-row">
          <label className="qm-field">
            <span>{t('common.activityType')}</span>
            <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              {(['task', 'call', 'meeting', 'email', 'note'] as const).map((v) => (
                <option key={v} value={v}>
                  {taskTypeLabel(v)}
                </option>
              ))}
            </select>
          </label>
          <label className="qm-field">
            <span>{t('tasks.form.dueAt')}</span>
            <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
          {type === 'task' && (
            <label className="qm-field">
              <span>{t('tasks.form.repeat')}</span>
              <select value={repeat} onChange={(e) => setRepeat(e.target.value as TaskRepeat)} title={t('tasks.repeatHint')}>
                {TASK_REPEATS.map((v) => (
                  <option key={v} value={v}>
                    {t(`tasks.repeat.${v}`)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="qm-row">
          <label className="qm-field">
            <span>{t('tasks.form.contact')}</span>
            <select value={contactId} onChange={(e) => setContactId(e.target.value)}>
              <option value="">—</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="qm-field">
            <span>{t('tasks.form.project')}</span>
            <select value={projectIdDraft} onChange={(e) => setProjectIdDraft(e.target.value)}>
              <option value="">—</option>
              {projects.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="qm-field">
            <span>{t('tasks.form.owner')}</span>
            <select value={ownerIdDraft} onChange={(e) => setOwnerIdDraft(e.target.value)}>
              <option value="">—</option>
              {members.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </QuickModal>

      {rows.length === 0 ? (
        <EmptyState
          title={t(`record.empty.tasks.${bucket}`)}
          body={t('record.empty.tasksBody')}
          action={
            bucket === 'done' ? undefined : (
              <button type="button" className="btn btn-primary" onClick={() => setShowComposer(true)}>
                {t('record.createTask')}
              </button>
            )
          }
        />
      ) : (
        <div className="task-list">
          {rows.map((row) => (
            <div
              key={row.id}
              className={`task-row${row.done ? ' done' : ''}${row.pinned ? ' pinned' : ''}${busyId === row.id ? ' row-busy' : ''}`}
            >
              <button
                type="button"
                className={`task-check${row.done ? ' checked' : ''}`}
                aria-label={row.done ? t('tasks.reopen') : t('tasks.complete')}
                title={row.done ? t('tasks.reopen') : t('tasks.complete')}
                onClick={() => setDone(row.id, !row.done)}
              >
                <CrmIcon name="check" />
              </button>

              <div className="task-main">
                <div className="task-top">
                  <Link href={`/app/crm/tasks/${row.id}`} className="task-subject">
                    {row.subject}
                  </Link>
                  {row.projectName && (
                    <span
                      className="task-project-chip"
                      style={{ '--project-color': row.projectColor ?? '#666' } as React.CSSProperties}
                    >
                      {row.projectName}
                    </span>
                  )}
                </div>
                <div className="task-meta">
                  <span className="task-type muted">{taskTypeLabel(row.type)}</span>
                  {row.due ? (
                    <span className={`task-due${row.overdue && !row.done ? ' is-overdue' : ''}`}>{row.due}</span>
                  ) : (
                    <span className="muted">{t('tasks.noDue')}</span>
                  )}
                  {row.dueRel && <span className="muted task-rel">{row.dueRel}</span>}
                  {row.repeat && <span className="muted task-repeat">{t(`tasks.repeat.${row.repeat}`)}</span>}
                  {row.record?.name && (
                    <Link href={row.record.href} className="cell-email muted">
                      {row.record.name}
                    </Link>
                  )}
                  {row.ownerName && <span className="muted task-owner">{row.ownerName}</span>}
                </div>
              </div>

              <div className="task-actions">
                <Link href={`/app/crm/tasks/${row.id}`} className="btn btn-ghost btn-icon btn-sm" aria-label={t('common.edit')}>
                  <CrmIcon name="edit" />
                </Link>
                <button
                  type="button"
                  className="btn btn-ghost btn-icon btn-sm row-delete"
                  aria-label={t('common.delete')}
                  title={t('common.delete')}
                  onClick={() => remove(row.id)}
                >
                  <CrmIcon name="x" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
