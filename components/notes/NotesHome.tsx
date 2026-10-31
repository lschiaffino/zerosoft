'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { DEFAULT_HOME_WIDGETS, HOME_WIDGETS, moveHomeWidget, type HomeWidget } from '@/lib/notes-home';
import { groupTasks, localToday, type NoteTask } from '@/lib/notes-tasks-shared';
import type { NoteSummary, NotebookInfo, SavedSearchInfo, TagInfo } from '@/lib/notes-types';
import type { NoteEvent } from '@/lib/notes-events';
import NotesIcon from './NotesIcon';
import type { NotesFilter } from './notes-ui';

interface Props {
  notebooks: NotebookInfo[];
  tags: TagInfo[];
  searches: SavedSearchInfo[];
  onOpenNote: (id: string) => void;
  onChoose: (f: NotesFilter) => void;
  onPickSearch: (s: SavedSearchInfo) => void;
  onNewNote: (title: string, text: string) => Promise<boolean>;
}

type Fetched = { recent: NoteSummary[] | null; pinned: NoteSummary[] | null; shared: NoteSummary[] | null; tasks: NoteTask[] | null; events: NoteEvent[] | null };

const SCRATCH_DEBOUNCE_MS = 600;
const SCRATCH_DRAFT_KEY = 'zs:notes:scratch-draft';

/** Inicio de Notes: widgets que cada persona elige y ordena, como el Home de Evernote. */
export default function NotesHome({ notebooks, tags, searches, onOpenNote, onChoose, onPickSearch, onNewNote }: Props) {
  const t = useTranslations('notes.home');
  const tRoot = useTranslations('notes');
  const format = useFormatter();
  const locale = useLocale();
  const [widgets, setWidgets] = useState<HomeWidget[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [scratch, setScratch] = useState('');
  const [scratchState, setScratchState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [data, setData] = useState<Fetched>({ recent: null, pinned: null, shared: null, tasks: null, events: null });
  const [error, setError] = useState(false);
  const [busyEvent, setBusyEvent] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setError(false);
    const get = async <T,>(url: string, pick: (d: never) => T): Promise<T | null> => {
      const res = await fetch(url).catch(() => null);
      if (!res?.ok) return null;
      return pick((await res.json()) as never);
    };
    const prefs = await fetch('/api/notes/prefs').catch(() => null);
    if (!prefs?.ok) {
      setError(true);
      return;
    }
    const p = (await prefs.json()) as { home: HomeWidget[]; scratch: string };
    setWidgets(p.home);
    // Una copia que no llegó a guardarse (se cerró la pestaña en el medio) gana y se manda.
    let draft: string | null = null;
    try {
      draft = localStorage.getItem(SCRATCH_DRAFT_KEY);
    } catch {
      // Sin almacenamiento: lo del servidor.
    }
    setScratch(draft ?? p.scratch);
    if (draft !== null && draft !== p.scratch) void persistScratch(draft);
    const [recent, pinned, shared, tasks, events] = await Promise.all([
      get('/api/notes?limit=6&sort=updated', (d: { notes: NoteSummary[] }) => d.notes),
      get('/api/notes?view=pinned&limit=6', (d: { notes: NoteSummary[] }) => d.notes),
      get('/api/notes?view=shared', (d: { notes: NoteSummary[] }) => d.notes.slice(0, 6)),
      get('/api/notes/tasks', (d: { tasks: NoteTask[] }) => d.tasks),
      get('/api/notes/events', (d: { events: NoteEvent[] }) => d.events),
    ]);
    setData({ recent: recent ?? [], pinned: pinned ?? [], shared: shared ?? [], tasks: tasks ?? [], events: events ?? [] });
  }, []);

  // Salir o cerrar dentro de la espera: lo último se manda igual (keepalive).
  const pendingScratch = useRef<string | null>(null);
  useEffect(() => {
    void load();
    const flush = () => {
      if (pendingScratch.current === null) return;
      const value = pendingScratch.current;
      pendingScratch.current = null;
      void fetch('/api/notes/prefs', { method: 'PATCH', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scratch: value }) }).catch(() => undefined);
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHidden);
      if (timer.current) clearTimeout(timer.current);
      flush();
    };
  }, [load]);

  async function saveWidgets(next: HomeWidget[]) {
    setWidgets(next);
    const res = await fetch('/api/notes/prefs', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ home: next }) }).catch(() => null);
    if (!res?.ok) setError(true);
  }

  function changeScratch(value: string) {
    setScratch(value);
    setScratchState('saving');
    pendingScratch.current = value;
    try {
      localStorage.setItem(SCRATCH_DRAFT_KEY, value);
    } catch {
      // Sin almacenamiento: queda el envío al salir.
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void persistScratch(value), SCRATCH_DEBOUNCE_MS);
  }

  async function persistScratch(value: string) {
    pendingScratch.current = null;
    const res = await fetch('/api/notes/prefs', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scratch: value }) }).catch(() => null);
    setScratchState(res?.ok ? 'saved' : 'error');
    if (res?.ok) {
      try {
        localStorage.removeItem(SCRATCH_DRAFT_KEY);
      } catch {
        // Nada que limpiar.
      }
    }
  }

  async function scratchToNote() {
    const text = scratch.trim();
    if (!text) return;
    const first = text.split('\n')[0].slice(0, 120);
    if (await onNewNote(first, text)) {
      if (timer.current) clearTimeout(timer.current);
      setScratch('');
      await persistScratch('');
      setScratchState('idle');
    }
  }

  async function noteFromEvent(ev: NoteEvent) {
    setBusyEvent(ev.id);
    const res = await fetch('/api/notes/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event_id: ev.id, locale, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    }).catch(() => null);
    setBusyEvent(null);
    if (!res?.ok) {
      setError(true);
      return;
    }
    onOpenNote(((await res.json()) as { id: string }).id);
  }

  const noteRows = (list: NoteSummary[] | null, empty: string) =>
    list === null ? (
      <p className="notes-home-hint" role="status">{t('loading')}</p>
    ) : list.length === 0 ? (
      <p className="notes-home-hint">{empty}</p>
    ) : (
      <ul className="notes-home-list">
        {list.map((n) => (
          <li key={n.id}>
            <button type="button" onClick={() => onOpenNote(n.id)}>
              <span className="notes-home-row-title">{n.title || tRoot('untitled')}</span>
              <span className="notes-home-row-meta">{format.dateTime(new Date(n.updated_at), { month: 'short', day: 'numeric' })}</span>
            </button>
          </li>
        ))}
      </ul>
    );

  const today = localToday();
  const body = (w: HomeWidget) => {
    switch (w) {
      case 'scratch':
        return (
          <>
            <textarea
              className="textarea notes-home-scratch"
              rows={5}
              maxLength={20000}
              value={scratch}
              placeholder={t('scratchPlaceholder')}
              aria-label={t('widgets.scratch')}
              onChange={(e) => changeScratch(e.target.value)}
            />
            <div className="notes-home-scratch-foot">
              <span className="notes-home-hint" role="status">
                {scratchState === 'saving' ? t('saving') : scratchState === 'saved' ? t('saved') : scratchState === 'error' ? t('saveError') : ''}
              </span>
              <button type="button" className="btn btn-sm" disabled={!scratch.trim()} onClick={() => void scratchToNote()}>
                {t('scratchToNote')}
              </button>
            </div>
          </>
        );
      case 'tasks': {
        if (data.tasks === null) return <p className="notes-home-hint" role="status">{t('loading')}</p>;
        const g = groupTasks(data.tasks, today);
        const open = [...g.overdue, ...g.today, ...g.upcoming, ...g.noDate].slice(0, 6);
        if (!open.length) return <p className="notes-home-hint">{t('tasksEmpty')}</p>;
        return (
          <ul className="notes-home-list">
            {open.map((task) => (
              <li key={`${task.note_id}:${task.block_id}`}>
                <button type="button" onClick={() => onOpenNote(task.note_id)}>
                  <span className="notes-home-row-title">{task.text}</span>
                  {task.due && (
                    <span className={`notes-home-row-meta${task.due < today ? ' is-overdue' : ''}`}>
                      {format.dateTime(new Date(`${task.due}T12:00:00`), { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        );
      }
      case 'recent':
        return noteRows(data.recent, t('recentEmpty'));
      case 'pinned':
        return noteRows(data.pinned, t('pinnedEmpty'));
      case 'shared':
        return noteRows(data.shared, t('sharedEmpty'));
      case 'events':
        if (data.events === null) return <p className="notes-home-hint" role="status">{t('loading')}</p>;
        if (!data.events.length) return <p className="notes-home-hint">{t('eventsEmpty')}</p>;
        return (
          <ul className="notes-home-list">
            {data.events.slice(0, 6).map((ev) => (
              <li key={ev.id}>
                <button type="button" aria-busy={busyEvent === ev.id} disabled={busyEvent !== null} onClick={() => void noteFromEvent(ev)} title={t('eventNoteAction')}>
                  <span className="notes-home-row-title">{ev.attendee ? `${ev.title}: ${ev.attendee}` : ev.title}</span>
                  <span className="notes-home-row-meta">{format.dateTime(new Date(ev.start), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                </button>
              </li>
            ))}
          </ul>
        );
      case 'notebooks':
        if (!notebooks.length) return <p className="notes-home-hint">{t('notebooksEmpty')}</p>;
        return (
          <ul className="notes-home-list">
            {notebooks.slice(0, 8).map((nb) => (
              <li key={nb.id}>
                <button type="button" onClick={() => onChoose({ kind: 'notebook', id: nb.id })}>
                  <span className="notes-home-row-title">{nb.name}</span>
                  <span className="notes-home-row-meta num">{nb.count}</span>
                </button>
              </li>
            ))}
          </ul>
        );
      case 'tags':
        if (!tags.length) return <p className="notes-home-hint">{t('tagsEmpty')}</p>;
        return (
          <ul className="notes-home-list">
            {tags.slice(0, 8).map((tg) => (
              <li key={tg.tag}>
                <button type="button" onClick={() => onChoose({ kind: 'tag', tag: tg.tag })}>
                  <span className="notes-home-row-title">#{tg.tag}</span>
                  <span className="notes-home-row-meta num">{tg.count}</span>
                </button>
              </li>
            ))}
          </ul>
        );
      case 'searches':
        if (!searches.length) return <p className="notes-home-hint">{t('searchesEmpty')}</p>;
        return (
          <ul className="notes-home-list">
            {searches.slice(0, 8).map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => onPickSearch(s)}>
                  <span className="notes-home-row-title">{s.name}</span>
                </button>
              </li>
            ))}
          </ul>
        );
    }
  };

  const shown = widgets ?? [...DEFAULT_HOME_WIDGETS];
  const hidden = HOME_WIDGETS.filter((w) => !shown.includes(w));

  return (
    <div className="notes-home">
      <div className="notes-home-head">
        <h1>{t('title')}</h1>
        <button type="button" className="btn btn-sm" aria-pressed={editing} onClick={() => setEditing((v) => !v)}>
          {editing ? t('done') : t('customize')}
        </button>
      </div>
      {error && (
        <div className="notes-list-error" role="alert">
          <p>{t('error')}</p>
          <button type="button" className="btn btn-sm" onClick={() => void load()}>
            {t('retry')}
          </button>
        </div>
      )}
      {editing && hidden.length > 0 && (
        <div className="notes-home-add">
          <span className="label">{t('addWidget')}</span>
          {hidden.map((w) => (
            <button key={w} type="button" className="btn btn-sm" onClick={() => void saveWidgets([...shown, w])}>
              <NotesIcon name="plus" size={12} />
              {t(`widgets.${w}`)}
            </button>
          ))}
        </div>
      )}
      {widgets !== null && shown.length === 0 && !editing && <p className="notes-home-hint">{t('noWidgets')}</p>}
      <div className="notes-home-grid">
        {shown.map((w) => (
          <section key={w} className="notes-home-card" data-widget={w} aria-label={t(`widgets.${w}`)}>
            <header>
              <h2>{t(`widgets.${w}`)}</h2>
              {editing && (
                <div className="notes-home-card-tools">
                  <button type="button" className="btn btn-ghost btn-sm" aria-label={t('moveUp', { name: t(`widgets.${w}`) })} disabled={shown[0] === w} onClick={() => void saveWidgets(moveHomeWidget(shown, w, -1))}>
                    ↑
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" aria-label={t('moveDown', { name: t(`widgets.${w}`) })} disabled={shown[shown.length - 1] === w} onClick={() => void saveWidgets(moveHomeWidget(shown, w, 1))}>
                    ↓
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" aria-label={t('hide', { name: t(`widgets.${w}`) })} onClick={() => void saveWidgets(shown.filter((x) => x !== w))}>
                    <NotesIcon name="close" size={12} />
                  </button>
                </div>
              )}
            </header>
            {body(w)}
          </section>
        ))}
      </div>
    </div>
  );
}
