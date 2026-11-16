'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { EntryDto, ProjectDto, TaskDto } from '@/lib/time/core';
import { addDays, formatMinutes, isIsoDate, liveMinutes, parseDuration, weekDays } from '@/lib/time/types';
import { api, localToday, TimeDialog, useDayFormat, useErrorText, useToast } from './ui';

type Draft = {
  id: string | null;
  projectId: string;
  taskId: string;
  notes: string;
  duration: string;
  date: string;
  running: boolean;
  originalDuration: string;
};

/** Proyectos agrupados por cliente para el <select> (sin cliente al final). */
function groupByClient(projects: ProjectDto[]): Array<[string | null, ProjectDto[]]> {
  const map = new Map<string | null, ProjectDto[]>();
  for (const p of projects) map.set(p.clientName, [...(map.get(p.clientName) ?? []), p]);
  return [...map.entries()].sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)));
}

/**
 * Hoja de horas: la semana arriba (total por día y de la semana), las entradas
 * del día elegido, el cronómetro y el diálogo para cargar o editar.
 */
export default function Timesheet({ projects, tasks, admin, initialDate, openNew }: { projects: ProjectDto[]; tasks: TaskDto[]; admin: boolean; initialDate: string | null; openNew: boolean }) {
  const t = useTranslations('time');
  const errorText = useErrorText();
  const fmtDay = useDayFormat();
  const [toast, push] = useToast();
  const [today, setToday] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(initialDate && isIsoDate(initialDate) ? initialDate : null);
  const [entries, setEntries] = useState<EntryDto[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const openedNew = useRef(false);

  const activeProjects = useMemo(() => projects.filter((p) => !p.archived), [projects]);
  const activeTasks = useMemo(() => tasks.filter((x) => !x.archived), [tasks]);
  const days = useMemo(() => (date ? weekDays(date) : []), [date]);
  const weekKey = days[0] ?? '';

  // La fecha de hoy es la del navegador: recién al montar.
  useEffect(() => {
    const d = localToday();
    setToday(d);
    setDate((cur) => cur ?? d);
  }, []);

  // La fecha elegida queda en la URL (sin pedirle nada al servidor).
  useEffect(() => {
    if (!date || !today) return;
    const url = new URL(window.location.href);
    if (date === today) url.searchParams.delete('date');
    else url.searchParams.set('date', date);
    url.searchParams.delete('new');
    window.history.replaceState(window.history.state, '', url.toString());
  }, [date, today]);

  const load = useCallback(async () => {
    if (!weekKey) return;
    setLoadFailed(false);
    const r = await api<{ entries: EntryDto[] }>(`/api/time/entries?from=${weekKey}&to=${addDays(weekKey, 6)}`);
    if (!r.ok) {
      setLoadFailed(true);
      return;
    }
    setEntries(r.data.entries);
  }, [weekKey]);

  useEffect(() => {
    setEntries(null);
    void load();
  }, [load]);

  const running = entries?.some((e) => e.timerStartedAt) ?? false;
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, [running]);

  const minutesOf = useCallback((e: EntryDto) => liveMinutes(e, now), [now]);
  const dayTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const e of entries ?? []) totals[e.date] = (totals[e.date] ?? 0) + minutesOf(e);
    return totals;
  }, [entries, minutesOf]);
  const weekTotal = days.reduce((sum, d) => sum + (dayTotals[d] ?? 0), 0);
  const dayEntries = useMemo(() => (entries ?? []).filter((e) => e.date === date), [entries, date]);

  const openNewDraft = useCallback(() => {
    if (!date) return;
    const last = [...(entries ?? [])].reverse().find((e) => activeProjects.some((p) => p.id === e.projectId) && activeTasks.some((x) => x.id === e.taskId));
    setFormError('');
    setDraft({
      id: null,
      projectId: last?.projectId ?? activeProjects[0]?.id ?? '',
      taskId: last?.taskId ?? (activeTasks.find((x) => x.billable) ?? activeTasks[0])?.id ?? '',
      notes: '',
      duration: '',
      date,
      running: false,
      originalDuration: '',
    });
  }, [date, entries, activeProjects, activeTasks]);

  // /app/time?new=1 (menú "+ Nuevo" y Cmd+K) abre el diálogo una vez que hay fecha.
  useEffect(() => {
    if (openNew && !openedNew.current && date && entries && activeProjects.length) {
      openedNew.current = true;
      openNewDraft();
    }
  }, [openNew, date, entries, activeProjects.length, openNewDraft]);

  const openEdit = (e: EntryDto) => {
    const d = formatMinutes(minutesOf(e));
    setFormError('');
    setDraft({
      id: e.id,
      projectId: e.projectId,
      taskId: e.taskId,
      notes: e.notes,
      duration: d,
      date: e.date,
      running: Boolean(e.timerStartedAt),
      originalDuration: d,
    });
  };

  // Una entrada editada queda en su lugar; una nueva va al final. Arrancar un cronómetro para el que corría.
  const replace = (entry: EntryDto) =>
    setEntries((cur) => {
      if (!cur) return cur;
      const stopOthers = (e: EntryDto) => (entry.timerStartedAt && e.timerStartedAt && e.id !== entry.id ? { ...e, timerStartedAt: null, minutes: liveMinutes(e, Date.now()) } : e);
      const inWeek = days.includes(entry.date);
      if (cur.some((e) => e.id === entry.id)) return cur.flatMap((e) => (e.id === entry.id ? (inWeek ? [entry] : []) : [stopOthers(e)]));
      return inWeek ? [...cur.map(stopOthers), entry] : cur.map(stopOthers);
    });

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!draft) return;
    const durationText = draft.duration.trim();
    const minutes = durationText ? parseDuration(durationText) : null;
    if (durationText && minutes === null) {
      setFormError(t('sheet.durationInvalid'));
      return;
    }
    setBusy(true);
    const r = draft.id
      ? await api<{ entry: EntryDto }>(`/api/time/entries/${draft.id}`, {
          method: 'PATCH',
          json: {
            projectId: draft.projectId,
            taskId: draft.taskId,
            notes: draft.notes,
            ...(durationText !== draft.originalDuration && minutes !== null ? { minutes } : {}),
          },
        })
      : await api<{ entry: EntryDto }>('/api/time/entries', {
          method: 'POST',
          json: {
            date: draft.date,
            projectId: draft.projectId,
            taskId: draft.taskId,
            notes: draft.notes,
            minutes,
            start: minutes === null,
          },
        });
    setBusy(false);
    if (!r.ok) {
      setFormError(errorText(r.data.error));
      return;
    }
    if (!draft.id && r.data.entry.timerStartedAt) push(t('sheet.started'));
    else push(t('sheet.saved'));
    replace(r.data.entry);
    setDraft(null);
    // Una entrada que arrancó pudo parar otra: se recarga para tener los minutos del servidor.
    if (r.data.entry.timerStartedAt) void load();
  };

  const toggle = async (e: EntryDto) => {
    const r = await api<{ entry: EntryDto }>(`/api/time/entries/${e.id}`, {
      method: 'PATCH',
      json: { running: !e.timerStartedAt },
    });
    if (!r.ok) return push(errorText(r.data.error), 'bad');
    push(e.timerStartedAt ? t('sheet.stopped') : t('sheet.started'));
    replace(r.data.entry);
    if (r.data.entry.timerStartedAt) void load();
  };

  const remove = async () => {
    const id = confirmDelete;
    if (!id) return;
    setBusy(true);
    const r = await api(`/api/time/entries/${id}`, { method: 'DELETE' });
    setBusy(false);
    setConfirmDelete(null);
    if (!r.ok) return push(errorText(r.data.error), 'bad');
    setEntries((cur) => cur?.filter((e) => e.id !== id) ?? cur);
    setDraft(null);
    push(t('sheet.deleted'));
  };

  const noProjects = activeProjects.length === 0;
  const trackButton = (
    <button type="button" className="btn btn-primary" onClick={openNewDraft} disabled={!date || noProjects} data-testid="time-track">
      {t('nav.track')}
    </button>
  );

  return (
    <div className="app-page ui-page tm-page">
      <PageHeader title={t('nav.timesheet')} description={t('sheet.desc')} actions={trackButton} />

      {noProjects ? (
        <EmptyState
          product="time"
          title={t('sheet.noProjectsTitle')}
          body={admin ? t('sheet.noProjectsAdmin') : t('sheet.noProjectsMember')}
          action={
            admin
              ? {
                  label: t('sheet.createProject'),
                  href: '/app/time/projects?new=1',
                }
              : undefined
          }
        />
      ) : (
        <>
          <div className="tm-weekbar">
            <div className="tm-weeknav">
              <button type="button" className="btn btn-ghost btn-sm tm-icon-btn" aria-label={t('sheet.prevWeek')} onClick={() => date && setDate(addDays(date, -7))} disabled={!date}>
                ‹
              </button>
              <button type="button" className="btn btn-ghost btn-sm tm-icon-btn" aria-label={t('sheet.nextWeek')} onClick={() => date && setDate(addDays(date, 7))} disabled={!date}>
                ›
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => today && setDate(today)} disabled={!today || date === today} data-testid="time-today">
                {t('sheet.today')}
              </button>
              <span className="tm-weeklabel">
                {days.length ? `${fmtDay(days[0], { day: 'numeric', month: 'short' })} – ${fmtDay(days[6], { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
              </span>
            </div>
            <div className="tm-weektotal" data-testid="time-week-total">
              <span className="tm-muted">{t('sheet.weekTotal')}</span> <strong className="num">{entries ? formatMinutes(weekTotal) : '–'}</strong>
            </div>
          </div>

          <div className="tm-days" role="tablist" aria-label={t('sheet.days')}>
            {days.map((d) => (
              <button key={d} type="button" role="tab" aria-selected={d === date} className={`tm-day${d === today ? ' is-today' : ''}`} onClick={() => setDate(d)} data-testid={`time-day-${d}`}>
                <span className="tm-day-name">{fmtDay(d, { weekday: 'short' })}</span>
                <span className="tm-day-num">{fmtDay(d, { day: 'numeric' })}</span>
                <span className="tm-day-total num">{entries ? formatMinutes(dayTotals[d] ?? 0) : '–'}</span>
              </button>
            ))}
          </div>

          <section
            className="tm-daypanel"
            aria-label={
              date
                ? fmtDay(date, {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  })
                : undefined
            }
          >
            {loadFailed ? (
              <EmptyState
                compact
                title={t('sheet.loadError')}
                action={
                  <button type="button" className="btn btn-secondary" onClick={() => void load()}>
                    {t('common.retry')}
                  </button>
                }
              />
            ) : !entries || !date ? (
              <div className="ui-loading-stack" aria-busy="true">
                <span className="sr-only" role="status">
                  {t('common.loading')}
                </span>
                {[0, 1, 2].map((i) => (
                  <span key={i} className="ui-skeleton ui-skeleton-row" />
                ))}
              </div>
            ) : dayEntries.length === 0 ? (
              <EmptyState compact title={t('sheet.emptyDayTitle')} body={t('sheet.emptyDayBody')} />
            ) : (
              <ul className="tm-entries" data-testid="time-entries">
                {dayEntries.map((e) => {
                  const mins = minutesOf(e);
                  return (
                    <li key={e.id} className={`tm-entry${e.timerStartedAt ? ' is-running' : ''}`} data-testid="time-entry" data-running={e.timerStartedAt ? 'true' : 'false'}>
                      <button
                        type="button"
                        className="tm-entry-main"
                        onClick={() => openEdit(e)}
                        aria-label={`${t('common.edit')}: ${t('sheet.entryLabel', { project: e.projectName, task: e.taskName, duration: formatMinutes(mins) })}`}
                      >
                        <span className="tm-entry-title">
                          <strong>{e.projectName}</strong>
                          {e.clientName ? <span className="tm-muted"> · {e.clientName}</span> : null}
                        </span>
                        <span className="tm-entry-meta">
                          {e.taskName}
                          {e.notes ? <span className="tm-entry-notes"> · {e.notes}</span> : null}
                        </span>
                      </button>
                      <span className="tm-entry-time num" data-testid="time-entry-duration">
                        {formatMinutes(mins)}
                      </span>
                      <button
                        type="button"
                        className={`btn btn-sm ${e.timerStartedAt ? 'btn-primary' : 'btn-secondary'} tm-timer-btn`}
                        onClick={() => void toggle(e)}
                        aria-pressed={Boolean(e.timerStartedAt)}
                        data-testid="time-entry-toggle"
                      >
                        {e.timerStartedAt ? t('sheet.stop') : t('sheet.start')}
                      </button>
                    </li>
                  );
                })}
                <li className="tm-entries-total">
                  <span>{t('sheet.dayTotal')}</span>
                  <strong className="num" data-testid="time-day-total">
                    {formatMinutes(dayTotals[date] ?? 0)}
                  </strong>
                </li>
              </ul>
            )}
          </section>
        </>
      )}

      <TimeDialog open={draft !== null} title={draft?.id ? t('sheet.editTitle') : t('sheet.newTitle')} onClose={() => setDraft(null)} testId="time-entry-dialog">
        {draft && (
          <form onSubmit={submit}>
            <div className="ui-modal-body ui-fields">
              <label className="ui-field">
                <span className="label">{t('sheet.project')}</span>
                <select className="input" value={draft.projectId} onChange={(e) => setDraft({ ...draft, projectId: e.target.value })} required autoFocus={!draft.id} name="project">
                  {/* Una entrada vieja de un proyecto archivado conserva su proyecto en la lista. */}
                  {draft.id && !activeProjects.some((p) => p.id === draft.projectId) && (
                    <option value={draft.projectId}>{projects.find((p) => p.id === draft.projectId)?.name ?? draft.projectId}</option>
                  )}
                  {groupByClient(activeProjects).map(([client, list]) => (
                    <optgroup key={client ?? ''} label={client ?? t('sheet.noClient')}>
                      {list.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.code ? `[${p.code}] ${p.name}` : p.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label className="ui-field">
                <span className="label">{t('sheet.task')}</span>
                <select className="input" value={draft.taskId} onChange={(e) => setDraft({ ...draft, taskId: e.target.value })} required name="task">
                  {draft.id && !activeTasks.some((x) => x.id === draft.taskId) && <option value={draft.taskId}>{tasks.find((x) => x.id === draft.taskId)?.name ?? draft.taskId}</option>}
                  {activeTasks.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ui-field">
                <span className="label">{t('sheet.notes')}</span>
                <textarea className="input tm-notes" rows={2} maxLength={2000} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} name="notes" />
              </label>
              <label className="ui-field">
                <span className="label">{t('sheet.duration')}</span>
                <input
                  className="input tm-duration num"
                  inputMode="decimal"
                  placeholder="0:00"
                  value={draft.duration}
                  onChange={(e) => setDraft({ ...draft, duration: e.target.value })}
                  autoFocus={Boolean(draft.id)}
                  name="duration"
                  aria-describedby="tm-duration-hint"
                />
                <span className="ui-help" id="tm-duration-hint">
                  {t('sheet.durationHint')}
                </span>
              </label>
              {formError && (
                <p className="ui-error" role="alert">
                  {formError}
                </p>
              )}
            </div>
            <div className="ui-modal-foot tm-dialog-foot">
              {draft.id && (
                <button type="button" className="btn btn-ghost tm-danger" onClick={() => setConfirmDelete(draft.id)} data-testid="time-entry-delete">
                  {t('common.delete')}
                </button>
              )}
              <span className="tm-spacer" />
              <button type="button" className="btn btn-ghost" onClick={() => setDraft(null)}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy || !draft.projectId || !draft.taskId} data-testid="time-entry-submit">
                {draft.id ? t('common.save') : draft.duration.trim() ? t('sheet.saveEntry') : t('sheet.startTimer')}
              </button>
            </div>
          </form>
        )}
      </TimeDialog>

      <ConfirmDialog
        open={confirmDelete !== null}
        title={t('sheet.deleteTitle')}
        body={t('sheet.deleteBody')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(null)}
      />
      {toast}
    </div>
  );
}
