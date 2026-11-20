'use client';

import { useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import { useTranslations } from 'next-intl';
import EmptyState from '@/components/ui/EmptyState';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { EntryDto, ProjectDto, TaskDto } from '@/lib/time/core';
import { canTrackOn, cellPlan, formatMinutes, liveMinutes, parseDuration, rowKey, tasksForProject, weekRows, type RowKey, type WeekRow } from '@/lib/time/types';
import { api, groupByClient, TimeDialog, useDayFormat, useErrorText } from './ui';

type Props = {
  days: string[];
  today: string | null;
  entries: EntryDto[] | null;
  loadFailed: boolean;
  onRetry: () => void;
  projects: ProjectDto[];
  tasks: TaskDto[];
  /** Id de la persona: las filas nuevas son de proyectos donde está asignada. */
  me: string;
  now: number;
  setEntries: Dispatch<SetStateAction<EntryDto[] | null>>;
  push: (msg: string, tone?: 'ok' | 'bad') => void;
  /** Abre un día en la vista del día (celdas con varias entradas o un cronómetro). */
  onOpenDay: (date: string) => void;
  /** Semana enviada o aprobada: se ve, no se edita. */
  readOnly?: boolean;
};

/**
 * Hoja semanal en grilla, como la vista Week de Harvest: una fila por proyecto
 * y tarea, las horas de cada día se escriben en la celda y se guardan al salir
 * (o con Enter). Las notas y el cronómetro quedan en la vista del día.
 * El componente va con `key` por semana: las filas agregadas a mano son de esa semana.
 */
export default function WeekGrid({ days, today, entries, loadFailed, onRetry, projects, tasks, me, now, setEntries, push, onOpenDay, readOnly = false }: Props) {
  const t = useTranslations('time');
  const errorText = useErrorText();
  const fmtDay = useDayFormat();
  const [extra, setExtra] = useState<RowKey[]>([]);
  const [adding, setAdding] = useState<RowKey | null>(null);
  const [addError, setAddError] = useState('');
  const [copying, setCopying] = useState(false);
  const [removing, setRemoving] = useState<WeekRow<EntryDto> | null>(null);
  const [busy, setBusy] = useState(false);
  const [focusRow, setFocusRow] = useState<string | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  const activeProjects = useMemo(() => projects.filter((p) => !p.archived && canTrackOn(p, me)), [projects, me]);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const taskById = useMemo(() => new Map(tasks.map((x) => [x.id, x])), [tasks]);
  const rows = useMemo(() => weekRows(entries ?? [], days, extra), [entries, days, extra]);
  const mins = (e: EntryDto) => liveMinutes(e, now);
  const sum = (list: EntryDto[]) => list.reduce((n, e) => n + mins(e), 0);
  const dayTotal = (d: string) => sum((entries ?? []).filter((e) => e.date === d));
  const weekTotal = days.reduce((n, d) => n + dayTotal(d), 0);

  // Una fila recién agregada recibe el foco en la celda de hoy (o del lunes).
  useEffect(() => {
    if (!focusRow) return;
    const day = today && days.includes(today) ? today : days[0];
    const input = tableRef.current?.querySelector<HTMLInputElement>(`tr[data-row="${CSS.escape(focusRow)}"] input[data-day="${day}"]`);
    input?.focus();
    setFocusRow(null);
  }, [focusRow, rows, days, today]);

  const tasksOf = (projectId: string) => tasksForProject(projectById.get(projectId), tasks);
  // Una fila de un proyecto donde la persona ya no está asignada toma los nombres de sus entradas.
  const names = (r: RowKey & { cells?: Record<string, EntryDto[]> }) => {
    const e = r.cells ? Object.values(r.cells).flat()[0] : undefined;
    const p = projectById.get(r.projectId);
    return {
      project: p?.name ?? e?.projectName ?? '',
      client: p ? p.clientName : (e?.clientName ?? null),
      code: p?.code ?? '',
      task: taskById.get(r.taskId)?.name ?? e?.taskName ?? '',
    };
  };

  /** Guarda lo escrito en una celda. Devuelve false si no se guardó (el texto vuelve al valor anterior). */
  const saveCell = async (row: WeekRow<EntryDto>, date: string, text: string): Promise<boolean> => {
    const trimmed = text.trim();
    const minutes = trimmed ? parseDuration(trimmed) : null;
    if (trimmed && minutes === null) {
      push(t('sheet.durationInvalid'), 'bad');
      return false;
    }
    const plan = cellPlan(row.cells[date] ?? [], minutes);
    if (plan.kind === 'none' || plan.kind === 'locked') return plan.kind === 'none';
    if (plan.kind === 'delete') {
      const r = await api(`/api/time/entries/${plan.id}`, { method: 'DELETE' });
      if (!r.ok) {
        push(errorText(r.data.error), 'bad');
        return false;
      }
      // La fila queda en la semana aunque se haya quedado sin horas.
      setExtra((cur) => (cur.some((x) => rowKey(x) === row.key) ? cur : [...cur, { projectId: row.projectId, taskId: row.taskId }]));
      setEntries((cur) => cur?.filter((e) => e.id !== plan.id) ?? cur);
      return true;
    }
    const r =
      plan.kind === 'create'
        ? await api<{ entry: EntryDto }>('/api/time/entries', {
            method: 'POST',
            json: {
              date,
              projectId: row.projectId,
              taskId: row.taskId,
              minutes: plan.minutes,
              start: false,
            },
          })
        : await api<{ entry: EntryDto }>(`/api/time/entries/${plan.id}`, {
            method: 'PATCH',
            json: { minutes: plan.minutes },
          });
    if (!r.ok) {
      push(errorText(r.data.error), 'bad');
      return false;
    }
    const entry = r.data.entry;
    setEntries((cur) => (cur ? (cur.some((e) => e.id === entry.id) ? cur.map((e) => (e.id === entry.id ? entry : e)) : [...cur, entry]) : cur));
    return true;
  };

  const openAdd = () => {
    const taken = new Set(rows.map((r) => r.key));
    const project = activeProjects[0];
    const own = tasksOf(project?.id ?? '');
    const free = own.filter((x) => !taken.has(rowKey({ projectId: project?.id ?? '', taskId: x.id })));
    // Como en el día: primero una tarea facturable que todavía no tenga fila.
    const task = free.find((x) => x.billable) ?? free[0] ?? own[0];
    setAddError('');
    setAdding({ projectId: project?.id ?? '', taskId: task?.id ?? '' });
  };

  const submitAdd = (ev: FormEvent) => {
    ev.preventDefault();
    if (!adding?.projectId || !adding.taskId) return;
    if (rows.some((r) => r.key === rowKey(adding))) {
      setAddError(t('week.rowExists'));
      return;
    }
    setExtra((cur) => [...cur, adding]);
    setFocusRow(rowKey(adding));
    setAdding(null);
  };

  const copyRows = async () => {
    if (!days[0]) return;
    setCopying(true);
    const r = await api<{ week: string | null; rows: RowKey[] }>(`/api/time/entries?rowsBefore=${days[0]}`);
    setCopying(false);
    if (!r.ok) return push(errorText(r.data.error), 'bad');
    // Solo filas donde la persona sigue asignada y la tarea sigue en el proyecto.
    const fresh = r.data.rows.filter(
      (x) => !rows.some((row) => row.key === rowKey(x)) && activeProjects.some((p) => p.id === x.projectId) && tasksOf(x.projectId).some((task) => task.id === x.taskId),
    );
    if (!r.data.week || fresh.length === 0) return push(t('week.nothingToCopy'));
    setExtra((cur) => [...cur, ...fresh]);
    push(t('week.copied', { count: fresh.length }));
  };

  const removeRow = async (row: WeekRow<EntryDto>) => {
    const ids = Object.values(row.cells).flatMap((list) => list.map((e) => e.id));
    if (ids.length === 0) {
      setExtra((cur) => cur.filter((x) => rowKey(x) !== row.key));
      return;
    }
    setBusy(true);
    const gone: string[] = [];
    let failed: string | undefined;
    for (const id of ids) {
      const r = await api(`/api/time/entries/${id}`, { method: 'DELETE' });
      if (r.ok || r.status === 404) gone.push(id);
      else failed = r.data.error;
    }
    setBusy(false);
    setRemoving(null);
    setEntries((cur) => cur?.filter((e) => !gone.includes(e.id)) ?? cur);
    if (failed !== undefined) return push(errorText(failed), 'bad');
    setExtra((cur) => cur.filter((x) => rowKey(x) !== row.key));
    push(t('week.removed'));
  };

  const noRows = rows.length === 0;
  const removingCount = removing ? Object.values(removing.cells).reduce((n, list) => n + list.length, 0) : 0;

  return (
    <section className="tm-weekgrid" aria-label={t('sheet.week')} data-testid="time-week-grid">
      {loadFailed ? (
        <EmptyState
          compact
          title={t('sheet.loadError')}
          action={
            <button type="button" className="btn btn-secondary" onClick={onRetry}>
              {t('common.retry')}
            </button>
          }
        />
      ) : !entries ? (
        <div className="ui-loading-stack" aria-busy="true">
          <span className="sr-only" role="status">
            {t('common.loading')}
          </span>
          {[0, 1, 2].map((i) => (
            <span key={i} className="ui-skeleton ui-skeleton-row" />
          ))}
        </div>
      ) : noRows ? (
        <EmptyState
          compact
          title={t('week.emptyTitle')}
          body={t('week.emptyBody')}
          action={
            readOnly ? undefined : (
              <div className="tm-actions tm-actions-center">
              <button type="button" className="btn btn-primary" onClick={openAdd} data-testid="time-week-add-row">
                {t('week.addRow')}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => void copyRows()} disabled={copying} data-testid="time-week-copy-rows">
                {t('week.copyRows')}
              </button>
              </div>
            )
          }
        />
      ) : (
        <>
          <div className="tm-grid-scroll">
            <table className="tm-gridtable" ref={tableRef}>
              <thead>
                <tr>
                  <th scope="col" className="tm-grid-name">
                    {t('week.projectTask')}
                  </th>
                  {days.map((d) => (
                    <th key={d} scope="col" className={`tm-grid-day${d === today ? ' is-today' : ''}`}>
                      <span className="tm-day-name">{fmtDay(d, { weekday: 'short' })}</span> <span className="tm-day-num">{fmtDay(d, { day: 'numeric' })}</span>
                    </th>
                  ))}
                  <th scope="col" className="tm-grid-total">
                    {t('week.total')}
                  </th>
                  <th scope="col" className="tm-grid-x">
                    <span className="sr-only">{t('week.removeRow')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const n = names(row);
                  const rowTotal = days.reduce((acc, d) => acc + sum(row.cells[d] ?? []), 0);
                  return (
                    <tr key={row.key} data-row={row.key} data-testid="time-week-row">
                      <th scope="row" className="tm-grid-name">
                        <span className="tm-grid-project">
                          {n.code ? <span className="tm-code">{n.code}</span> : null}
                          <strong>{n.project}</strong>
                          {n.client ? <span className="tm-muted"> · {n.client}</span> : null}
                        </span>
                        <span className="tm-grid-task">{n.task}</span>
                      </th>
                      {days.map((d) => (
                        <td key={d} className={`tm-grid-cell${d === today ? ' is-today' : ''}`}>
                          <GridCell
                            cell={row.cells[d] ?? []}
                            minutes={sum(row.cells[d] ?? [])}
                            day={d}
                            label={t('week.cellLabel', {
                              project: n.project,
                              task: n.task,
                              day: fmtDay(d, {
                                weekday: 'long',
                                day: 'numeric',
                                month: 'long',
                              }),
                            })}
                            lockedLabel={t('week.lockedLabel', {
                              project: n.project,
                              task: n.task,
                              day: fmtDay(d, {
                                weekday: 'long',
                                day: 'numeric',
                                month: 'long',
                              }),
                            })}
                            onSave={(text) => saveCell(row, d, text)}
                            onOpenDay={() => onOpenDay(d)}
                            readOnly={readOnly}
                          />
                        </td>
                      ))}
                      <td className="tm-grid-total num" data-testid="time-week-row-total">
                        {formatMinutes(rowTotal)}
                      </td>
                      <td className="tm-grid-x">
                        {!readOnly && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm tm-icon-btn"
                          aria-label={`${t('week.removeRow')}: ${n.project}, ${n.task}`}
                          onClick={() => (rowTotal > 0 || Object.values(row.cells).some((l) => l.length) ? setRemoving(row) : void removeRow(row))}
                          data-testid="time-week-remove-row"
                        >
                          ×
                        </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" className="tm-grid-name">
                    {t('week.total')}
                  </th>
                  {days.map((d) => (
                    <td key={d} className={`tm-grid-cell tm-grid-sum num${d === today ? ' is-today' : ''}`} data-testid={`time-week-day-total-${d}`}>
                      {formatMinutes(dayTotal(d))}
                    </td>
                  ))}
                  <td className="tm-grid-total num" data-testid="time-week-grid-total">
                    {formatMinutes(weekTotal)}
                  </td>
                  <td className="tm-grid-x" />
                </tr>
              </tfoot>
            </table>
          </div>
          {!readOnly && (
            <div className="tm-grid-foot">
              <button type="button" className="btn btn-secondary btn-sm" onClick={openAdd} data-testid="time-week-add-row">
                {t('week.addRow')}
              </button>
              <span className="tm-muted tm-small">{t('week.hint')}</span>
            </div>
          )}
        </>
      )}

      <TimeDialog open={adding !== null} title={t('week.addRowTitle')} onClose={() => setAdding(null)} testId="time-week-row-dialog">
        {adding && (
          <form onSubmit={submitAdd}>
            <div className="ui-modal-body ui-fields">
              <label className="ui-field">
                <span className="label">{t('sheet.project')}</span>
                <select
                  className="input"
                  value={adding.projectId}
                  onChange={(e) => {
                    const projectId = e.target.value;
                    const own = tasksOf(projectId);
                    // La tarea elegida sigue si el proyecto nuevo la tiene; si no, la primera facturable.
                    const taskId = own.some((x) => x.id === adding.taskId) ? adding.taskId : ((own.find((x) => x.billable) ?? own[0])?.id ?? '');
                    setAdding({ projectId, taskId });
                  }}
                  required
                  autoFocus
                  name="project"
                >
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
                <select className="input" value={adding.taskId} onChange={(e) => setAdding({ ...adding, taskId: e.target.value })} required name="task">
                  {tasksOf(adding.projectId).map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </label>
              {addError && (
                <p className="ui-error" role="alert">
                  {addError}
                </p>
              )}
            </div>
            <div className="ui-modal-foot tm-dialog-foot">
              <span className="tm-spacer" />
              <button type="button" className="btn btn-ghost" onClick={() => setAdding(null)}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn btn-primary" disabled={!adding.projectId || !adding.taskId} data-testid="time-week-row-submit">
                {t('week.addRow')}
              </button>
            </div>
          </form>
        )}
      </TimeDialog>

      <ConfirmDialog
        open={removing !== null}
        title={t('week.removeTitle')}
        body={
          removing
            ? t('week.removeBody', {
                count: removingCount,
                duration: formatMinutes(days.reduce((acc, d) => acc + sum(removing.cells[d] ?? []), 0)),
              })
            : ''
        }
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        busy={busy}
        onConfirm={() => removing && void removeRow(removing)}
        onCancel={() => setRemoving(null)}
      />
    </section>
  );
}

/**
 * Una celda: input con "h:mm". Guarda al salir o con Enter; Esc vuelve al valor
 * guardado. Con varias entradas o un cronómetro corriendo, un botón que abre el día.
 */
function GridCell({
  cell,
  minutes,
  day,
  label,
  lockedLabel,
  onSave,
  onOpenDay,
  readOnly,
}: {
  cell: EntryDto[];
  minutes: number;
  day: string;
  label: string;
  lockedLabel: string;
  onSave: (text: string) => Promise<boolean>;
  onOpenDay: () => void;
  readOnly: boolean;
}) {
  const locked = cell.length > 1 || cell.some((e) => e.timerStartedAt);
  const shown = cell.length ? formatMinutes(minutes) : '';
  const [value, setValue] = useState(shown);
  const [saving, setSaving] = useState(false);
  const focused = useRef(false);
  const committed = useRef(shown);

  // Lo guardado cambia (otra celda paró un cronómetro, se recargó la semana): se muestra si no se está escribiendo.
  useEffect(() => {
    committed.current = shown;
    if (!focused.current) setValue(shown);
  }, [shown]);

  if (locked) {
    const running = cell.some((e) => e.timerStartedAt);
    return (
      <button
        type="button"
        className={`tm-cell-locked num${running ? ' is-running' : ''}`}
        onClick={onOpenDay}
        aria-label={`${lockedLabel}: ${formatMinutes(minutes)}`}
        data-day={day}
        data-testid="time-week-cell-locked"
      >
        {formatMinutes(minutes)}
      </button>
    );
  }

  const commit = async () => {
    if (readOnly) return;
    if (value.trim() === committed.current.trim()) {
      setValue(committed.current);
      return;
    }
    const sent = value;
    committed.current = sent;
    setSaving(true);
    const ok = await onSave(sent);
    setSaving(false);
    if (!ok) {
      committed.current = shown;
      setValue(shown);
      return;
    }
    // "2" queda como "2:00", aunque el foco siga en la celda.
    const parsed = sent.trim() ? parseDuration(sent) : null;
    const normalized = parsed === null ? '' : formatMinutes(parsed);
    committed.current = normalized;
    setValue((cur) => (cur === sent ? normalized : cur));
  };

  return (
    <input
      className="input tm-cell num"
      inputMode="decimal"
      value={value}
      placeholder=""
      aria-label={label}
      aria-busy={saving || undefined}
      readOnly={readOnly}
      data-day={day}
      data-testid="time-week-cell"
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => {
        focused.current = true;
        e.currentTarget.select();
      }}
      onBlur={() => {
        focused.current = false;
        void commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setValue(committed.current);
        }
      }}
    />
  );
}
