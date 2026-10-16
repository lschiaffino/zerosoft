'use client';

import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { Link } from '@/i18n/navigation';
import type { TrackStatusRow } from '@/lib/db';
import type { TrackIssueWithStatus } from '@/lib/track-data';
import { safeHexColor } from '@/lib/track-color';

interface IssuesGanttProps {
  issues: TrackIssueWithStatus[];
  statuses: TrackStatusRow[];
  locale: string;
  onDatesChange: (issueId: string, startDate: string, dueDate: string) => Promise<void>;
  labels: {
    prev: string;
    next: string;
    today: string;
    unscheduled: string;
    noAssignee: string;
    updateError: string;
  };
}

interface GanttRow {
  issue: TrackIssueWithStatus;
  depth: number;
  start: Date;
  end: Date;
}

type DragMode = 'move' | 'start' | 'end';

/** Estado del drag de una barra. Las fechas se manejan como índices de día
 *  relativos a windowStart (enteros → snap a día, inmune a DST). */
interface BarDrag {
  pointerId: number;
  issueId: string;
  mode: DragMode;
  startX: number;
  dayPx: number;
  origStartIdx: number;
  origEndIdx: number;
  curStartIdx: number;
  curEndIdx: number;
  dragging: boolean;
}

/** Preview en vivo: índices de día de la barra arrastrada. */
interface DragPreview {
  issueId: string;
  startIdx: number;
  endIdx: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const INK = '#000000';
const DRAG_THRESHOLD = 6; // px antes de activar el drag (permite clicks que navegan)

/** Date-only parse: usa los primeros 10 chars (YYYY-MM-DD) como fecha local. */
function dayOf(iso: string): Date | null {
  if (!iso || iso.length < 10) return null;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function todayLocal(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** YYYY-MM-DD en hora local (formato aceptado por la API). */
function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function clampIdx(v: number, lo: number, hi: number): number {
  if (lo > hi) return lo;
  return Math.min(Math.max(v, lo), hi);
}

/**
 * Orden jerárquico: raíces en el orden recibido, cada una seguida de sus
 * sub-issues (DFS). Solo se anida cuando el padre también está en la lista.
 */
function buildRows(issues: TrackIssueWithStatus[]): GanttRow[] {
  const ids = new Set(issues.map((i) => i.id));
  const children = new Map<string | null, TrackIssueWithStatus[]>();
  issues.forEach((issue) => {
    const key = issue.parent_id && ids.has(issue.parent_id) ? issue.parent_id : null;
    const list = children.get(key);
    if (list) list.push(issue);
    else children.set(key, [issue]);
  });

  const rows: GanttRow[] = [];
  const seen = new Set<string>();
  const visit = (issue: TrackIssueWithStatus, depth: number) => {
    if (seen.has(issue.id)) return;
    seen.add(issue.id);
    const end = (issue.due_date ? dayOf(issue.due_date) : null) ?? dayOf(issue.created_at) ?? todayLocal();
    let start = (issue.start_date ? dayOf(issue.start_date) : null) ?? dayOf(issue.created_at) ?? end;
    if (start.getTime() > end.getTime()) start = end;
    rows.push({ issue, depth, start, end });
    (children.get(issue.id) ?? []).forEach((child) => visit(child, depth + 1));
  };
  (children.get(null) ?? []).forEach((issue) => visit(issue, 0));
  return rows;
}

export default function IssuesGantt({ issues, statuses, locale, onDatesChange, labels }: IssuesGanttProps) {
  const [shiftWeeks, setShiftWeeks] = useState(0);
  const [preview, setPreview] = useState<DragPreview | null>(null);
  const [dragError, setDragError] = useState<string | null>(null);

  const dragRef = useRef<BarDrag | null>(null);
  const suppressClickRef = useRef(false);

  const { rows, unscheduled } = useMemo(() => {
    const scheduled: TrackIssueWithStatus[] = [];
    const unsched: TrackIssueWithStatus[] = [];
    issues.forEach((issue) => {
      if (issue.due_date && dayOf(issue.due_date)) scheduled.push(issue);
      else unsched.push(issue);
    });
    return { rows: buildRows(scheduled), unscheduled: unsched };
  }, [issues]);

  // Rango base: cubre todas las barras + hoy, con padding de 7 días.
  const baseRange = useMemo(() => {
    const today = todayLocal();
    if (rows.length === 0) return { start: addDays(today, -14), end: addDays(today, 14) };
    let min = today.getTime();
    let max = today.getTime();
    rows.forEach((r) => {
      if (r.start.getTime() < min) min = r.start.getTime();
      if (r.end.getTime() > max) max = r.end.getTime();
    });
    return { start: addDays(new Date(min), -7), end: addDays(new Date(max), 7) };
  }, [rows]);

  const windowStart = addDays(baseRange.start, shiftWeeks * 7);
  const windowEnd = addDays(baseRange.end, shiftWeeks * 7);
  const totalDays = Math.max(1, Math.round((windowEnd.getTime() - windowStart.getTime()) / DAY_MS) + 1);
  const pctOf = (d: Date) => ((d.getTime() - windowStart.getTime()) / DAY_MS / totalDays) * 100;
  const idxOf = (d: Date) => Math.round((d.getTime() - windowStart.getTime()) / DAY_MS);

  const fmtDay = (d: Date) => d.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' });

  // Segmentos de mes para la cabecera.
  const months: Array<{ key: string; left: number; width: number; label: string }> = [];
  for (let d = new Date(windowStart.getFullYear(), windowStart.getMonth(), 1); d <= windowEnd; ) {
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    const segStart = d < windowStart ? windowStart : d;
    const segEnd = next > windowEnd ? addDays(windowEnd, 1) : next;
    const left = pctOf(segStart);
    const month = d.toLocaleDateString(locale, { month: 'short' });
    months.push({
      key: `${d.getFullYear()}-${d.getMonth()}`,
      left,
      width: Math.max(0, pctOf(segEnd) - left),
      label: d.getMonth() === 0 || months.length === 0 ? `${month} ${d.getFullYear()}` : month,
    });
    d = next;
  }

  // Ticks semanales (lunes) con líneas de grid.
  const weeks: Array<{ key: string; left: number; label: string }> = [];
  {
    const first = new Date(windowStart);
    const dow = (first.getDay() + 6) % 7; // 0 = lunes
    for (let d = addDays(first, dow === 0 ? 0 : 7 - dow); d <= windowEnd; d = addDays(d, 7)) {
      weeks.push({ key: d.toISOString(), left: pctOf(d), label: String(d.getDate()) });
    }
  }

  const today = todayLocal();
  const todayPct = today >= windowStart && today <= windowEnd ? pctOf(today) : null;

  const statusColor = (issue: TrackIssueWithStatus) =>
    safeHexColor(issue.status_color ?? statuses.find((s) => s.id === issue.status_id)?.color, INK);

  // ---------- Drag & drop de barras (pointer events, sin deps) ----------

  /** Índices resultantes de mover el pointer deltaPx, con clamp al rango visible. */
  function dragIndices(d: BarDrag, deltaPx: number): { startIdx: number; endIdx: number } {
    const delta = Math.round(deltaPx / d.dayPx);
    const lastIdx = totalDays - 1;
    if (d.mode === 'move') {
      const duration = d.origEndIdx - d.origStartIdx;
      const startIdx = clampIdx(d.origStartIdx + delta, 0, lastIdx - duration);
      return { startIdx, endIdx: startIdx + duration };
    }
    if (d.mode === 'start') {
      // El inicio nunca supera al fin (clamp → duración mínima 1 día de ancho).
      return { startIdx: clampIdx(d.origStartIdx + delta, 0, d.origEndIdx), endIdx: d.origEndIdx };
    }
    return { startIdx: d.origStartIdx, endIdx: clampIdx(d.origEndIdx + delta, d.origStartIdx, lastIdx) };
  }

  function handleBarPointerDown(
    e: ReactPointerEvent<HTMLAnchorElement>,
    issue: TrackIssueWithStatus,
    start: Date,
    end: Date,
  ) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const barEl = e.currentTarget;
    try {
      barEl.setPointerCapture(e.pointerId);
    } catch {
      return;
    }
    const canvasEl = barEl.closest('.track-gantt-canvas');
    const width = canvasEl?.getBoundingClientRect().width ?? 0;
    if (!(width > 0)) return;
    const target = e.target as HTMLElement;
    const mode: DragMode = target.closest('.track-gantt-handle-start')
      ? 'start'
      : target.closest('.track-gantt-handle-end')
        ? 'end'
        : 'move';
    const origStartIdx = idxOf(start);
    const origEndIdx = idxOf(end);
    dragRef.current = {
      pointerId: e.pointerId,
      issueId: issue.id,
      mode,
      startX: e.clientX,
      dayPx: width / totalDays,
      origStartIdx,
      origEndIdx,
      curStartIdx: origStartIdx,
      curEndIdx: origEndIdx,
      dragging: false,
    };
    setDragError(null);
  }

  function handleBarPointerMove(e: ReactPointerEvent<HTMLAnchorElement>) {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.dragging) {
      if (Math.abs(e.clientX - d.startX) < DRAG_THRESHOLD) return;
      d.dragging = true;
    }
    const { startIdx, endIdx } = dragIndices(d, e.clientX - d.startX);
    if (startIdx === d.curStartIdx && endIdx === d.curEndIdx) return;
    d.curStartIdx = startIdx;
    d.curEndIdx = endIdx;
    setPreview({ issueId: d.issueId, startIdx, endIdx });
  }

  function handleBarPointerUp(e: ReactPointerEvent<HTMLAnchorElement>) {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    dragRef.current = null;
    if (!d.dragging) return;
    // El click posterior al drag no debe navegar.
    suppressClickRef.current = true;
    setPreview(null);
    if (d.curStartIdx === d.origStartIdx && d.curEndIdx === d.origEndIdx) return;
    const startDate = ymd(addDays(windowStart, d.curStartIdx));
    const dueDate = ymd(addDays(windowStart, d.curEndIdx));
    void onDatesChange(d.issueId, startDate, dueDate).catch(() => setDragError(labels.updateError));
  }

  function handleBarPointerCancel(e: ReactPointerEvent<HTMLAnchorElement>) {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    dragRef.current = null;
    setPreview(null);
  }

  function handleBarClick(e: ReactMouseEvent<HTMLAnchorElement>) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      e.preventDefault();
    }
  }

  return (
    <div className="track-gantt">
      <div className="track-gantt-header">
        <div className="track-gantt-title">
          {fmtDay(windowStart)} → {fmtDay(windowEnd)}
        </div>
        <div className="track-gantt-nav">
          <button type="button" onClick={() => setShiftWeeks((w) => w - 2)}>
            {labels.prev}
          </button>
          <button type="button" onClick={() => setShiftWeeks(0)}>
            {labels.today}
          </button>
          <button type="button" onClick={() => setShiftWeeks((w) => w + 2)}>
            {labels.next}
          </button>
        </div>
      </div>

      {dragError && (
        <p className="form-error" role="alert" style={{ margin: '8px 0 0' }}>
          {dragError}
        </p>
      )}

      <div className="track-gantt-body">
        <div className="track-gantt-side">
          <div className="track-gantt-side-head" />
          {rows.map(({ issue, depth }) => (
            <div className="track-gantt-side-row" key={issue.id} title={issue.title}>
              {depth > 0 && (
                <span className="track-gantt-indent" style={{ width: depth * 14 }} aria-hidden>
                  ↳
                </span>
              )}
              <span className="track-identifier">{issue.identifier}</span>
              <span className="track-gantt-side-title">{issue.title}</span>
            </div>
          ))}
        </div>

        <div className="track-gantt-scroll">
          <div className="track-gantt-canvas">
            <div className="track-gantt-months">
              {months.map((m) => (
                <span key={m.key} className="track-gantt-month" style={{ left: `${m.left}%`, width: `${m.width}%` }}>
                  {m.label}
                </span>
              ))}
            </div>
            <div className="track-gantt-weekrow">
              {weeks.map((w) => (
                <span key={w.key} className="track-gantt-week" style={{ left: `${w.left}%` }}>
                  {w.label}
                </span>
              ))}
            </div>

            {rows.map(({ issue, start, end }) => {
              const p = preview && preview.issueId === issue.id ? preview : null;
              const rs = p ? addDays(windowStart, p.startIdx) : start;
              const re = p ? addDays(windowStart, p.endIdx) : end;
              const left = Math.max(0, pctOf(rs));
              const right = Math.min(100, pctOf(addDays(re, 1)));
              const visible = right > 0 && left < 100;
              return (
                <div className="track-gantt-row" key={issue.id}>
                  {visible && (
                    <Link
                      href={`/app/track/issues/${issue.id}`}
                      className={`track-gantt-bar${p ? ' dragging' : ''}`}
                      draggable={false}
                      style={{
                        left: `${left}%`,
                        width: `${Math.max(0, right - left)}%`,
                        background: statusColor(issue),
                      }}
                      title={`${issue.identifier} · ${issue.title}\n${fmtDay(rs)} → ${fmtDay(re)}\n${issue.priority} · ${issue.assignee_name ?? labels.noAssignee}`}
                      onPointerDown={(e) => handleBarPointerDown(e, issue, start, end)}
                      onPointerMove={handleBarPointerMove}
                      onPointerUp={handleBarPointerUp}
                      onPointerCancel={handleBarPointerCancel}
                      onClick={handleBarClick}
                    >
                      <span className="track-gantt-handle track-gantt-handle-start" aria-hidden />
                      <span className="track-gantt-handle track-gantt-handle-end" aria-hidden />
                    </Link>
                  )}
                  {p && visible && (
                    <span className="track-gantt-dragtip" style={{ left: `${left}%` }} aria-hidden>
                      {fmtDay(rs)} → {fmtDay(re)}
                    </span>
                  )}
                </div>
              );
            })}

            {weeks.map((w) => (
              <div key={`grid-${w.key}`} className="track-gantt-gridline" style={{ left: `${w.left}%` }} aria-hidden />
            ))}
            {todayPct !== null && <div className="track-gantt-today" style={{ left: `${todayPct}%` }} aria-hidden />}
          </div>
        </div>
      </div>

      {unscheduled.length > 0 && (
        <div className="track-gantt-unscheduled">
          <p className="track-gantt-unscheduled-title">{labels.unscheduled}</p>
          <div className="track-gantt-unscheduled-list">
            {unscheduled.map((issue) => (
              <Link
                key={issue.id}
                href={`/app/track/issues/${issue.id}`}
                className="track-gantt-issue"
              >
                <span className="track-identifier">{issue.identifier}</span>
                <span className="track-gantt-issue-title">{issue.title}</span>
                {issue.child_count > 0 && <span className="track-subtask-indicator">⊞ {issue.child_count}</span>}
                <span className="track-gantt-issue-assignee">{issue.assignee_name ?? labels.noAssignee}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
