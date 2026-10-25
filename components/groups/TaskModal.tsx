'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { GroupsPerson } from '@/lib/groups';
import type { GroupTaskDto } from '@/lib/groups-tasks';
import { Modal, api, useErrorText } from './ui';
import { parseDbUtc } from '@/lib/utils';

/** Evento que avisa que cambió una tarea (la lista del chat y la de Tareas se recargan). */
export const TASKS_CHANGED = 'zs:groups-tasks-changed';

/** "2026-10-24T15:30" (hora local del navegador) → ISO, o null si está vacío. */
export function localToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** ISO → valor de un input datetime-local en la hora del navegador. */
export function isoToLocal(iso: string | null): string {
  if (!iso) return '';
  const d = parseDbUtc(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Atajos de fecha: en 1 hora, mañana a las 9, el lunes a las 9. */
function quickDue(kind: 'hour' | 'tomorrow' | 'monday'): string {
  const d = new Date();
  if (kind === 'hour') d.setTime(d.getTime() + 3_600_000);
  else {
    const add = kind === 'tomorrow' ? 1 : ((8 - d.getDay()) % 7) || 7;
    d.setDate(d.getDate() + add);
    d.setHours(9, 0, 0, 0);
  }
  return isoToLocal(d.toISOString());
}

/**
 * Nueva tarea o recordatorio desde el chat (o desde un mensaje): título,
 * cuándo avisar, para quién y notas. Queda también en CRM › Tareas.
 */
export default function TaskModal({
  open,
  chatId,
  message,
  people,
  me,
  onClose,
  onCreated,
}: {
  open: boolean;
  chatId: string;
  message: { id: string; body: string } | null;
  people: GroupsPerson[];
  me: string;
  onClose: () => void;
  onCreated: (t: GroupTaskDto) => void;
}) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [ownerId, setOwnerId] = useState(me);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setTitle((message?.body.split('\n').find((l) => l.trim()) ?? '').trim().slice(0, 120));
    setDue(quickDue('tomorrow'));
    setOwnerId(me);
    setNotes('');
    setError('');
  }, [open, message, me]);

  async function submit() {
    if (!title.trim()) return;
    setBusy(true);
    setError('');
    const res = await api<GroupTaskDto>('/api/groups/tasks', {
      body: {
        chatId,
        messageId: message?.id ?? null,
        title,
        dueAt: localToIso(due),
        ownerId,
        notes,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    });
    setBusy(false);
    if (!res.data) {
      setError(errText(res.error));
      return;
    }
    window.dispatchEvent(new Event(TASKS_CHANGED));
    onCreated(res.data);
  }

  return (
    <Modal
      open={open}
      title={message ? t('tasks.fromMessage') : t('tasks.newTitle')}
      onClose={onClose}
      onSubmit={() => void submit()}
      busy={busy}
      foot={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!title.trim()} aria-busy={busy || undefined}>
            {t('tasks.create')}
          </button>
        </>
      }
    >
      <div className="ui-fields">
        {message?.body && <p className="gr-quote">{message.body.slice(0, 280)}</p>}
        <label className="ui-field">
          <span className="label">{t('tasks.title')}</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus required />
        </label>
        <label className="ui-field">
          <span className="label">{t('tasks.remindAt')}</span>
          <input className="input" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
          <span className="gr-inline-form">
            {(['hour', 'tomorrow', 'monday'] as const).map((k) => (
              <button key={k} type="button" className="btn btn-ghost btn-sm" onClick={() => setDue(quickDue(k))}>
                {t(`tasks.quick.${k}`)}
              </button>
            ))}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDue('')}>
              {t('tasks.noDate')}
            </button>
          </span>
        </label>
        <label className="ui-field">
          <span className="label">{t('tasks.owner')}</span>
          <select className="select" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id === me ? t('tickets.me', { name: p.name || p.email }) : p.name || p.email}
              </option>
            ))}
          </select>
        </label>
        <label className="ui-field">
          <span className="label">{t('tasks.notes')}</span>
          <textarea className="textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} />
        </label>
        <p className="ui-help">{t('tasks.help')}</p>
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

/** Tareas del chat en el panel de detalles: pendientes con su hora, tildar y nueva. */
export function ChatTasksSection({ chatId, people, me }: { chatId: string; people: GroupsPerson[]; me: string }) {
  const t = useTranslations('groups');
  const locale = useLocale();
  const errText = useErrorText();
  const [tasks, setTasks] = useState<GroupTaskDto[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const r = await api<{ tasks: GroupTaskDto[] }>(`/api/groups/tasks?chat=${chatId}&status=all`);
    if (r.data) {
      setTasks(r.data.tasks);
      setError('');
    } else setError(errText(r.error));
  }, [chatId, errText]);

  useEffect(() => {
    void load();
    window.addEventListener(TASKS_CHANGED, load);
    return () => window.removeEventListener(TASKS_CHANGED, load);
  }, [load]);

  async function toggle(task: GroupTaskDto) {
    setTasks((list) => (list ?? []).map((x) => (x.id === task.id ? { ...x, done: !task.done } : x)));
    const r = await api<GroupTaskDto>(`/api/groups/tasks/${task.id}`, { method: 'PATCH', body: { done: !task.done } });
    if (r.data) setTasks((list) => (list ?? []).map((x) => (x.id === task.id ? (r.data as GroupTaskDto) : x)));
    else {
      setTasks((list) => (list ?? []).map((x) => (x.id === task.id ? task : x)));
      setError(errText(r.error));
    }
  }

  const pending = (tasks ?? []).filter((x) => !x.done);
  const done = (tasks ?? []).filter((x) => x.done).slice(0, 3);

  return (
    <section className="gr-detail-section">
      <div className="gr-detail-head">
        <h3 className="gr-detail-title">{t('tasks.section', { n: pending.length })}</h3>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
          {t('tasks.add')}
        </button>
      </div>
      {error && <p className="ui-error">{error}</p>}
      {tasks === null ? (
        <p className="ui-help">{t('common.loading')}</p>
      ) : tasks.length === 0 ? (
        <p className="ui-help">{t('tasks.chatEmpty')}</p>
      ) : (
        <ul className="gr-task-list">
          {[...pending, ...done].map((task) => (
            <li key={task.id} className={task.done ? 'is-done' : undefined}>
              <input type="checkbox" className="ui-check" checked={task.done} onChange={() => void toggle(task)} aria-label={t('tasks.markDone', { title: task.title })} />
              <span className="gr-task-main">
                <span className="gr-task-title">{task.title}</span>
                <span className="ui-help">
                  {task.dueAt ? parseDbUtc(task.dueAt).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }) : t('tasks.noDate')}
                  {task.ownerName ? ` · ${task.ownerName}` : ''}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <Link href="/app/groups/tasks" className="ui-help">
        {t('tasks.all')}
      </Link>
      <TaskModal open={open} chatId={chatId} message={null} people={people} me={me} onClose={() => setOpen(false)} onCreated={() => setOpen(false)} />
    </section>
  );
}
