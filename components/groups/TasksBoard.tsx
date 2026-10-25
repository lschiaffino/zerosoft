'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import type { GroupsPerson } from '@/lib/groups';
import type { GroupTaskDto } from '@/lib/groups-tasks';
import { TASKS_CHANGED, isoToLocal, localToIso } from './TaskModal';
import { Modal, api, useErrorText, useToast } from './ui';

const STATUSES = ['open', 'done', 'all'] as const;

/** Tareas de los chats: pendientes por hora, tildar, editar, borrar y abrir el mensaje. */
export default function TasksBoard({ initial, people, me, openId = null }: { initial: GroupTaskDto[]; people: GroupsPerson[]; me: string; openId?: string | null }) {
  const t = useTranslations('groups');
  const locale = useLocale();
  const errText = useErrorText();
  const [toast, showToast] = useToast();
  const [tasks, setTasks] = useState<GroupTaskDto[] | null>(initial);
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('open');
  const [owner, setOwner] = useState('');
  const [q, setQ] = useState('');
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState<GroupTaskDto | null>(() => initial.find((x) => x.id === openId) ?? null);
  const [removing, setRemoving] = useState<GroupTaskDto | null>(null);
  const first = useRef(true);

  const load = useCallback(async () => {
    const p = new URLSearchParams({ status });
    if (owner) p.set('owner', owner);
    if (q.trim()) p.set('q', q.trim());
    const r = await api<{ tasks: GroupTaskDto[] }>(`/api/groups/tasks?${p}`);
    if (r.data) {
      setTasks(r.data.tasks);
      setError(false);
    } else setError(true);
  }, [status, owner, q]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const id = setTimeout(() => void load(), 200);
    return () => clearTimeout(id);
  }, [load]);
  useEffect(() => {
    window.addEventListener(TASKS_CHANGED, load);
    return () => window.removeEventListener(TASKS_CHANGED, load);
  }, [load]);

  async function patch(task: GroupTaskDto, body: Record<string, unknown>) {
    // Tildar o cambiar de persona se ve en el momento; si falla, vuelve atrás.
    const optimistic: Partial<GroupTaskDto> = {};
    if (typeof body.done === 'boolean') optimistic.done = body.done;
    if (typeof body.ownerId === 'string') optimistic.ownerId = body.ownerId;
    if (Object.keys(optimistic).length) setTasks((list) => (list ?? []).map((x) => (x.id === task.id ? { ...x, ...optimistic } : x)));
    const r = await api<GroupTaskDto>(`/api/groups/tasks/${task.id}`, { method: 'PATCH', body });
    if (!r.data) {
      setTasks((list) => (list ?? []).map((x) => (x.id === task.id ? task : x)));
      showToast(errText(r.error), true);
      return null;
    }
    setTasks((list) => (list ?? []).map((x) => (x.id === task.id ? (r.data as GroupTaskDto) : x)));
    return r.data;
  }

  async function remove() {
    if (!removing) return;
    const r = await api(`/api/groups/tasks/${removing.id}`, { method: 'DELETE' });
    const id = removing.id;
    setRemoving(null);
    if (!r.data) return showToast(errText(r.error), true);
    setTasks((list) => (list ?? []).filter((x) => x.id !== id));
  }

  const now = Date.now();
  return (
    <>
      <div className="gr-toolbar">
        <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('tasks.search')} aria-label={t('tasks.search')} />
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value as (typeof STATUSES)[number])} aria-label={t('tasks.status')}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`tasks.filter.${s}`)}
            </option>
          ))}
        </select>
        <select className="select" value={owner} onChange={(e) => setOwner(e.target.value)} aria-label={t('tasks.owner')}>
          <option value="">{t('tickets.anyone')}</option>
          <option value="me">{t('tickets.mine')}</option>
          {people
            .filter((p) => p.id !== me)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || p.email}
              </option>
            ))}
        </select>
        <span className="gr-toolbar-spacer" />
        <Link href="/app/crm/tasks" className="btn btn-secondary">
          {t('tasks.inCrm')}
        </Link>
      </div>
      {error && (
        <div className="gr-error" role="alert">
          {t('tasks.loadError')}
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load()}>
            {t('common.retry')}
          </button>
        </div>
      )}
      {tasks === null ? (
        <div className="ui-skeleton ui-skeleton-block" aria-busy="true" aria-label={t('common.loading')} />
      ) : tasks.length === 0 ? (
        <EmptyState
          quiet
          title={q || owner || status !== 'open' ? t('tasks.noResults') : t('tasks.emptyTitle')}
          body={q || owner || status !== 'open' ? undefined : t('tasks.emptyBody')}
          action={q || owner || status !== 'open' ? undefined : { label: t('tasks.goInbox'), href: '/app/groups/inbox' }}
          product="groups"
        />
      ) : (
        <div className="table-wrap">
          <table className="table gr-table gr-tasks-table">
            <thead>
              <tr>
                <th className="gr-check-col">
                  <span className="sr-only">{t('tasks.done')}</span>
                </th>
                <th>{t('tasks.title')}</th>
                <th>{t('tasks.remindAt')}</th>
                <th className="gr-hide-sm">{t('tasks.owner')}</th>
                <th className="gr-hide-sm">
                  <span className="sr-only">{t('tasks.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => {
                const overdue = !task.done && task.dueAt && Date.parse(task.dueAt) < now;
                return (
                  <tr key={task.id} className={task.done ? 'is-done' : undefined}>
                    <td className="gr-check-col">
                      <input type="checkbox" className="ui-check" checked={task.done} onChange={() => void patch(task, { done: !task.done })} aria-label={t('tasks.markDone', { title: task.title })} />
                    </td>
                    <td>
                      <div className="gr-ticket-title">
                        <button type="button" className="gr-link-button" onClick={() => setEditing(task)}>
                          {task.title}
                        </button>
                        <span className="ui-help">
                          <Link href={`/app/groups/inbox/${task.chatId}${task.messageId ? `#m-${task.messageId}` : ''}`}>{task.chatName}</Link>
                          {task.messageBody ? ` · ${task.messageBody.slice(0, 80)}` : ''}
                        </span>
                      </div>
                    </td>
                    <td>
                      {task.dueAt ? (
                        <span className={overdue ? 'badge badge-bad' : 'ui-help'}>
                          {new Date(task.dueAt).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })}
                        </span>
                      ) : (
                        <span className="ui-help">{t('tasks.noDate')}</span>
                      )}
                    </td>
                    <td className="gr-hide-sm">
                      <select className="select" value={task.ownerId ?? ''} onChange={(e) => void patch(task, { ownerId: e.target.value || null })} aria-label={t('tasks.owner')}>
                        {people.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.id === me ? t('tickets.me', { name: p.name || p.email }) : p.name || p.email}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="gr-hide-sm num">
                      <button type="button" className="btn btn-ghost btn-sm gr-danger" onClick={() => setRemoving(task)}>
                        {t('common.delete')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <EditTaskModal
        task={editing}
        onClose={() => setEditing(null)}
        onSave={async (body) => {
          if (!editing) return;
          const r = await patch(editing, body);
          if (r) {
            setEditing(null);
            showToast(t('common.saved'));
          }
        }}
        onDelete={() => {
          setRemoving(editing);
          setEditing(null);
        }}
      />
      <ConfirmDialog
        open={!!removing}
        title={t('tasks.deleteTitle', { title: removing?.title ?? '' })}
        body={t('tasks.deleteBody')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
      {toast}
    </>
  );
}

function EditTaskModal({
  task,
  onClose,
  onSave,
  onDelete,
}: {
  task: GroupTaskDto | null;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => Promise<void>;
  onDelete: () => void;
}) {
  const t = useTranslations('groups');
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setDue(isoToLocal(task.dueAt));
    setNotes(task.notes);
  }, [task]);
  return (
    <Modal
      open={!!task}
      title={t('tasks.editTitle')}
      onClose={onClose}
      busy={busy}
      onSubmit={async () => {
        setBusy(true);
        await onSave({ title, dueAt: localToIso(due), notes });
        setBusy(false);
      }}
      foot={
        <>
          <button type="button" className="btn btn-ghost gr-danger" onClick={onDelete}>
            {t('common.delete')}
          </button>
          <span className="gr-toolbar-spacer" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!title.trim()} aria-busy={busy || undefined}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="ui-fields">
        <label className="ui-field">
          <span className="label">{t('tasks.title')}</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus required />
        </label>
        <label className="ui-field">
          <span className="label">{t('tasks.remindAt')}</span>
          <input className="input" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <label className="ui-field">
          <span className="label">{t('tasks.notes')}</span>
          <textarea className="textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} />
        </label>
      </div>
    </Modal>
  );
}
