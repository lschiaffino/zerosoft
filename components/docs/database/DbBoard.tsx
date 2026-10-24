'use client';

import DbHScroll from './DbHScroll';
import { memo, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { DbProperty, DbRow, DocsDatabase } from '@/lib/docs-types';
import { groupRows, cardHidesValue, cellValue, rowTitle } from '@/lib/docs-database';
import DocsGlyph from '../DocsGlyphs';
import DbValueView, { StatusGlyph } from './DbValueView';
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
}: {
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
            <DbValueView prop={p} row={row} people={people} locale={locale} />
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
}: {
  db: DocsDatabase;
  rows: DbRow[];
  groupProp: DbProperty | null;
  /** Propiedades que muestran las tarjetas (sin el título ni la de las columnas). */
  props: DbProperty[];
  people: Record<string, string>;
  onOpen: (rowId: string) => void;
  /** Mover una fila a otra columna (y antes de `beforeId`, o al final). */
  onMove: (rowId: string, toKey: string, fromKey: string, beforeId: string | null) => void;
  onAdd: (groupKey: string) => void;
  onPickGroup: (anchor: HTMLElement) => void;
}) {
  const t = useTranslations('docs.database');
  const locale = useLocale();
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [drag, setDrag] = useState<{ rowId: string; from: string } | null>(null);
  const [over, setOver] = useState<{ key: string; before: string | null } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;

  const groups = useMemo(() => (groupProp ? groupRows(db, groupProp, rows, { people }, true) : []), [db, groupProp, rows, people]);

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

  const dropAt = (e: React.DragEvent, key: string) => {
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
    setOver((o) => (o && o.key === key && o.before === before ? o : { key, before }));
  };

  return (
    <DbHScroll className="docs-db-board" role="list" aria-label={t('viewTypes.board')}>
      {groups.map((g) => {
        const limit = limits[g.key] ?? PAGE;
        const shown = g.rows.slice(0, limit);
        const isOver = over?.key === g.key;
        return (
          <section
            key={g.key || 'none'}
            className={`docs-db-bcol${isOver ? ' over' : ''}`}
            aria-label={groupLabel(groupProp, g, t)}
            onDragOver={(e) => dropAt(e, g.key)}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o?.key === g.key ? null : o));
            }}
            onDrop={(e) => {
              if (!Array.from(e.dataTransfer.types).includes(DRAG_TYPE)) return;
              e.preventDefault();
              e.stopPropagation();
              const d = dragRef.current;
              const rowId = e.dataTransfer.getData(DRAG_TYPE) || d?.rowId;
              const before = over?.key === g.key ? over.before : null;
              setOver(null);
              setDrag(null);
              if (rowId) onMove(rowId, g.key, d?.from ?? '', before === rowId ? null : before);
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
                  dragging={drag?.rowId === row.id}
                  onOpen={onOpen}
                  onDragStart={(rowId, from) => setDrag({ rowId, from })}
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
              <button type="button" className="docs-db-link-btn" onClick={() => setLimits((l) => ({ ...l, [g.key]: limit + PAGE }))}>
                {t('showMore', { n: g.rows.length - limit })}
              </button>
            )}
            {(groupProp.type !== 'person' || g.key) && (
              <button type="button" className="docs-db-new-inline" onClick={() => onAdd(g.key)}>
                <DocsGlyph name="plus" size={12} />
                {t('newRow')}
              </button>
            )}
          </section>
        );
      })}
    </DbHScroll>
  );
}
