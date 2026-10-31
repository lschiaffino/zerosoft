'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { DocsTodoAccessory } from '@/components/docs/DocsTodoAccessory';
import type { DocsBlock } from '@/lib/docs-types';
import { groupTasks, localToday, TASK_GROUPS, type NoteTask, type NoteTaskMeta } from '@/lib/notes-tasks-shared';
import NotesIcon from './NotesIcon';
import { usePopover } from './usePopover';

interface Candidate {
  id: string;
  name: string;
}

async function patchTask(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  // 409: el todo todavía no se guardó (no se puede asignar).
  const res = await fetch('/api/notes/tasks', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (res?.status === 409) return { notSaved: true };
  return res?.ok ? ((await res.json()) as Record<string, unknown>) : null;
}

/** Fecha corta, leída como día (sin correrse por zona horaria). */
function useDueLabel() {
  const format = useFormatter();
  return useCallback((due: string) => format.dateTime(new Date(`${due}T12:00:00`), { month: 'short', day: 'numeric' }), [format]);
}

/** Chip de fecha y responsable al lado de un todo del editor. */
function TaskChip({
  noteId,
  block,
  meta,
  candidates,
  onChange,
  onError,
}: {
  noteId: string;
  block: DocsBlock;
  meta: NoteTaskMeta | undefined;
  candidates: Candidate[];
  onChange: (blockId: string, m: NoteTaskMeta) => void;
  onError: (msg?: string) => void;
}) {
  const t = useTranslations('notes.tasks');
  const dueLabel = useDueLabel();
  const pop = usePopover();
  const [busy, setBusy] = useState(false);
  const today = localToday();
  const overdue = Boolean(meta?.due && meta.due < today && !block.checked);

  async function save(patch: { due?: string | null; assignee_id?: string | null }) {
    setBusy(true);
    const res = await patchTask({ note_id: noteId, block_id: block.id, ...patch });
    setBusy(false);
    if (!res) onError();
    else if (res.notSaved) onError(t('notSaved'));
    else onChange(block.id, res as unknown as NoteTaskMeta);
  }

  return (
    <span className="note-task-chip-wrap" contentEditable={false} ref={pop.wrapRef}>
      <button
        ref={pop.buttonRef}
        type="button"
        className={`note-task-chip${meta?.due || meta?.assignee_id ? ' is-set' : ''}${overdue ? ' is-overdue' : ''}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={pop.toggle}
        aria-expanded={pop.open}
        aria-haspopup="dialog"
        aria-label={t('setDue')}
        title={t('setDue')}
      >
        <NotesIcon name="clock" size={12} />
        {meta?.due && <span className="num">{dueLabel(meta.due)}</span>}
        {meta?.assignee_name && <span className="note-task-chip-who">{meta.assignee_name}</span>}
      </button>
      {pop.open && (
        <div className="notes-pop note-task-pop" role="dialog" aria-label={t('setDue')}>
          <label className="ui-field">
            <span className="label">{t('due')}</span>
            <input
              type="date"
              className="input"
              value={meta?.due ?? ''}
              disabled={busy}
              onChange={(e) => void save({ due: e.target.value || null })}
            />
          </label>
          <label className="ui-field">
            <span className="label">{t('assignee')}</span>
            <select className="select" value={meta?.assignee_id ?? ''} disabled={busy} onChange={(e) => void save({ assignee_id: e.target.value || null })}>
              <option value="">{t('nobody')}</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <p className="notes-pop-hint">{t('assignHint')}</p>
        </div>
      )}
    </span>
  );
}

/**
 * Da a los todos de la nota su chip de fecha. En un todo recién escrito la fecha
 * se guarda igual; asignar espera a que el bloque llegue al servidor.
 */
export function NoteTasksProvider({ noteId, children, onError }: { noteId: string; children: ReactNode; onError: (msg?: string) => void }) {
  const [meta, setMeta] = useState<Record<string, NoteTaskMeta>>({});
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  useEffect(() => {
    let live = true;
    void fetch(`/api/notes/${encodeURIComponent(noteId)}/tasks`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { meta: Record<string, NoteTaskMeta>; candidates: Candidate[] } | null) => {
        if (live && d) {
          setMeta(d.meta);
          setCandidates(d.candidates);
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [noteId]);
  const render = useCallback(
    (block: DocsBlock) => (
      <TaskChip
        noteId={noteId}
        block={block}
        meta={meta[block.id]}
        candidates={candidates}
        onChange={(id, m) => setMeta((cur) => ({ ...cur, [id]: m }))}
        onError={onError}
      />
    ),
    [noteId, meta, candidates, onError],
  );
  return <DocsTodoAccessory.Provider value={render}>{children}</DocsTodoAccessory.Provider>;
}

/** Vista de tareas: todas las de mis notas y las que me asignaron, por vencimiento. */
export function NotesTasksList({
  onOpen,
  onChanged,
  activeNoteId,
}: {
  onOpen: (noteId: string) => void;
  /** Se marcó un todo de esta nota: si está abierta, hay que recargarla. */
  onChanged: (noteId: string) => void;
  activeNoteId: string | null;
}) {
  const t = useTranslations('notes.tasks');
  const dueLabel = useDueLabel();
  const [tasks, setTasks] = useState<NoteTask[] | null>(null);
  const [error, setError] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const load = useCallback(async () => {
    setError(false);
    const res = await fetch('/api/notes/tasks').catch(() => null);
    if (!res?.ok) {
      setError(true);
      return;
    }
    setTasks(((await res.json()) as { tasks: NoteTask[] }).tasks);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const today = localToday();
  const groups = useMemo(() => groupTasks(tasks ?? [], today), [tasks, today]);

  async function toggle(task: NoteTask) {
    const checked = !task.checked;
    setTasks((cur) => cur?.map((x) => (x.note_id === task.note_id && x.block_id === task.block_id ? { ...x, checked } : x)) ?? cur);
    const res = await patchTask({ note_id: task.note_id, block_id: task.block_id, checked });
    if (!res) {
      setError(true);
      void load();
      return;
    }
    onChangedRef.current(task.note_id);
  }

  if (error) {
    return (
      <div className="notes-list-error" role="alert">
        <p>{t('error')}</p>
        <button type="button" className="btn btn-sm" onClick={() => void load()}>
          {t('retry')}
        </button>
      </div>
    );
  }
  if (tasks === null) {
    return (
      <p className="notes-tasks-loading" role="status">
        {t('loading')}
      </p>
    );
  }
  if (tasks.length === 0) {
    return (
      <div className="notes-tasks-empty">
        <p className="notes-tasks-empty-title">{t('emptyTitle')}</p>
        <p>{t('emptyBody')}</p>
      </div>
    );
  }
  return (
    <div className="notes-tasks" data-testid="notes-tasks">
      {TASK_GROUPS.map((key) => {
        const list = groups[key];
        if (!list.length || (key === 'done' && !showDone)) {
          return key === 'done' && list.length > 0 ? (
            <button key={key} type="button" className="btn btn-ghost btn-sm notes-tasks-more" onClick={() => setShowDone(true)}>
              {t('showDone', { count: list.length })}
            </button>
          ) : null;
        }
        return (
          <section key={key} className="notes-tasks-group">
            <h2 className={key === 'overdue' ? 'is-overdue' : undefined}>
              {t(`groups.${key}`)} <span className="num">{list.length}</span>
            </h2>
            <ul>
              {list.map((task) => (
                <li key={`${task.note_id}:${task.block_id}`} className={`notes-task${task.note_id === activeNoteId ? ' is-active' : ''}${task.checked ? ' is-done' : ''}`}>
                  <input type="checkbox" className="docs-check" checked={task.checked} onChange={() => void toggle(task)} aria-label={task.text} />
                  <button type="button" className="notes-task-open" onClick={() => onOpen(task.note_id)}>
                    <span className="notes-task-text">{task.text}</span>
                    <span className="notes-task-meta">
                      {task.due && <span className={`num${key === 'overdue' ? ' is-overdue' : ''}`}>{dueLabel(task.due)}</span>}
                      <span className="notes-task-note">{task.note_title || t('untitled')}</span>
                      {task.assignee_name && <span>{task.assignee_name}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
