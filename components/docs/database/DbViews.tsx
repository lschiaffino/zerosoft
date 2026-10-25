'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { DbProperty, DbRow, DocsDatabase } from '@/lib/docs-types';
import { cardHidesValue, cellValue, dayKey, rowTitle } from '@/lib/docs-database';
import DocsGlyph from '../DocsGlyphs';
import DbValueView, { type DbRefs } from './DbValueView';

/** Días desde 1970 de un 'YYYY-MM-DD' (UTC: sin corrimientos por horario de verano). */
export function dayIndex(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function dayFromIndex(i: number): string {
  const d = new Date(i * 86_400_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

function todayKey(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

interface CommonProps {
  db: DocsDatabase;
  rows: DbRow[];
  /** Propiedades que muestran las tarjetas/filas (sin el título). */
  props: DbProperty[];
  people: Record<string, string>;
  refs?: DbRefs;
  onOpen: (rowId: string) => void;
}

function CardProps({ props, row, people, locale, refs }: { props: DbProperty[]; row: DbRow; people: Record<string, string>; locale: string; refs?: DbRefs }) {
  return (
    <>
      {props.map((p) =>
        cardHidesValue(p, cellValue(p, row)) && p.type !== 'button' ? null : (
          <span key={p.id} className="docs-db-list-prop" title={p.name}>
            <DbValueView prop={p} row={row} people={people} locale={locale} refs={refs} />
          </span>
        ),
      )}
    </>
  );
}

// ---------- Lista ----------

/** Vista lista (como la de Notion): una línea por fila con el título y las propiedades visibles a la derecha. */
export function DbList({ db, rows, props, people, refs, onOpen, onAdd, canAdd }: CommonProps & { onAdd: () => void; canAdd: boolean }) {
  const t = useTranslations('docs.database');
  const locale = useLocale();
  const [limit, setLimit] = useState(100);
  return (
    <div className="docs-db-list" data-testid="docs-db-list">
      {rows.length === 0 && <p className="docs-db-empty">{db.rows.length ? t('noMatches') : t('emptyList')}</p>}
      <ul className="docs-db-list-items" aria-label={t('viewTypes.list')}>
        {rows.slice(0, limit).map((row) => {
          const title = rowTitle(db, row);
          return (
            <li key={row.id} className="docs-db-list-item">
              <button type="button" className="docs-db-list-open" onClick={() => onOpen(row.id)}>
                <DocsGlyph name="page" size={14} />
                <span className={`docs-db-list-title${title ? '' : ' empty'}`}>{title || t('untitledRow')}</span>
              </button>
              <span className="docs-db-list-props">
                <CardProps props={props} row={row} people={people} locale={locale} refs={refs} />
              </span>
            </li>
          );
        })}
      </ul>
      {rows.length > limit && (
        <button type="button" className="docs-db-link-btn" onClick={() => setLimit((n) => n + 100)}>
          {t('showMore', { n: rows.length - limit })}
        </button>
      )}
      {canAdd && (
        <button type="button" className="docs-db-new-row" onClick={onAdd}>
          <DocsGlyph name="plus" size={12} />
          {t('newRow')}
        </button>
      )}
    </div>
  );
}

// ---------- Calendario ----------

const DRAG_TYPE = 'application/x-zerosoft-db-row';
const DAY_LIMIT = 3;

/**
 * Vista calendario: un mes con las filas en el día de su propiedad fecha.
 * Arrastrar una tarjeta a otro día cambia la fecha (Alt+flechas con
 * teclado: un día o una semana); "+" en un día crea una fila con esa fecha.
 */
export function DbCalendar({
  db,
  rows,
  props,
  people,
  refs,
  onOpen,
  dateProp,
  editable,
  onMove,
  onAdd,
  onPickDate,
}: CommonProps & {
  dateProp: DbProperty | null;
  editable: boolean;
  onMove: (rowId: string, day: string) => void;
  onAdd: (day: string) => void;
  onPickDate: (anchor: HTMLElement) => void;
}) {
  const t = useTranslations('docs.database');
  const locale = useLocale();
  const today = todayKey();
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const [over, setOver] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const weekStart = locale.startsWith('en') ? 0 : 1;
  const movable = editable && dateProp?.type === 'date';
  const wrapRef = useRef<HTMLDivElement | null>(null);
  /** Tarjeta movida con Alt+flechas: el foco la sigue a su día nuevo (se vuelve a montar ahí). */
  const refocus = useRef<string | null>(null);
  useEffect(() => {
    const id = refocus.current;
    if (!id) return;
    const el = wrapRef.current?.querySelector<HTMLElement>(`.docs-db-calcard[data-row="${CSS.escape(id)}"] .docs-db-calcard-open`);
    if (el) {
      refocus.current = null;
      el.focus();
    }
  });

  const byDay = useMemo(() => {
    const m = new Map<string, DbRow[]>();
    if (!dateProp) return m;
    for (const r of rows) {
      const k = dayKey(cellValue(dateProp, r));
      if (!k) continue;
      const list = m.get(k) ?? [];
      list.push(r);
      m.set(k, list);
    }
    return m;
  }, [rows, dateProp]);
  const undated = dateProp ? rows.filter((r) => !dayKey(cellValue(dateProp, r))) : [];

  if (!dateProp) {
    return (
      <div className="docs-db-board-empty">
        <p>{t('calendar.needsDate')}</p>
        <button type="button" className="docs-table-add" onClick={(e) => onPickDate(e.currentTarget)}>
          {t('calendar.pickDate')}
        </button>
      </div>
    );
  }

  const [y, m] = month.split('-').map(Number);
  const first = dayIndex(`${month}-01`);
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const start = first - ((firstDow - weekStart + 7) % 7);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const weeks = Math.ceil((first - start + daysInMonth) / 7);
  const shift = (n: number) => {
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  };
  const monthLabel = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const dayNames = Array.from({ length: 7 }, (_, i) =>
    new Date(Date.UTC(2024, 0, 7 + ((i + weekStart) % 7))).toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' }),
  );

  const card = (row: DbRow, day: string) => {
    const title = rowTitle(db, row);
    return (
      <div
        key={row.id}
        className="docs-db-calcard"
        draggable={movable}
        data-row={row.id}
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, row.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
      >
        <button
          type="button"
          className="docs-db-calcard-open"
          onClick={() => onOpen(row.id)}
          onKeyDown={(e) => {
            if (!movable || !e.altKey) return;
            const delta = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' ? -7 : e.key === 'ArrowDown' ? 7 : 0;
            if (!delta) return;
            e.preventDefault();
            const next = dayFromIndex(dayIndex(day) + delta);
            refocus.current = row.id;
            // Pasó a otro mes: el calendario lo sigue.
            if (!next.startsWith(month)) setMonth(next.slice(0, 7));
            onMove(row.id, next);
          }}
        >
          <span className={`docs-db-calcard-title${title ? '' : ' empty'}`}>{title || t('untitledRow')}</span>
        </button>
        {props.length > 0 && (
          <span className="docs-db-calcard-props">
            <CardProps props={props} row={row} people={people} locale={locale} refs={refs} />
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="docs-db-calendar" data-testid="docs-db-calendar" ref={wrapRef}>
      <div className="docs-db-cal-bar">
        <span className="docs-db-cal-month" aria-live="polite">
          {monthLabel}
        </span>
        <span className="docs-db-cal-nav">
          <button type="button" className="docs-db-tool" aria-label={t('calendar.prev')} title={t('calendar.prev')} onClick={() => shift(-1)}>
            ‹
          </button>
          <button type="button" className="docs-db-tool" onClick={() => setMonth(today.slice(0, 7))}>
            {t('calendar.today')}
          </button>
          <button type="button" className="docs-db-tool" aria-label={t('calendar.next')} title={t('calendar.next')} onClick={() => shift(1)}>
            ›
          </button>
        </span>
      </div>
      <div className="docs-db-cal-grid" role="grid" aria-label={monthLabel}>
        <div className="docs-db-cal-row docs-db-cal-head" role="row">
          {dayNames.map((d) => (
            <span key={d} role="columnheader" className="docs-db-cal-dow">
              {d}
            </span>
          ))}
        </div>
        {Array.from({ length: weeks }, (_, w) => (
          <div key={w} className="docs-db-cal-row" role="row">
            {Array.from({ length: 7 }, (_, d) => {
              const idx = start + w * 7 + d;
              const key = dayFromIndex(idx);
              const list = byDay.get(key) ?? [];
              const inMonth = key.startsWith(month);
              const open = expanded === key;
              const shown = open ? list : list.slice(0, DAY_LIMIT);
              return (
                <div
                  key={key}
                  role="gridcell"
                  aria-label={key}
                  data-day={key}
                  className={`docs-db-cal-day${inMonth ? '' : ' out'}${key === today ? ' today' : ''}${over === key ? ' over' : ''}`}
                  onDragOver={(e) => {
                    if (!movable || !Array.from(e.dataTransfer.types).includes(DRAG_TYPE)) return;
                    e.preventDefault();
                    setOver(key);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === key ? null : o));
                  }}
                  onDrop={(e) => {
                    const id = e.dataTransfer.getData(DRAG_TYPE);
                    setOver(null);
                    if (!movable || !id) return;
                    e.preventDefault();
                    onMove(id, key);
                  }}
                >
                  <span className="docs-db-cal-num">{Number(key.slice(8))}</span>
                  {editable && dateProp.type === 'date' && (
                    <button type="button" className="docs-db-cal-add" aria-label={t('calendar.addOn', { day: key })} title={t('calendar.addOn', { day: key })} onClick={() => onAdd(key)}>
                      <DocsGlyph name="plus" size={11} />
                    </button>
                  )}
                  <div className="docs-db-cal-cards">{shown.map((r) => card(r, key))}</div>
                  {list.length > DAY_LIMIT && (
                    <button type="button" className="docs-db-link-btn docs-db-cal-more" onClick={() => setExpanded(open ? null : key)}>
                      {open ? t('calendar.less') : t('calendar.more', { n: list.length - DAY_LIMIT })}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {undated.length > 0 && (
        <details className="docs-db-undated">
          <summary>{t('calendar.noDate', { n: undated.length })}</summary>
          <ul>
            {undated.slice(0, 100).map((r) => (
              <li key={r.id}>
                <button type="button" className="docs-db-link-btn" onClick={() => onOpen(r.id)}>
                  {rowTitle(db, r) || t('untitledRow')}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// ---------- Timeline ----------

export type DbZoom = 'week' | 'month' | 'quarter';
const DAY_W: Record<DbZoom, number> = { week: 44, month: 20, quarter: 7 };
const LANE_H = 34;

interface DragState {
  rowId: string;
  mode: 'move' | 'start' | 'end';
  x0: number;
  start: number;
  end: number;
  delta: number;
}

/**
 * Vista timeline (Gantt): una barra por fila desde la fecha de inicio hasta
 * la de fin. Arrastrar la barra la mueve, los bordes cambian inicio o fin;
 * con teclado, ←/→ mueve un día y Shift+←/→ cambia el fin. Click en el
 * carril de una fila sin fechas la pone en ese día.
 */
export function DbTimeline({
  db,
  rows,
  onOpen,
  startProp,
  endProp,
  zoom,
  onZoom,
  editable,
  onSetRange,
  onPickDate,
}: Omit<CommonProps, 'props' | 'people' | 'refs'> & {
  startProp: DbProperty | null;
  endProp: DbProperty | null;
  zoom: DbZoom;
  onZoom: (z: DbZoom) => void;
  editable: boolean;
  onSetRange: (rowId: string, start: string, end: string | null) => void;
  onPickDate: (anchor: HTMLElement) => void;
}) {
  const t = useTranslations('docs.database');
  const locale = useLocale();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** Parte visible del lienzo: las barras fuera de vista muestran una flecha para ir a ellas (como Notion). */
  const [viewport, setViewport] = useState({ left: 0, width: 0 });
  /** Tramo del canvas que se ve de verdad (lo que la ventana corta no cuenta): ahí no van las flechas "Ir a". */
  const syncViewport = () => {
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const clipLeft = Math.max(0, -rect.left);
    const clipRight = Math.max(0, rect.right - (window.innerWidth || rect.right));
    const left = el.scrollLeft + clipLeft;
    const width = Math.max(0, el.clientWidth - clipLeft - clipRight);
    setViewport((v) => (v.left === left && v.width === width ? v : { left, width }));
  };
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const today = dayIndex(todayKey());
  const dayW = DAY_W[zoom];
  const movable = editable && startProp?.type === 'date';
  const resizable = movable && endProp?.type === 'date';

  const spans = useMemo(() => {
    return rows.map((r) => {
      const s = startProp ? dayKey(cellValue(startProp, r)) : null;
      const e = endProp ? dayKey(cellValue(endProp, r)) : null;
      if (!s) return { row: r, start: null as number | null, end: null as number | null };
      const si = dayIndex(s);
      const ei = e ? Math.max(si, dayIndex(e)) : si;
      return { row: r, start: si, end: ei };
    });
  }, [rows, startProp, endProp]);

  const [from, to] = useMemo(() => {
    let lo = today - 14;
    let hi = today + 75;
    for (const s of spans) {
      if (s.start === null) continue;
      lo = Math.min(lo, s.start - 7);
      hi = Math.max(hi, (s.end ?? s.start) + 21);
    }
    if (hi - lo > 1100) hi = lo + 1100;
    return [lo, hi];
  }, [spans, today]);
  const days = to - from + 1;

  // Al abrir (y al cambiar la escala), hoy queda a la vista.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = Math.max(0, (today - from - 7) * dayW);
    syncViewport();
  }, [zoom, today, from, dayW]);

  useEffect(() => {
    // También cuando cambia el ancho sin que cambie la ventana (panel lateral, sidebar).
    const el = scrollRef.current;
    const ro = el && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => syncViewport()) : null;
    if (el) ro?.observe(el);
    window.addEventListener('resize', syncViewport);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', syncViewport);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startProp]);

  if (!startProp) {
    return (
      <div className="docs-db-board-empty">
        <p>{t('timeline.needsDate')}</p>
        <button type="button" className="docs-table-add" onClick={(e) => onPickDate(e.currentTarget)}>
          {t('calendar.pickDate')}
        </button>
      </div>
    );
  }

  const startDrag = (e: React.PointerEvent, rowId: string, mode: DragState['mode'], start: number, end: number) => {
    if (!movable || (mode !== 'move' && !resizable)) return;
    e.preventDefault();
    e.stopPropagation();
    const st: DragState = { rowId, mode, x0: e.clientX, start, end, delta: 0 };
    setDrag(st);
    // Arrastrar no selecciona el texto de la página.
    document.body.classList.add('docs-db-noselect');
    window.getSelection()?.removeAllRanges();
    const move = (ev: PointerEvent) => {
      const delta = Math.round((ev.clientX - st.x0) / dayW);
      setDrag((d) => (d && d.delta !== delta ? { ...d, delta } : d));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('docs-db-noselect');
      const d = dragRef.current;
      setDrag(null);
      if (!d) return;
      if (d.delta === 0) {
        if (mode === 'move') onOpen(rowId);
        return;
      }
      const r = rangeOf(d);
      onSetRange(rowId, dayFromIndex(r.start), resizable ? dayFromIndex(r.end) : null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const rangeOf = (d: DragState) => {
    if (d.mode === 'move') return { start: d.start + d.delta, end: d.end + d.delta };
    if (d.mode === 'start') return { start: Math.min(d.end, d.start + d.delta), end: d.end };
    return { start: d.start, end: Math.max(d.start, d.end + d.delta) };
  };

  // Encabezado: meses arriba, días (o semanas en trimestre) abajo.
  const months: Array<{ label: string; left: number; width: number }> = [];
  for (let i = from; i <= to; ) {
    const key = dayFromIndex(i);
    const [yy, mm] = key.split('-').map(Number);
    const next = Math.round(Date.UTC(yy, mm, 1) / 86_400_000);
    const endI = Math.min(to + 1, next);
    months.push({
      label: new Date(Date.UTC(yy, mm - 1, 1)).toLocaleDateString(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' }),
      left: (i - from) * dayW,
      width: (endI - i) * dayW,
    });
    i = endI;
  }
  const ticks: Array<{ label: string; left: number; weekend: boolean }> = [];
  for (let i = from; i <= to; i++) {
    const key = dayFromIndex(i);
    const dow = new Date(i * 86_400_000).getUTCDay();
    if (zoom === 'quarter' ? dow === 1 : true) ticks.push({ label: String(Number(key.slice(8))), left: (i - from) * dayW, weekend: dow === 0 || dow === 6 });
  }

  return (
    <div className="docs-db-timeline" data-testid="docs-db-timeline">
      <div className="docs-db-cal-bar">
        <span className="docs-db-tl-scale" role="group" aria-label={t('timeline.zoom')}>
          {(['week', 'month', 'quarter'] as const).map((z) => (
            <button key={z} type="button" className={`docs-db-tool${zoom === z ? ' on' : ''}`} aria-pressed={zoom === z} onClick={() => onZoom(z)}>
              {t(`timeline.${z}`)}
            </button>
          ))}
        </span>
        <button
          type="button"
          className="docs-db-tool"
          onClick={() => {
            const el = scrollRef.current;
            if (el) el.scrollTo({ left: Math.max(0, (today - from - 7) * dayW), behavior: 'smooth' });
          }}
        >
          {t('calendar.today')}
        </button>
      </div>
      <div className="docs-db-tl">
        <div className="docs-db-tl-side" aria-hidden="true">
          <div className="docs-db-tl-side-head">{db.properties.find((p) => p.type === 'title')?.name}</div>
          {spans.map(({ row }) => (
            <div key={row.id} className="docs-db-tl-side-row" style={{ height: LANE_H }}>
              {rowTitle(db, row) || t('untitledRow')}
            </div>
          ))}
        </div>
        <div className="docs-db-tl-scroll" ref={scrollRef} onScroll={syncViewport}>
          <div className="docs-db-tl-canvas" style={{ width: days * dayW }}>
            <div className="docs-db-tl-head">
              <div className="docs-db-tl-months">
                {months.map((mo) => (
                  <span key={mo.left} className="docs-db-tl-month" style={{ left: mo.left, width: mo.width }}>
                    {/* El nombre del mes queda a la vista mientras se scrollea ese mes. */}
                    <span className="docs-db-tl-month-label">{mo.label}</span>
                  </span>
                ))}
              </div>
              <div className="docs-db-tl-days">
                {ticks.map((tk) => (
                  <span key={tk.left} className={`docs-db-tl-day${tk.weekend ? ' weekend' : ''}`} style={{ left: tk.left, width: zoom === 'quarter' ? dayW * 7 : dayW }}>
                    {zoom === 'quarter' || dayW >= 18 ? tk.label : ''}
                  </span>
                ))}
              </div>
            </div>
            <div className="docs-db-tl-body" role="list" aria-label={t('viewTypes.timeline')}>
              {today >= from && today <= to && <span className="docs-db-tl-today" style={{ left: (today - from) * dayW + dayW / 2 }} aria-hidden="true" />}
              {spans.map(({ row, start, end }) => {
                const title = rowTitle(db, row) || t('untitledRow');
                const live = drag && drag.rowId === row.id ? rangeOf(drag) : null;
                const s = live ? live.start : start;
                const e = live ? live.end : end;
                return (
                  <div
                    key={row.id}
                    className="docs-db-tl-lane"
                    role="listitem"
                    style={{ height: LANE_H }}
                    onClick={(ev) => {
                      if (start !== null || !movable) return;
                      const rect = ev.currentTarget.getBoundingClientRect();
                      const day = from + Math.floor((ev.clientX - rect.left) / dayW);
                      onSetRange(row.id, dayFromIndex(day), resizable ? dayFromIndex(day) : null);
                    }}
                  >
                    {s !== null && e !== null && viewport.width > 0 && ((e - from + 1) * dayW < viewport.left + 4 || (s - from) * dayW > viewport.left + viewport.width - 4) && (
                      <button
                        type="button"
                        className="docs-db-tl-jump"
                        style={(e - from + 1) * dayW < viewport.left + 4 ? { left: viewport.left + 4 } : { left: viewport.left + viewport.width - 28 }}
                        aria-label={t('timeline.goTo', { name: title })}
                        title={t('timeline.goTo', { name: title })}
                        onPointerDown={(ev) => ev.stopPropagation()}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          scrollRef.current?.scrollTo({ left: Math.max(0, (s - from - 3) * dayW), behavior: 'smooth' });
                        }}
                      >
                        {(e - from + 1) * dayW < viewport.left + 4 ? '‹' : '›'}
                      </button>
                    )}
                    {s !== null && e !== null ? (
                      <div
                        className={`docs-db-tl-bar${live ? ' dragging' : ''}`}
                        style={{ left: (s - from) * dayW, width: Math.max(dayW, (e - s + 1) * dayW) }}
                        onPointerDown={(ev) => startDrag(ev, row.id, 'move', start!, end!)}
                      >
                        {resizable && <span className="docs-db-tl-handle start" onPointerDown={(ev) => startDrag(ev, row.id, 'start', start!, end!)} aria-hidden="true" />}
                        <button
                          type="button"
                          className="docs-db-tl-label"
                          aria-label={`${title}: ${dayFromIndex(s)}${e !== s ? ` → ${dayFromIndex(e)}` : ''}`}
                          onClick={(ev) => {
                            // El click lo resuelve el pointerup (sin arrastre abre); con teclado, Enter abre.
                            if (ev.detail === 0) onOpen(row.id);
                          }}
                          onKeyDown={(ev) => {
                            if (!movable || (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight')) return;
                            ev.preventDefault();
                            const d = ev.key === 'ArrowLeft' ? -1 : 1;
                            if (ev.shiftKey && resizable) onSetRange(row.id, dayFromIndex(start!), dayFromIndex(Math.max(start!, end! + d)));
                            else onSetRange(row.id, dayFromIndex(start! + d), resizable ? dayFromIndex(end! + d) : null);
                          }}
                        >
                          {title}
                        </button>
                        {resizable && <span className="docs-db-tl-handle end" onPointerDown={(ev) => startDrag(ev, row.id, 'end', start!, end!)} aria-hidden="true" />}
                      </div>
                    ) : (
                      movable && (
                        <span className="docs-db-tl-empty" aria-hidden="true" style={{ left: viewport.left + 8 }}>
                          {t('timeline.clickToSet')}
                        </span>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      {rows.length === 0 && <p className="docs-db-empty">{db.rows.length ? t('noMatches') : t('emptyList')}</p>}
    </div>
  );
}
