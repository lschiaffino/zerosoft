'use client';

import DbHScroll from './DbHScroll';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { DbProperty, DbRow, DbValue, DocsDatabase, DocsMentionableUser } from '@/lib/docs-types';
import { cellValue, groupRows, isComputedType, isTextType, type DbGroup } from '@/lib/docs-database';
import DocsGlyph from '../DocsGlyphs';
import DbValueView, { StatusGlyph } from './DbValueView';
import DbCellEditor, { type DbExitMove } from './DbCellEditor';
import { PropertyTypeIcon } from './DbPropertyMenu';

/** Alto fijo de fila (y de encabezado de grupo): permite virtualizar sin medir. */
export const DB_ROW_H = 34;
/** Desde cuántos ítems se virtualiza (por debajo se pinta todo). */
const VIRTUAL_MIN = 80;
const OVERSCAN = 12;
const MIN_W = 80;

export function columnWidth(prop: DbProperty, widths?: Record<string, number>): number {
  return widths?.[prop.id] ?? (prop.type === 'title' ? 260 : prop.type === 'checkbox' ? 110 : 180);
}

type Item =
  | { kind: 'group'; key: string; group: DbGroup }
  | { kind: 'row'; key: string; row: DbRow; groupKey: string | null; nav: number }
  | { kind: 'add'; key: string; groupKey: string };

export interface DbFocusRequest {
  rowId: string;
  propId: string;
  edit: boolean;
  /** Cambia en cada pedido (el mismo destino dos veces también enfoca). */
  tick: number;
}

interface DbTableProps {
  db: DocsDatabase;
  rows: DbRow[];
  props: DbProperty[];
  groupProp: DbProperty | null;
  widths?: Record<string, number>;
  members: DocsMentionableUser[];
  people: Record<string, string>;
  focusRequest: DbFocusRequest | null;
  onCell: (rowId: string, propId: string, value: DbValue) => void;
  onCreateOption: (rowId: string, propId: string, name: string) => void;
  onAddRow: (groupKey: string | null) => void;
  onDeleteRow: (rowId: string) => void;
  onOpenRow: (rowId: string) => void;
  onWidth: (propId: string, width: number) => void;
  onHeader: (propId: string, anchor: HTMLElement) => void;
  onAddProperty: (anchor: HTMLElement) => void;
  onFocusBlock: () => void;
}

/** Fila de la tabla: memo por objeto de fila (tipear en una celda no repinta las otras 999). */
const TableRow = memo(function TableRow({
  row,
  nav,
  props,
  widths,
  people,
  locale,
  active,
  editing,
  members,
  editInitial,
  onCellClick,
  onCellFocus,
  onEditChange,
  onEditCreate,
  onEditExit,
  onOpenRow,
  onDeleteRow,
  labels,
}: {
  row: DbRow;
  nav: number;
  props: DbProperty[];
  widths?: Record<string, number>;
  people: Record<string, string>;
  locale: string;
  /** Columna activa de esta fila (-1: ninguna). */
  active: number;
  /** Columna en edición de esta fila (-1: ninguna). */
  editing: number;
  members: DocsMentionableUser[];
  editInitial?: string;
  onCellClick: (nav: number, col: number) => void;
  onCellFocus: (nav: number, col: number) => void;
  onEditChange: (rowId: string, propId: string, value: DbValue) => void;
  onEditCreate: (rowId: string, propId: string, name: string) => void;
  onEditExit: (move: DbExitMove) => void;
  onOpenRow: (rowId: string) => void;
  onDeleteRow: (rowId: string) => void;
  labels: { open: string; remove: string };
}) {
  const cellRefs = useRef<(HTMLDivElement | null)[]>([]);
  return (
    <div className="docs-db-tr" role="row" aria-rowindex={nav + 2}>
      {props.map((p, c) => {
        const isEditing = editing === c;
        return (
          <div
            key={p.id}
            ref={(el) => {
              cellRefs.current[c] = el;
            }}
            role="gridcell"
            className={`docs-db-td docs-db-td-${p.type}${active === c ? ' active' : ''}${isEditing ? ' editing' : ''}`}
            style={{ width: columnWidth(p, widths) }}
            tabIndex={active === c && !isEditing ? 0 : -1}
            data-cell={`${nav}:${c}`}
            aria-colindex={c + 1}
            aria-readonly={isComputedType(p.type) || undefined}
            onFocus={(e) => {
              if (e.target === e.currentTarget) onCellFocus(nav, c);
            }}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('a, button, input')) return;
              onCellClick(nav, c);
            }}
          >
            {isEditing && p.type !== 'select' && p.type !== 'status' && p.type !== 'multi_select' && p.type !== 'person' ? (
              <DbCellEditor
                prop={p}
                row={row}
                members={members}
                anchor={cellRefs.current[c]}
                initialText={editInitial}
                onChange={(v) => onEditChange(row.id, p.id, v)}
                onCreateOption={(name) => onEditCreate(row.id, p.id, name)}
                onExit={onEditExit}
              />
            ) : (
              <>
                <span className="docs-db-cell-value">
                  <DbValueView prop={p} row={row} people={people} locale={locale} links={false} />
                </span>
                {isEditing && (
                  <DbCellEditor
                    prop={p}
                    row={row}
                    members={members}
                    anchor={cellRefs.current[c]}
                    onChange={(v) => onEditChange(row.id, p.id, v)}
                    onCreateOption={(name) => onEditCreate(row.id, p.id, name)}
                    onExit={onEditExit}
                  />
                )}
              </>
            )}
            {p.type === 'title' && (
              <button
                type="button"
                className="docs-db-open"
                tabIndex={-1}
                onClick={() => onOpenRow(row.id)}
                aria-label={labels.open}
                title={labels.open}
              >
                <DocsGlyph name="peek" size={13} />
                <span>{labels.open}</span>
              </button>
            )}
          </div>
        );
      })}
      <div className="docs-db-td docs-db-td-actions" role="gridcell">
        <button
          type="button"
          className="docs-db-remove"
          tabIndex={-1}
          onClick={() => onDeleteRow(row.id)}
          aria-label={labels.remove}
          title={labels.remove}
        >
          ×
        </button>
      </div>
    </div>
  );
});

/** Ancestro que scrollea en vertical (o la ventana). */
function scrollParent(el: HTMLElement | null): HTMLElement | Window {
  let node = el?.parentElement ?? null;
  while (node) {
    const oy = getComputedStyle(node).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return window;
}

/**
 * Vista tabla: encabezados con menú de propiedad y ancho ajustable, filas
 * virtualizadas (alto fijo, ventana calculada contra el viewport: sirve
 * scrollee la página o un panel) y grilla con teclado: flechas mueven, Enter
 * edita, Esc deja de editar, Tab va a la celda siguiente, Espacio abre la fila.
 */
export default function DbTable(p: DbTableProps) {
  const { db, rows, props, groupProp, widths, members, people, focusRequest } = p;
  const t = useTranslations('docs.database');
  const locale = useLocale();
  const gridRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState<{ r: number; c: number } | null>(null);
  const [editing, setEditing] = useState<{ r: number; c: number; initial?: string } | null>(null);
  /** Enfocar la celda activa en el próximo render (después de moverla con teclado). */
  const wantFocus = useRef(false);
  const [dragW, setDragW] = useState<{ id: string; w: number } | null>(null);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    let nav = 0;
    if (!groupProp) {
      for (const row of rows) out.push({ kind: 'row', key: row.id, row, groupKey: null, nav: nav++ });
      return out;
    }
    for (const g of groupRows(db, groupProp, rows, { people }, true)) {
      out.push({ kind: 'group', key: `g:${g.key}`, group: g });
      for (const row of g.rows) out.push({ kind: 'row', key: `${g.key}:${row.id}`, row, groupKey: g.key, nav: nav++ });
      out.push({ kind: 'add', key: `a:${g.key}`, groupKey: g.key });
    }
    return out;
  }, [db, rows, groupProp, people]);

  const navRows = useMemo(() => items.filter((i): i is Extract<Item, { kind: 'row' }> => i.kind === 'row'), [items]);
  const itemIndexOfNav = useMemo(() => {
    const m: number[] = [];
    items.forEach((it, i) => {
      if (it.kind === 'row') m[it.nav] = i;
    });
    return m;
  }, [items]);

  // ---------- Virtualización ----------
  const virtual = items.length > VIRTUAL_MIN;
  const [range, setRange] = useState({ start: 0, end: Math.min(items.length, VIRTUAL_MIN) });
  const updateRange = useCallback(() => {
    if (!virtual) return;
    const el = bodyRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight;
    const start = Math.max(0, Math.floor(-rect.top / DB_ROW_H) - OVERSCAN);
    const end = Math.min(items.length, Math.max(start, Math.ceil((vh - rect.top) / DB_ROW_H) + OVERSCAN));
    setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, [virtual, items.length]);
  useLayoutEffect(() => {
    if (!virtual) return;
    updateRange();
    window.addEventListener('scroll', updateRange, true);
    window.addEventListener('resize', updateRange);
    return () => {
      window.removeEventListener('scroll', updateRange, true);
      window.removeEventListener('resize', updateRange);
    };
  }, [virtual, updateRange]);
  const start = virtual ? Math.min(range.start, items.length) : 0;
  const end = virtual ? Math.min(range.end, items.length) : items.length;

  /** Lleva la fila `nav` a la vista (si está fuera de la ventana virtual, scrollea). */
  const reveal = useCallback(
    (nav: number) => {
      const body = bodyRef.current;
      const idx = itemIndexOfNav[nav];
      if (!body || idx === undefined) return;
      const rect = body.getBoundingClientRect();
      const top = rect.top + idx * DB_ROW_H;
      const vh = window.innerHeight;
      const margin = 80;
      let delta = 0;
      if (top < margin) delta = top - margin;
      else if (top + DB_ROW_H > vh - margin) delta = top + DB_ROW_H - (vh - margin);
      if (delta === 0) return;
      const sp = scrollParent(gridRef.current);
      if (sp === window) window.scrollBy(0, delta);
      else (sp as HTMLElement).scrollTop += delta;
      updateRange();
    },
    [itemIndexOfNav, updateRange],
  );

  // Foco en la celda activa después de moverla (si ya está pintada).
  useLayoutEffect(() => {
    if (!wantFocus.current || !active || editing) return;
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-cell="${active.r}:${active.c}"]`);
    if (el) {
      wantFocus.current = false;
      el.focus({ preventScroll: true });
    }
  });

  const moveTo = useCallback(
    (r: number, c: number) => {
      if (navRows.length === 0) return;
      const rr = Math.max(0, Math.min(navRows.length - 1, r));
      const cc = Math.max(0, Math.min(props.length - 1, c));
      wantFocus.current = true;
      setActive({ r: rr, c: cc });
      reveal(rr);
    },
    [navRows.length, props.length, reveal],
  );

  // Pedido de foco desde afuera (fila nueva: entra a editar el título).
  useEffect(() => {
    if (!focusRequest) return;
    const nav = navRows.find((n) => n.row.id === focusRequest.rowId)?.nav;
    const col = props.findIndex((x) => x.id === focusRequest.propId);
    if (nav === undefined || col === -1) return;
    reveal(nav);
    setActive({ r: nav, c: col });
    if (focusRequest.edit) setEditing({ r: nav, c: col });
    else wantFocus.current = true;
    // Solo cuando llega un pedido nuevo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest?.tick]);

  // Filas o columnas que ya no existen (filtro, borrar): la celda activa se acota.
  useEffect(() => {
    if (!active) return;
    if (active.r >= navRows.length || active.c >= props.length) {
      setActive(navRows.length && props.length ? { r: Math.min(active.r, navRows.length - 1), c: Math.min(active.c, props.length - 1) } : null);
      setEditing(null);
    }
  }, [active, navRows.length, props.length]);

  // Lo último de cada render para los callbacks estables (las filas son memo:
  // un callback nuevo en cada tecla las repintaría a todas).
  const latest = useRef({ p, navRows, props, editing, moveTo });
  latest.current = { p, navRows, props, editing, moveTo };

  const startEdit = useCallback((r: number, c: number, initial?: string) => {
    const { navRows: nr, props: ps, p: pp } = latest.current;
    const item = nr[r];
    const prop = ps[c];
    if (!item || !prop || isComputedType(prop.type)) return;
    if (prop.type === 'checkbox') {
      pp.onCell(item.row.id, prop.id, cellValue(prop, item.row) !== true);
      return;
    }
    setActive({ r, c });
    setEditing({ r, c, initial });
  }, []);

  const onEditExit = useCallback(
    (move: DbExitMove) => {
      const { editing: cur, moveTo, props } = latest.current;
      setEditing(null);
      if (!cur) return;
      wantFocus.current = true;
      if (move === 'next') {
        if (cur.c + 1 < props.length) moveTo(cur.r, cur.c + 1);
        else moveTo(cur.r + 1, 0);
      } else if (move === 'prev') {
        if (cur.c > 0) moveTo(cur.r, cur.c - 1);
        else moveTo(cur.r - 1, props.length - 1);
      } else if (move === 'down') {
        moveTo(cur.r + 1, cur.c);
      } else {
        setActive({ r: cur.r, c: cur.c });
      }
    },
    [],
  );

  const onCellClick = useCallback(
    (r: number, c: number) => {
      latest.current.p.onFocusBlock();
      const prop = latest.current.props[c];
      setActive({ r, c });
      if (prop && !isComputedType(prop.type)) startEdit(r, c);
    },
    [startEdit],
  );
  const onCell = useCallback((rowId: string, propId: string, v: DbValue) => latest.current.p.onCell(rowId, propId, v), []);
  const onCreate = useCallback((rowId: string, propId: string, name: string) => latest.current.p.onCreateOption(rowId, propId, name), []);
  const onOpen = useCallback((rowId: string) => latest.current.p.onOpenRow(rowId), []);
  const onDelete = useCallback((rowId: string) => latest.current.p.onDeleteRow(rowId), []);
  const onCellFocus = useCallback((r: number, c: number) => {
    setActive((a) => (a && a.r === r && a.c === c ? a : { r, c }));
  }, []);

  const onGridKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (editing || !active) return;
    const target = e.target as HTMLElement;
    if (!target.matches('[role="gridcell"]')) return;
    const { r, c } = active;
    const meta = e.metaKey || e.ctrlKey;
    const prop = props[c];
    const item = navRows[r];
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        moveTo(meta ? 0 : r - 1, c);
        return;
      case 'ArrowDown':
        e.preventDefault();
        moveTo(meta ? navRows.length - 1 : r + 1, c);
        return;
      case 'ArrowLeft':
        e.preventDefault();
        moveTo(r, meta ? 0 : c - 1);
        return;
      case 'ArrowRight':
        e.preventDefault();
        moveTo(r, meta ? props.length - 1 : c + 1);
        return;
      case 'Home':
        e.preventDefault();
        moveTo(r, 0);
        return;
      case 'End':
        e.preventDefault();
        moveTo(r, props.length - 1);
        return;
      case 'Tab': {
        const last = r === navRows.length - 1 && c === props.length - 1;
        const first = r === 0 && c === 0;
        // En el borde de la grilla, Tab sale (foco al siguiente control de la página).
        if ((!e.shiftKey && last) || (e.shiftKey && first)) return;
        e.preventDefault();
        if (e.shiftKey) {
          if (c > 0) moveTo(r, c - 1);
          else moveTo(r - 1, props.length - 1);
        } else if (c + 1 < props.length) moveTo(r, c + 1);
        else moveTo(r + 1, 0);
        return;
      }
      case 'Enter':
        e.preventDefault();
        e.stopPropagation();
        if (meta && item) p.onOpenRow(item.row.id);
        else startEdit(r, c);
        return;
      case ' ':
        e.preventDefault();
        if (prop?.type === 'checkbox') startEdit(r, c);
        else if (item) p.onOpenRow(item.row.id);
        return;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        setActive(null);
        target.blur();
        return;
      case 'Backspace':
      case 'Delete':
        e.preventDefault();
        e.stopPropagation();
        if (item && prop && !isComputedType(prop.type)) p.onCell(item.row.id, prop.id, prop.type === 'checkbox' ? false : null);
        return;
      default:
        // Tipear sobre una celda de texto o número empieza a editarla con esa tecla.
        if (e.key.length === 1 && !meta && !e.altKey && prop && (isTextType(prop.type) || prop.type === 'number')) {
          e.preventDefault();
          startEdit(r, c, e.key);
        }
    }
  };

  // ---------- Ancho de columnas ----------
  const startResize = (e: React.PointerEvent<HTMLSpanElement>, prop: DbProperty) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = columnWidth(prop, widths);
    let w = startW;
    const move = (ev: PointerEvent) => {
      w = Math.max(MIN_W, Math.min(800, Math.round(startW + ev.clientX - startX)));
      setDragW({ id: prop.id, w });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDragW(null);
      if (w !== startW) p.onWidth(prop.id, w);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const liveWidths = useMemo(
    () => (dragW ? { ...(widths ?? {}), [dragW.id]: dragW.w } : widths),
    [dragW, widths],
  );
  const totalW = props.reduce((s, x) => s + columnWidth(x, liveWidths), 0) + 40;
  const labels = useMemo(() => ({ open: t('open'), remove: t('removeRow') }), [t]);

  const renderItem = (it: Item) => {
    if (it.kind === 'group') {
      const g = it.group;
      return (
        <div key={it.key} className="docs-db-group-head" role="row" style={{ height: DB_ROW_H }}>
          <span role="gridcell" className="docs-db-group-label">
            {groupProp?.type === 'status' && g.option && <StatusGlyph group={g.option.group ?? 'todo'} />}
            {groupLabel(groupProp, g, t)}
            <span className="docs-db-count">{g.rows.length}</span>
          </span>
        </div>
      );
    }
    if (it.kind === 'add') {
      return (
        <div key={it.key} className="docs-db-group-add" style={{ height: DB_ROW_H }}>
          <button type="button" className="docs-db-new-inline" onClick={() => p.onAddRow(it.groupKey)}>
            <DocsGlyph name="plus" size={12} />
            {t('newRow')}
          </button>
        </div>
      );
    }
    const isActiveRow = active?.r === it.nav;
    const isEditingRow = editing?.r === it.nav;
    return (
      <TableRow
        key={it.key}
        row={it.row}
        nav={it.nav}
        props={props}
        widths={liveWidths}
        people={people}
        locale={locale}
        active={isActiveRow ? active!.c : -1}
        editing={isEditingRow ? editing!.c : -1}
        editInitial={isEditingRow ? editing!.initial : undefined}
        members={members}
        onCellClick={onCellClick}
        onCellFocus={onCellFocus}
        onEditChange={onCell}
        onEditCreate={onCreate}
        onEditExit={onEditExit}
        onOpenRow={onOpen}
        onDeleteRow={onDelete}
        labels={labels}
      />
    );
  };

  return (
    <DbHScroll className="docs-db-scroll">
      <div
        ref={gridRef}
        className="docs-db-grid"
        role="grid"
        aria-rowcount={navRows.length + 1}
        aria-colcount={props.length}
        aria-label={db.title || t('database')}
        style={{ width: totalW }}
        onKeyDown={onGridKeyDown}
      >
        <div className="docs-db-thead" role="row" aria-rowindex={1}>
          {props.map((prop) => (
            <div key={prop.id} role="columnheader" className="docs-db-th" style={{ width: columnWidth(prop, liveWidths) }}>
              <button
                type="button"
                className="docs-db-th-btn"
                onClick={(e) => p.onHeader(prop.id, e.currentTarget)}
                aria-haspopup="dialog"
              >
                <PropertyTypeIcon type={prop.type} />
                <span className="docs-db-th-name">{prop.name || t('untitledProperty')}</span>
              </button>
              <span
                className="docs-db-resize"
                role="separator"
                aria-orientation="vertical"
                aria-label={t('resizeColumn', { name: prop.name })}
                onPointerDown={(e) => startResize(e, prop)}
              />
            </div>
          ))}
          <div className="docs-db-th docs-db-th-add">
            <button
              type="button"
              className="docs-db-th-btn"
              onClick={(e) => p.onAddProperty(e.currentTarget)}
              aria-label={t('addProperty')}
              title={t('addProperty')}
            >
              <DocsGlyph name="plus" size={13} />
            </button>
          </div>
        </div>
        <div ref={bodyRef} className="docs-db-tbody" role="rowgroup">
          {virtual && start > 0 && <div style={{ height: start * DB_ROW_H }} aria-hidden="true" />}
          {items.slice(start, end).map(renderItem)}
          {virtual && end < items.length && <div style={{ height: (items.length - end) * DB_ROW_H }} aria-hidden="true" />}
        </div>
      </div>
      {!groupProp && (
        <button type="button" className="docs-db-new-row" onClick={() => p.onAddRow(null)} style={{ width: totalW }}>
          <DocsGlyph name="plus" size={12} />
          {t('newRow')}
        </button>
      )}
    </DbHScroll>
  );
}

/** Nombre de un grupo (opción, persona, marcado/sin marcar, o "Sin <propiedad>"). */
export function groupLabel(
  prop: DbProperty | null,
  g: DbGroup,
  t: (key: string, values?: Record<string, string>) => string,
): string {
  if (!prop) return '';
  if (prop.type === 'checkbox') return g.key === 'true' ? t('checked') : t('unchecked');
  if (!g.key) return t('noValueFor', { name: prop.name || t('untitledProperty') });
  return g.label || t('unknownValue');
}
