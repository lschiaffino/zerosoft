'use client';

import DbHScroll from './DbHScroll';
import { memo, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { DbProperty, DbRow, DocsDatabase } from '@/lib/docs-types';
import { groupRows, cardHidesValue, cellValue, rowTitle, type DbGroup } from '@/lib/docs-database';
import DocsGlyph from '../DocsGlyphs';
import DbValueView, { StatusGlyph, type DbRefs } from './DbValueView';
import { groupLabel } from './DbTable';

/** Tarjetas por columna antes de "Mostrar más" (1.000 filas en un board no se pintan de una). */
const PAGE = 50;
const DRAG_TYPE = 'application/x-zerosoft-db-row';

const Card = memo(function Card({
  db,
  row,
  groupKey,
  props,
  people,
  locale,
  dragging,
  onOpen,
  onDragStart,
  onDragEnd,
  onMoveKey,
  untitled,
  refs,
}: {
  refs?: DbRefs;
  db: DocsDatabase;
  row: DbRow;
  groupKey: string;
  props: DbProperty[];
  people: Record<string, string>;
  locale: string;
  dragging: boolean;
  onOpen: (rowId: string) => void;
  onDragStart: (rowId: string, groupKey: string) => void;
  onDragEnd: () => void;
  onMoveKey: (rowId: string, groupKey: string, dir: -1 | 1) => void;
  untitled: string;
}) {
  const title = rowTitle(db, row);
  return (
    <div
      className={`docs-db-bcard${dragging ? ' dragging' : ''}`}
      role="listitem"
      draggable
      data-row={row.id}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, row.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart(row.id, groupKey);
      }}
      onDragEnd={onDragEnd}
    >
      <button
        type="button"
        className="docs-db-bcard-open"
        onClick={() => onOpen(row.id)}
        onKeyDown={(e) => {
          // Alt+←/→: mover la tarjeta a la columna vecina sin mouse.
          if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
            e.preventDefault();
            onMoveKey(row.id, groupKey, e.key === 'ArrowLeft' ? -1 : 1);
          }
        }}
      >
        <span className={`docs-db-bcard-title${title ? '' : ' empty'}`}>{title || untitled}</span>
      </button>
      {props.map((p) => {
        // Como Notion: la tarjeta muestra solo lo que tiene valor (un checkbox sin tildar tampoco).
        if (cardHidesValue(p, cellValue(p, row))) return null;
        return (
          <div key={p.id} className="docs-db-bcard-prop" title={p.name}>
            <DbValueView prop={p} row={row} people={people} locale={locale} refs={refs} />
          </div>
        );
      })}
    </div>
  );
});

/**
 * Vista board: una columna por opción (select/status), persona o
 * marcado/no marcado. Arrastrar una tarjeta a otra columna cambia ese valor
 * (y la deja antes de la tarjeta sobre la que se soltó); Alt+←/→ hace lo
 * mismo con teclado. Cada columna pinta de a 50 tarjetas.
 */
export default function DbBoard({
  db,
  rows,
  groupProp,
  props,
  people,
  onOpen,
  onMove,
  onAdd,
  onPickGroup,
  subGroupProp = null,
  refs,
}: {
  db: DocsDatabase;
  rows: DbRow[];
  groupProp: DbProperty | null;
  /** Subgrupos: una fila de columnas por cada valor de esta propiedad. */
  subGroupProp?: DbProperty | null;
  refs?: DbRefs;
  /** Propiedades que muestran las tarjetas (sin el título ni la de las columnas). */
  props: DbProperty[];
  people: Record<string, string>;
  onOpen: (rowId: string) => void;
  /** Mover una fila a otra columna (y antes de `beforeId`, o al final); con subgrupos, también de subgrupo. */
  onMove: (rowId: string, toKey: string, fromKey: string, beforeId: string | null, sub?: { to: string; from: string }) => void;
  onAdd: (groupKey: string, subKey?: string) => void;
  onPickGroup: (anchor: HTMLElement) => void;
}) {
  const t = useTranslations('docs.database');
  const locale = useLocale();
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [drag, setDrag] = useState<{ rowId: string; from: string; sub: string } | null>(null);
  const [over, setOver] = useState<{ key: string; sub: string; before: string | null } | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const dragRef = useRef(drag);
  dragRef.current = drag;

  const groups = useMemo(() => (groupProp ? groupRows(db, groupProp, rows, { people }, true) : []), [db, groupProp, rows, people]);
  const subs = useMemo(
    () => (groupProp && subGroupProp && subGroupProp.id !== groupProp.id ? groupRows(db, subGroupProp, rows, { people }, false) : null),
    [db, groupProp, subGroupProp, rows, people],
  );

  if (!groupProp) {
    return (
      <div className="docs-db-board-empty">
        <p>{t('boardNeedsGroup')}</p>
        <button type="button" className="docs-table-add" onClick={(e) => onPickGroup(e.currentTarget)}>
          {t('pickColumns')}
        </button>
      </div>
    );
  }

  const keys = groups.map((g) => g.key);
  const moveKey = (rowId: string, from: string, dir: -1 | 1) => {
    const i = keys.indexOf(from);
    const to = keys[i + dir];
    if (to === undefined) return;
    onMove(rowId, to, from, null);
  };

  const dropAt = (e: React.DragEvent, key: string, sub: string) => {
    if (!Array.from(e.dataTransfer.types).includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const card = (e.target as HTMLElement).closest<HTMLElement>('[data-row]');
    let before: string | null = null;
    if (card) {
      const r = card.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      const id = card.dataset.row ?? null;
      if (!after) before = id;
      else {
        const next = card.nextElementSibling as HTMLElement | null;
        before = next?.dataset.row ?? null;
      }
    }
    setOver((o) => (o && o.key === key && o.sub === sub && o.before === before ? o : { key, sub, before }));
  };

  /** Columnas de un subgrupo (o de todo el board si no hay subgrupos). */
  const columns = (list: DbGroup[], sub: string) =>
    list.map((g) => {
      const limitKey = `${sub}\u0000${g.key}`;
      const limit = limits[limitKey] ?? PAGE;
      const shown = g.rows.slice(0, limit);
      const isOver = over?.key === g.key && over.sub === sub;
      return (
        <section
          key={g.key || 'none'}
          className={`docs-db-bcol${isOver ? ' over' : ''}`}
          aria-label={groupLabel(groupProp, g, t)}
          onDragOver={(e) => dropAt(e, g.key, sub)}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o?.key === g.key && o.sub === sub ? null : o));
          }}
          onDrop={(e) => {
            if (!Array.from(e.dataTransfer.types).includes(DRAG_TYPE)) return;
            e.preventDefault();
            e.stopPropagation();
            const d = dragRef.current;
            const rowId = e.dataTransfer.getData(DRAG_TYPE) || d?.rowId;
            const before = over?.key === g.key && over.sub === sub ? over.before : null;
            setOver(null);
            setDrag(null);
            if (!rowId) return;
            onMove(rowId, g.key, d?.from ?? '', before === rowId ? null : before, subs ? { to: sub, from: d?.sub ?? '' } : undefined);
          }}
        >
          <header className="docs-db-bcol-head">
            {groupProp.type === 'status' && g.option && <StatusGlyph group={g.option.group ?? 'todo'} />}
            <span className="docs-db-bcol-name">{groupLabel(groupProp, g, t)}</span>
            <span className="docs-db-count">{g.rows.length}</span>
          </header>
          <div className="docs-db-bcol-cards" role="list">
            {shown.map((row) => (
              <Card
                key={row.id}
                db={db}
                row={row}
                groupKey={g.key}
                props={props}
                people={people}
                locale={locale}
                refs={refs}
                dragging={drag?.rowId === row.id}
                onOpen={onOpen}
                onDragStart={(rowId, from) => setDrag({ rowId, from, sub })}
                onDragEnd={() => {
                  setDrag(null);
                  setOver(null);
                }}
                onMoveKey={moveKey}
                untitled={t('untitledRow')}
              />
            ))}
            {isOver && <div className="docs-db-bdrop" aria-hidden="true" />}
          </div>
          {g.rows.length > limit && (
            <button type="button" className="docs-db-link-btn" onClick={() => setLimits((l) => ({ ...l, [limitKey]: limit + PAGE }))}>
              {t('showMore', { n: g.rows.length - limit })}
            </button>
          )}
          {(groupProp.type !== 'person' || g.key) && (
            <button type="button" className="docs-db-new-inline" onClick={() => onAdd(g.key, subs ? sub : undefined)}>
              <DocsGlyph name="plus" size={12} />
              {t('newRow')}
            </button>
          )}
        </section>
      );
    });

  if (subs && subGroupProp) {
    return (
      <div className="docs-db-subgroups" data-testid="docs-db-subgroups">
        {subs.map((sg) => {
          const open = !collapsed[sg.key];
          const cols = groupRows(db, groupProp, sg.rows, { people }, true);
          return (
            <section key={sg.key || 'none'} className="docs-db-subgroup" aria-label={groupLabel(subGroupProp, sg, t)}>
              <button
                type="button"
                className="docs-db-subgroup-head"
                aria-expanded={open}
                onClick={() => setCollapsed((c) => ({ ...c, [sg.key]: open }))}
              >
                <span className={`docs-db-subgroup-caret${open ? ' open' : ''}`} aria-hidden="true">
                  ▸
                </span>
                {subGroupProp.type === 'status' && sg.option && <StatusGlyph group={sg.option.group ?? 'todo'} />}
                <span>{groupLabel(subGroupProp, sg, t)}</span>
                <span className="docs-db-count">{sg.rows.length}</span>
              </button>
              {open && (
                <DbHScroll className="docs-db-board" role="list" aria-label={groupLabel(subGroupProp, sg, t)}>
                  {columns(cols, sg.key)}
                </DbHScroll>
              )}
            </section>
          );
        })}
      </div>
    );
  }

  return (
    <DbHScroll className="docs-db-board" role="list" aria-label={t('viewTypes.board')}>
      {columns(groups, '')}
    </DbHScroll>
  );
}
