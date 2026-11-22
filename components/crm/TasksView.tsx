'use client';

import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import { Fragment, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { announceQueued, isQueuedResponse } from '@/lib/offline-queue';
import { Link, useRouter, usePathname } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import QuickModal, { useKeyShortcut } from '@/components/app/QuickModal';
import CrmIcon from './CrmIcon';
import BulkEditControls, { type BulkEditField } from './BulkEditControls';
import EditColumns, { useTableColumns, type ColumnDef } from './EditColumns';
import { TASK_REPEATS, type TaskRepeat } from '@/lib/crm-task-repeat';
import {
  REMINDER_OFFSETS,
  TASK_INDEX_KINDS,
  TASK_INDEX_PRIORITIES,
  reminderFromDue,
  type ReminderOffset,
  type TaskIndexFilter,
  type TaskIndexSort,
} from '@/lib/crm-tasks-shared';

export interface TaskRow {
  id: string;
  subject: string;
  /** task (to-do), call o email. */
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
  /** Cola con nombre que quien mira ve (las demás llegan vacías). */
  queueId?: string;
  queueName?: string;
  /** Recordatorio pendiente, ya formateado. */
  reminder?: string;
  /** Creada, ya formateada. */
  created?: string;
  /** Repetición de una tarea abierta (lib/crm-task-repeat.ts). */
  repeat?: TaskRepeat;
  priority?: 'low' | 'medium' | 'high';
  /** Origen fuera del CRM (lib/tasks.ts): el chat de WhatsApp, la página, el issue. */
  source?: { href: string; app: 'groups' | 'chat' | 'docs' | 'track'; label: string };
  /** De un chat de Lines que quien mira no ve: `subject` es el marcador (lib/crm-chat-privacy.ts). */
  chatPrivate?: boolean;
}

type Option = { value: string; label: string };

interface TasksViewProps {
  rows: TaskRow[];
  total: number;
  members: Option[];
  projects: Array<Option & { color: string }>;
  queues: Option[];
  /** Estado del listado (vista activa + URL) y lo que conservan los links (lib/crm-views-shared.ts). */
  state: Record<string, string>;
  keep: Record<string, string>;
  filter: TaskIndexFilter;
  /** Título de la página: el header (título + CTA) lo arma la vista. */
  title: string;
  /** Botones de gestión en el header (colas, proyectos). */
  children?: ReactNode;
  /** Pestañas de vistas y paginador (componentes del server). */
  tabs?: ReactNode;
  pager?: ReactNode;
  /** Tareas vencidas y de hoy de la persona: el botón de la cola de trabajo. */
  queueCount?: number;
  /** La cola de trabajo con lo que muestra esta vista. */
  viewQueueHref: string;
}

interface ContactOption {
  id: string;
  name: string;
}

type SortColumn = 'subject' | 'due' | 'priority';

/** datetime-local (hora local) → 'YYYY-MM-DD HH:MM' UTC (formato de la DB). */
function localToUtc(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

const defaultSort = (bucket: string): TaskIndexSort => (bucket === 'done' ? '-due' : 'due');

export default function TasksView({
  rows,
  total,
  members,
  projects,
  queues,
  state,
  keep,
  filter,
  title,
  children,
  tabs,
  pager,
  queueCount,
  viewQueueHref,
}: TasksViewProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [search, setSearch] = useState(filter.q ?? '');
  // ?new=1 (menú "+ Nuevo" del sidebar / ⌘K): abre el composer de entrada.
  const [showComposer, setShowComposer] = useState(() => searchParams.get('new') === '1');

  const [subject, setSubject] = useState('');
  const [due, setDue] = useState('');
  // Tipo de tarea (HubSpot: To-do, Call, Email): siempre es una tarea pendiente.
  const [type, setType] = useState<'task' | 'call' | 'email'>('task');
  const [contactId, setContactId] = useState('');
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [projectIdDraft, setProjectIdDraft] = useState(filter.projectId ?? '');
  const [ownerIdDraft, setOwnerIdDraft] = useState('');
  // La cola del filtro solo si la persona la ve (una vista compartida puede traer otra).
  const defaultQueue = filter.queueId && queues.some((q) => q.value === filter.queueId) ? filter.queueId : '';
  const [queueIdDraft, setQueueIdDraft] = useState(defaultQueue);
  const [reminder, setReminder] = useState<ReminderOffset>('none');
  const [repeat, setRepeat] = useState<TaskRepeat>('none');
  const [composerBusy, setComposerBusy] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);

  // Otra página o filtro: la selección no sigue.
  const rowKey = rows.map((r) => r.id).join(',');
  useEffect(() => {
    setSelected(new Set());
    setConfirmingDelete(false);
  }, [rowKey]);

  useEffect(() => {
    setSearch(filter.q ?? '');
  }, [filter.q]);

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

  /** Cambia el estado del listado: la vista activa y "la URL manda" se conservan; vuelve a la página 1. */
  function go(updates: Record<string, string | undefined>) {
    const next: Record<string, string> = { ...keep, ...state };
    for (const [k, v] of Object.entries(updates)) {
      if (v) next[k] = v;
      else delete next[k];
    }
    if (next.sort && next.sort === defaultSort(next.bucket ?? 'all')) delete next.sort;
    const qs = new URLSearchParams(next).toString();
    router.push(`/app/crm/tasks${qs ? `?${qs}` : ''}`);
  }

  function ariaSort(column: SortColumn): 'ascending' | 'descending' | undefined {
    if (filter.sort === column) return 'ascending';
    if (filter.sort === `-${column}`) return 'descending';
    return undefined;
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

  async function bulk(action: 'complete' | 'reopen' | 'delete') {
    setBulkBusy(true);
    const res = await fetch('/api/crm/tasks/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, ids: [...selected] }),
    }).catch(() => null);
    setBulkBusy(false);
    setConfirmingDelete(false);
    const data = (await res?.json().catch(() => null)) as { count?: number; failed?: number } | null;
    if (!res?.ok) {
      setBulkNotice(t('errors.generic'));
      return;
    }
    const count = data?.count ?? 0;
    const failed = data?.failed ?? 0;
    setSelected(new Set());
    setBulkNotice(failed ? t('bulkEdit.partial', { count, failed }) : t('bulkEdit.done', { count }));
    router.refresh();
  }

  useKeyShortcut('c', () => setShowComposer(true), !showComposer);
  useKeyShortcut('q', () => router.push('/app/crm/tasks/queue'), !showComposer);

  async function onSubmit(e?: FormEvent) {
    e?.preventDefault();
    setComposerError(null);
    if (!subject.trim()) {
      setComposerError(t('errors.missing_name'));
      return;
    }
    setComposerBusy(true);
    const dueAt = localToUtc(due);
    const reminderAt = reminderFromDue(dueAt, reminder);
    const res = await fetch('/api/crm/activities', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'task',
        ...(type !== 'task' ? { taskKind: type } : {}),
        subject: subject.trim(),
        dueAt,
        ...(contactId ? { contactId } : {}),
        ...(projectIdDraft ? { projectId: projectIdDraft } : {}),
        ...(ownerIdDraft ? { ownerId: ownerIdDraft } : {}),
        ...(queueIdDraft ? { queueId: queueIdDraft } : {}),
        ...(reminderAt ? { reminderAt } : {}),
        ...(repeat !== 'none' ? { repeat } : {}),
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
      setProjectIdDraft(filter.projectId ?? '');
      setOwnerIdDraft('');
      setQueueIdDraft(defaultQueue);
      setReminder('none');
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

  const kindLabel = (k: string) => (k === 'todo' ? t('tasks.kind.todo') : taskTypeLabel(k));

  // Columnas como en HubSpot: la tabla las muestra en el orden elegido y la vista las guarda.
  const columnDefs: ColumnDef[] = [
    { id: 'subject', label: t('tasks.table.title') },
    { id: 'type', label: t('tasks.table.type') },
    { id: 'priority', label: t('tasks.table.priority') },
    { id: 'associated', label: t('tasks.table.associated') },
    { id: 'due', label: t('tasks.table.due') },
    { id: 'queue', label: t('tasks.queues.label') },
    { id: 'owner', label: t('tasks.table.owner') },
    { id: 'project', label: t('tasks.form.project'), defaultVisible: false },
    { id: 'reminder', label: t('tasks.form.reminder'), defaultVisible: false },
    { id: 'created', label: t('tasks.table.created'), defaultVisible: false },
  ];
  const cols = useTableColumns({
    entity: 'tasks',
    columns: columnDefs,
    storageKey: 'zs-tasks-columns',
    first: 'subject',
    viewCols: state.cols,
    viewFreeze: state.freeze === '1' ? true : undefined,
  });

  const bulkFields: BulkEditField[] = [
    { key: 'ownerId', label: t('tasks.form.owner'), type: 'select', options: members, nullable: true },
    {
      key: 'priority',
      label: t('tasks.form.priority'),
      type: 'select',
      options: (['low', 'medium', 'high'] as const).map((v) => ({ value: v, label: t(`tasks.priority.${v}`) })),
      nullable: true,
    },
    { key: 'dueDate', label: t('tasks.form.dueAt'), type: 'date', nullable: true },
    { key: 'taskKind', label: t('tasks.table.type'), type: 'select', options: TASK_INDEX_KINDS.map((k) => ({ value: k, label: kindLabel(k) })) },
    ...(queues.length ? [{ key: 'queueId', label: t('tasks.queues.label'), type: 'select' as const, options: queues, nullable: true }] : []),
    ...(projects.length
      ? [{ key: 'projectId', label: t('tasks.form.project'), type: 'select' as const, options: projects.map((p) => ({ value: p.value, label: p.label })), nullable: true }]
      : []),
  ];

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const hasFilters = !!(filter.kind || filter.priority || filter.owner || filter.queueId || filter.projectId || filter.q);
  const canStartView = total > 0 && filter.bucket !== 'done';

  const sortHead = (column: SortColumn, label: string, card?: string) => {
    const dir = ariaSort(column);
    return (
      <th aria-sort={dir} data-card={card}>
        <button
          type="button"
          className="th-sort"
          onClick={() => go({ sort: filter.sort === column ? `-${column}` : column })}
          data-testid={`task-sort-${column}`}
        >
          {label}
          {dir && (
            <span aria-hidden className="th-sort-mark">
              {dir === 'ascending' ? '↑' : '↓'}
            </span>
          )}
        </button>
      </th>
    );
  };

  const empty = <span className="cell-empty">—</span>;

  function bodyCell(id: string, row: TaskRow): ReactNode {
    switch (id) {
      case 'subject':
        return (
          <td data-card="main" className="cell-task-title">
            <span className="task-title-wrap">
              <button
                type="button"
                className={`task-check${row.done ? ' checked' : ''}`}
                aria-label={row.done ? t('tasks.reopen') : t('tasks.complete')}
                title={row.done ? t('tasks.reopen') : t('tasks.complete')}
                onClick={() => setDone(row.id, !row.done)}
              >
                <CrmIcon name="check" />
              </button>
              <Link
                href={`/app/crm/tasks/${row.id}`}
                className={`task-subject${row.chatPrivate ? ' crm-private-task' : ''}`}
                title={row.chatPrivate ? t('tasks.privateChatHint') : undefined}
                data-testid={row.chatPrivate ? 'crm-private-chat-task' : undefined}
              >
                {row.subject}
              </Link>
            </span>
            {((row.projectName && !cols.visible.has('project')) || row.source || row.repeat || (row.reminder && !cols.visible.has('reminder'))) && (
              <span className="task-title-sub">
                {row.projectName && !cols.visible.has('project') && (
                  <span className="task-project-chip" style={{ '--project-color': row.projectColor ?? '#666' } as React.CSSProperties}>
                    {row.projectName}
                  </span>
                )}
                {row.source && (
                  <Link href={row.source.href} className="cell-email muted task-source" title={row.source.label}>
                    {t(`tasks.links.app.${row.source.app}`)}
                    {row.source.label ? ` · ${row.source.label}` : ''}
                  </Link>
                )}
                {row.repeat && <span className="muted task-repeat">{t(`tasks.repeat.${row.repeat}`)}</span>}
                {row.reminder && !cols.visible.has('reminder') && (
                  <span className="muted task-reminder" data-testid="task-reminder-label">
                    {t('tasks.reminderAt', { when: row.reminder })}
                  </span>
                )}
              </span>
            )}
          </td>
        );
      case 'type':
        return (
          <td>
            <span className="task-type muted">{taskTypeLabel(row.type)}</span>
          </td>
        );
      case 'priority':
        return (
          <td>
            {row.priority ? (
              <span className={`muted task-priority${row.priority === 'high' ? ' task-priority-high' : ''}`}>{t(`tasks.priority.${row.priority}`)}</span>
            ) : (
              empty
            )}
          </td>
        );
      case 'associated':
        return (
          <td>
            {row.record?.name ? (
              <Link href={row.record.href} className="cell-email muted">
                {row.record.name}
              </Link>
            ) : (
              empty
            )}
          </td>
        );
      case 'due':
        return (
          <td className="num cell-date">
            {row.due ? (
              <span className={`task-due${row.overdue ? ' is-overdue' : ''}`} title={row.dueRel ?? undefined}>
                {row.due}
              </span>
            ) : (
              <span className="muted">{t('tasks.noDue')}</span>
            )}
          </td>
        );
      case 'queue':
        return <td>{row.queueName ? <span className="muted task-queue">{row.queueName}</span> : empty}</td>;
      case 'owner':
        return <td>{row.ownerName ? <span className="muted task-owner">{row.ownerName}</span> : empty}</td>;
      case 'project':
        return (
          <td>
            {row.projectName ? (
              <span className="task-project-chip" style={{ '--project-color': row.projectColor ?? '#666' } as React.CSSProperties}>
                {row.projectName}
              </span>
            ) : (
              empty
            )}
          </td>
        );
      case 'reminder':
        return (
          <td className="num cell-date">
            {row.reminder ? (
              <span className="muted task-reminder" data-testid="task-reminder-label">
                {row.reminder}
              </span>
            ) : (
              empty
            )}
          </td>
        );
      case 'created':
        return <td className="num muted cell-date">{row.created ?? ''}</td>;
      default:
        return null;
    }
  }

  return (
    <>
      <PageHeader
        title={title}
        actions={
          <>
            {children}
            <Link href="/app/crm/tasks/queue" className="btn btn-sm" data-testid="start-queue">
              {t('queue.start', { count: queueCount ?? 0 })}
              <kbd className="kbd" aria-hidden>
                Q
              </kbd>
            </Link>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowComposer(true)} data-testid="crm-quick-task">
              {t('record.createTask')}
              <kbd className="kbd" aria-hidden>
                C
              </kbd>
            </button>
          </>
        }
      />
      {tabs}

      <div className="task-toolbar" data-testid="task-toolbar">
        <form
          className="task-search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            go({ q: search.trim() || undefined });
          }}
        >
          <input
            className="input"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('tasks.searchPlaceholder')}
            aria-label={t('tasks.searchPlaceholder')}
            maxLength={200}
            data-testid="task-search"
          />
        </form>
        <div className="task-filters">
          <select
            className="select filter-select"
            value={filter.kind ?? ''}
            onChange={(e) => go({ type: e.target.value || undefined })}
            aria-label={t('tasks.filterType')}
            data-testid="task-filter-type"
          >
            <option value="">{t('tasks.filterType')}</option>
            {TASK_INDEX_KINDS.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k)}
              </option>
            ))}
          </select>
          <select
            className="select filter-select"
            value={filter.priority ?? ''}
            onChange={(e) => go({ priority: e.target.value || undefined })}
            aria-label={t('tasks.filterPriority')}
            data-testid="task-filter-priority"
          >
            <option value="">{t('tasks.filterPriority')}</option>
            {TASK_INDEX_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {t(`tasks.priority.${p}`)}
              </option>
            ))}
          </select>
          <select
            className="select filter-select"
            value={filter.owner ?? ''}
            onChange={(e) => go({ owner: e.target.value || undefined })}
            aria-label={t('tasks.filterOwner')}
            data-testid="task-filter-owner"
          >
            <option value="">{t('tasks.filterOwner')}</option>
            <option value="me">{t('tasks.ownerMe')}</option>
            <option value="unassigned">{t('tasks.ownerUnassigned')}</option>
            {members.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          {queues.length > 0 && (
            <select
              className="select filter-select"
              value={filter.queueId ?? ''}
              onChange={(e) => go({ queue: e.target.value || undefined })}
              aria-label={t('tasks.queues.filter')}
              data-testid="task-filter-queue"
            >
              <option value="">{t('tasks.queues.filter')}</option>
              {queues.map((q) => (
                <option key={q.value} value={q.value}>
                  {q.label}
                </option>
              ))}
            </select>
          )}
          {projects.length > 0 && (
            <select
              className="select filter-select"
              value={filter.projectId ?? ''}
              onChange={(e) => go({ project: e.target.value || undefined })}
              aria-label={t('tasks.filterProject')}
            >
              <option value="">{t('tasks.filterProject')}</option>
              {projects.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          )}
          {hasFilters && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => go({ type: undefined, priority: undefined, owner: undefined, queue: undefined, project: undefined, q: undefined })}
              data-testid="task-filters-clear"
            >
              {t('common.clear')}
            </button>
          )}
        </div>
        <EditColumns columns={columnDefs} first="subject" order={cols.order} freeze={cols.freeze} onApply={cols.apply} onReset={cols.reset} />
        {canStartView && (
          <Link href={viewQueueHref} className="btn btn-secondary btn-sm task-start-view" data-testid="start-view-queue">
            {t('tasks.startView', { count: total })}
          </Link>
        )}
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
              {(['task', 'call', 'email'] as const).map((v) => (
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
          <label className="qm-field">
            <span>{t('tasks.form.reminder')}</span>
            <select
              value={reminder}
              onChange={(e) => setReminder(e.target.value as ReminderOffset)}
              disabled={!due}
              title={due ? undefined : t('tasks.reminderNeedsDue')}
              data-testid="task-reminder"
            >
              {REMINDER_OFFSETS.map((v) => (
                <option key={v} value={v}>
                  {t(`tasks.reminder.${v}`)}
                </option>
              ))}
            </select>
          </label>
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
          {queues.length > 0 && (
            <label className="qm-field">
              <span>{t('tasks.queues.label')}</span>
              <select value={queueIdDraft} onChange={(e) => setQueueIdDraft(e.target.value)} data-testid="task-composer-queue">
                <option value="">—</option>
                {queues.map((q) => (
                  <option key={q.value} value={q.value}>
                    {q.label}
                  </option>
                ))}
              </select>
            </label>
          )}
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
        </div>
      </QuickModal>

      {rows.length === 0 ? (
        <EmptyState
          title={hasFilters ? t('tasks.emptyFiltered') : t(`record.empty.tasks.${filter.bucket}`)}
          body={hasFilters ? t('tasks.emptyFilteredBody') : t('record.empty.tasksBody')}
          action={
            filter.bucket === 'done' ? undefined : (
              <button type="button" className="btn btn-primary" onClick={() => setShowComposer(true)}>
                {t('record.createTask')}
              </button>
            )
          }
        />
      ) : (
        <>
          <div className="table-wrap">
            <table className={`table crm-table crm-cards task-table${cols.freeze ? ' is-frozen' : ''}`} data-testid="task-table">
              <thead>
                <tr>
                  <th className="cell-check" data-card="check">
                    <input
                      type="checkbox"
                      className="row-check"
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                      aria-label={t('common.all')}
                      data-testid="task-select-all"
                    />
                  </th>
                  {cols.order.map((id) => (
                    <Fragment key={id}>
                      {id === 'subject'
                        ? sortHead('subject', t('tasks.table.title'), 'main')
                        : id === 'priority'
                          ? sortHead('priority', t('tasks.table.priority'))
                          : id === 'due'
                            ? sortHead('due', t('tasks.table.due'))
                            : <th>{columnDefs.find((c) => c.id === id)?.label}</th>}
                    </Fragment>
                  ))}
                  <th className="cell-actions-head">
                    <span className="sr-only">{t('deals.table.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className={`task-row${row.done ? ' done' : ''}${row.pinned ? ' pinned' : ''}${busyId === row.id || (bulkBusy && selected.has(row.id)) ? ' row-busy' : ''}`}
                    data-testid="crm-task-row"
                    data-task-id={row.id}
                    data-chat-private={row.chatPrivate ? 'true' : undefined}
                  >
                    <td className="cell-check" data-card="check">
                      <input
                        type="checkbox"
                        className="row-check"
                        checked={selected.has(row.id)}
                        onChange={() =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (next.has(row.id)) next.delete(row.id);
                            else next.add(row.id);
                            return next;
                          })
                        }
                        // Sin el título en el nombre: es texto libre y chocaría con las etiquetas del formulario.
                        aria-label={t('tasks.selectTask')}
                        data-testid="task-select"
                      />
                    </td>
                    {cols.order.map((id) => (
                      <Fragment key={id}>{bodyCell(id, row)}</Fragment>
                    ))}
                    <td className="cell-actions" data-card="state">
                      <span className="task-actions">
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
                      </span>
                    </td>
                    {/* Teléfono: una línea con lo que en la tabla son columnas. */}
                    <td className="cell-task-card" data-card="line">
                      <span className="task-card-meta">
                        {[
                          taskTypeLabel(row.type),
                          row.due ?? t('tasks.noDue'),
                          row.priority ? t(`tasks.priority.${row.priority}`) : '',
                          row.record?.name ?? '',
                          row.queueName ?? '',
                          row.ownerName ?? '',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pager}
        </>
      )}

      {selected.size > 0 && (
        <div className="bulk-bar" role="toolbar" aria-label={t('tasks.bulkLabel')} data-testid="task-bulk-bar">
          <span className="bulk-count">{t('tasks.bulkSelected', { count: selected.size })}</span>
          <BulkEditControls
            endpoint="/api/crm/tasks/bulk"
            ids={[...selected]}
            fields={bulkFields}
            disabled={bulkBusy}
            onDone={(notice) => {
              setSelected(new Set());
              setBulkNotice(notice);
            }}
          />
          {filter.bucket === 'done' ? (
            <button type="button" className="bulk-btn" disabled={bulkBusy} onClick={() => bulk('reopen')} data-testid="task-bulk-reopen">
              {t('tasks.reopen')}
            </button>
          ) : (
            <button type="button" className="bulk-btn" disabled={bulkBusy} onClick={() => bulk('complete')} data-testid="task-bulk-complete">
              {t('tasks.complete')}
            </button>
          )}
          {confirmingDelete ? (
            <>
              <span className="bulk-count">{t('tasks.bulkConfirmDelete', { count: selected.size })}</span>
              <button type="button" className="bulk-btn danger" disabled={bulkBusy} onClick={() => bulk('delete')} data-testid="task-bulk-delete-confirm">
                {t('common.yes')}
              </button>
              <button type="button" className="bulk-btn" disabled={bulkBusy} onClick={() => setConfirmingDelete(false)}>
                {t('common.no')}
              </button>
            </>
          ) : (
            <button type="button" className="bulk-btn danger" disabled={bulkBusy} onClick={() => setConfirmingDelete(true)} data-testid="task-bulk-delete">
              {t('contacts.bulk.delete')}
            </button>
          )}
          <button
            type="button"
            className="bulk-btn"
            disabled={bulkBusy}
            onClick={() => {
              setSelected(new Set());
              setConfirmingDelete(false);
            }}
          >
            {t('contacts.bulk.clear')}
          </button>
        </div>
      )}

      {bulkNotice && selected.size === 0 && (
        <p className="muted bulk-notice" role="status" data-testid="task-bulk-notice">
          {bulkNotice}
        </p>
      )}
    </>
  );
}
