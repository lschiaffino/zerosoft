'use client';

import { useCallback, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { DbPropertyType, DbValue, DbViewType, DocsBlock, DocsDatabase } from '@/lib/docs-types';
import {
  DB_MAX_PROPERTIES,
  DB_MAX_ROWS,
  DB_MAX_VIEWS,
  activeView,
  addProperty,
  addRow,
  addView,
  databasePatch,
  defaultStatusOptions,
  deleteRows,
  duplicateView,
  filterDefaults,
  findRow,
  groupProperty,
  moveRow,
  newDbId,
  normalizeDatabase,
  removeView,
  rowTitle,
  setCell,
  titleProperty,
  updateProperty,
  updateView,
  valueForGroup,
  viewRows,
  visibleProperties,
} from '@/lib/docs-database';
import DocsGlyph, { type DocsGlyphName } from './DocsGlyphs';
import DbPopover from './database/DbPopover';
import DbTable, { type DbFocusRequest } from './database/DbTable';
import DbBoard from './database/DbBoard';
import DbValueView from './database/DbValueView';
import DbPropertyMenu, { PropertyTypeList, typeKey } from './database/DbPropertyMenu';
import { DbFilterPanel, DbGroupPanel, DbPropertiesPanel, DbSortPanel, newFilter } from './database/DbToolbar';
import { peopleMap, useDbMembers } from './database/useDbMembers';

export type DbOpenMode = 'peek' | 'full';

interface DocsDatabaseBlockProps {
  block: DocsBlock;
  index: number;
  onChange: (index: number, patch: Partial<DocsBlock>) => void;
  onFocus: (index: number) => void;
  /** Abrir una fila como página (panel lateral o página completa); lo pinta el editor. */
  onOpenRow?: (blockId: string, rowId: string, mode: DbOpenMode) => void;
  /** De dónde salen los miembros para las propiedades persona. */
  membersUrl?: string | null;
}

type Pop =
  | { kind: 'filter' | 'sort' | 'group' | 'props' | 'addProp' | 'addView' | 'viewMenu'; anchor: HTMLElement }
  | { kind: 'propMenu'; anchor: HTMLElement; propId: string };

const VIEW_GLYPH: Record<DbViewType, DocsGlyphName> = { table: 'table', board: 'boardView', gallery: 'gallery' };
const GALLERY_PAGE = 60;

/**
 * Bloque base de datos, estilo Notion: propiedades tipadas, vistas con
 * pestañas (tabla, board, galería) que guardan filtro, orden, agrupado,
 * propiedades ocultas y anchos, y filas que se abren como página.
 */
export default function DocsDatabaseBlock({ block, index, onChange, onFocus, onOpenRow, membersUrl = null }: DocsDatabaseBlockProps) {
  const t = useTranslations('docs.database');
  const locale = useLocale();
  const db = normalizeDatabase(block);
  const view = activeView(db);
  const members = useDbMembers(membersUrl);
  const people = useMemo(() => peopleMap(members), [members]);
  const [pop, setPop] = useState<Pop | null>(null);
  const [focusRequest, setFocusRequest] = useState<DbFocusRequest | null>(null);
  const [galleryLimit, setGalleryLimit] = useState(GALLERY_PAGE);
  const [renaming, setRenaming] = useState(false);

  const commit = useCallback((next: DocsDatabase) => onChange(index, databasePatch(next)), [index, onChange]);
  const close = () => setPop(null);

  const rows = useMemo(() => viewRows(db, view, { people, locale }), [db, view, people, locale]);
  const visible = useMemo(() => visibleProperties({ properties: db.properties }, view), [db.properties, view]);
  const groupProp = groupProperty(db, view);
  const title = titleProperty(db);

  const openRow = useCallback(
    (rowId: string, mode: DbOpenMode = 'peek') => onOpenRow?.(block.id, rowId, mode),
    [block.id, onOpenRow],
  );

  /** Fila nueva con los valores de los filtros (y del grupo); en la tabla entra a editar el título. */
  const newRow = (groupKey: string | null) => {
    if (db.rows.length >= DB_MAX_ROWS) return;
    const values: Record<string, DbValue> = filterDefaults(db, view);
    if (groupProp && groupKey !== null) {
      const v = valueForGroup(groupProp, { id: '', values, created_at: '', updated_at: '' }, groupKey, null);
      if (v !== null && !(Array.isArray(v) && v.length === 0)) values[groupProp.id] = v;
    }
    const { db: next, row } = addRow(db, values);
    commit(next);
    onFocus(index);
    if (view.type === 'table') setFocusRequest({ rowId: row.id, propId: title.id, edit: true, tick: Date.now() });
    else openRow(row.id, 'peek');
  };

  const onCell = useCallback(
    (rowId: string, propId: string, value: DbValue) => commit(setCell(db, rowId, propId, value)),
    [commit, db],
  );

  const onCreateOption = useCallback(
    (rowId: string, propId: string, name: string) => {
      const prop = db.properties.find((p) => p.id === propId);
      if (!prop) return;
      const option = { id: newDbId(), name, ...(prop.type === 'status' ? { group: 'todo' as const } : {}) };
      const withOpt = updateProperty(db, propId, { options: [...(prop.options ?? []), option] });
      const row = findRow(withOpt, rowId);
      const cur = row?.values[propId];
      const value = prop.type === 'multi_select' ? [...(Array.isArray(cur) ? cur : []), option.id] : option.id;
      commit(setCell(withOpt, rowId, propId, value));
    },
    [commit, db],
  );

  const createProperty = (type: DbPropertyType) => {
    if (db.properties.length >= DB_MAX_PROPERTIES) return;
    const { db: next, property } = addProperty(db, type, t(typeKey(type)));
    commit(next);
    // Recién creada: se abre su menú para nombrarla.
    const anchor = pop?.anchor ?? null;
    setPop(anchor ? { kind: 'propMenu', anchor, propId: property.id } : null);
  };

  const addStatusProperty = () => {
    if (db.properties.length >= DB_MAX_PROPERTIES) return;
    const { db: withProp, property } = addProperty(db, 'status', t('types.status'));
    const next = updateView(
      updateProperty(withProp, property.id, {
        options: defaultStatusOptions({ notStarted: t('defaults.notStarted'), inProgress: t('defaults.inProgress'), done: t('defaults.done') }),
      }),
      view.id,
      { group_by: property.id },
    );
    commit(next);
    close();
  };

  const toolButton = (kind: 'filter' | 'sort' | 'group' | 'props', glyph: DocsGlyphName, label: string, count = 0) => (
    <button
      type="button"
      className={`docs-db-tool${count ? ' on' : ''}${pop?.kind === kind ? ' open' : ''}`}
      aria-haspopup="dialog"
      aria-label={label}
      title={label}
      aria-expanded={pop?.kind === kind}
      onClick={(e) => setPop(pop?.kind === kind ? null : { kind, anchor: e.currentTarget })}
    >
      <DocsGlyph name={glyph} size={14} />
      <span className="docs-db-tool-label">{label}</span>
      {count > 0 && <span className="docs-db-tool-count">{count}</span>}
    </button>
  );

  const viewName = (v: typeof view) => v.name || t(`viewTypes.${v.type}`);

  const renderGallery = () => {
    if (rows.length === 0) return <p className="docs-db-empty">{db.rows.length ? t('noMatches') : t('emptyGallery')}</p>;
    const cardProps = visible.filter((p) => p.type !== 'title');
    return (
      <>
        <div className="docs-db-gallery" role="list">
          {rows.slice(0, galleryLimit).map((row) => {
            const name = rowTitle(db, row);
            return (
              <button key={row.id} type="button" role="listitem" className="docs-db-card" onClick={() => openRow(row.id)}>
                <span className={`docs-db-card-title${name ? '' : ' empty'}`}>{name || t('untitledRow')}</span>
                {cardProps.map((p) => (
                  <span key={p.id} className="docs-db-prop">
                    <span className="docs-db-prop-label">{p.name}</span>
                    <span className="docs-db-prop-value">
                      <DbValueView prop={p} row={row} people={people} locale={locale} links={false} />
                    </span>
                  </span>
                ))}
              </button>
            );
          })}
        </div>
        {rows.length > galleryLimit && (
          <button type="button" className="docs-db-link-btn" onClick={() => setGalleryLimit((n) => n + GALLERY_PAGE)}>
            {t('showMore', { n: rows.length - galleryLimit })}
          </button>
        )}
      </>
    );
  };

  const filters = view.filters ?? [];
  const sorts = view.sorts ?? [];

  return (
    <div
      className="docs-db-wrap"
      data-index={index}
      data-testid="docs-database"
      onFocus={() => onFocus(index)}
    >
      <input
        className="docs-db-title"
        value={db.title ?? ''}
        placeholder={t('untitledDatabase')}
        aria-label={t('databaseName')}
        maxLength={200}
        onChange={(e) => commit({ ...db, title: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      <div className="docs-db-header">
        <div className="docs-db-tabs" role="tablist" aria-label={t('views')}>
          {db.views.map((v) => {
            const on = v.id === view.id;
            return (
              <div key={v.id} className={`docs-db-tab${on ? ' active' : ''}`}>
                {on && renaming ? (
                  <input
                    className="docs-db-tab-input"
                    autoFocus
                    aria-label={t('viewName')}
                    defaultValue={v.name}
                    placeholder={t(`viewTypes.${v.type}`)}
                    maxLength={100}
                    onBlur={(e) => {
                      commit(updateView(db, v.id, { name: e.target.value.trim() }));
                      setRenaming(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') {
                        e.stopPropagation();
                        setRenaming(false);
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={on}
                    className="docs-db-tab-btn"
                    onClick={(e) => {
                      if (on) setPop({ kind: 'viewMenu', anchor: e.currentTarget });
                      else commit({ ...db, active_view: v.id });
                    }}
                    onDoubleClick={() => on && setRenaming(true)}
                  >
                    <DocsGlyph name={VIEW_GLYPH[v.type]} size={13} />
                    <span>{viewName(v)}</span>
                  </button>
                )}
              </div>
            );
          })}
          <button
            type="button"
            className="docs-db-tab-add"
            aria-label={t('addView')}
            title={t('addView')}
            disabled={db.views.length >= DB_MAX_VIEWS}
            onClick={(e) => setPop({ kind: 'addView', anchor: e.currentTarget })}
          >
            <DocsGlyph name="plus" size={13} />
          </button>
        </div>
        <div className="docs-db-tools">
          {toolButton('filter', 'filter', t('filter'), filters.length)}
          {toolButton('sort', 'sort', t('sort'), sorts.length)}
          {view.type !== 'gallery' && toolButton('group', 'group', view.type === 'board' ? t('boardColumns') : t('group'), view.type === 'table' && groupProp ? 1 : 0)}
          {toolButton('props', 'eye', t('properties'), view.hidden?.length ?? 0)}
          <button type="button" className="docs-db-new" onClick={() => newRow(null)} disabled={db.rows.length >= DB_MAX_ROWS}>
            {t('new')}
          </button>
        </div>
      </div>

      {view.type === 'board' ? (
        <DbBoard
          db={db}
          rows={rows}
          groupProp={groupProp}
          props={visible.filter((p) => p.type !== 'title' && p.id !== groupProp?.id)}
          people={people}
          onOpen={openRow}
          onMove={(rowId, toKey, fromKey, beforeId) => {
            const row = findRow(db, rowId);
            if (!row || !groupProp) return;
            let next = toKey === fromKey ? db : setCell(db, rowId, groupProp.id, valueForGroup(groupProp, row, toKey, fromKey));
            // Sin orden en la vista, soltar sobre una tarjeta también ordena a mano.
            if (!sorts.length) next = moveRow(next, rowId, beforeId);
            if (next !== db) commit(next);
          }}
          onAdd={(key) => newRow(key)}
          onPickGroup={(anchor) => setPop({ kind: 'group', anchor })}
        />
      ) : view.type === 'gallery' ? (
        renderGallery()
      ) : (
        <>
          <DbTable
            db={db}
            rows={rows}
            props={visible}
            groupProp={groupProp}
            widths={view.widths}
            members={members}
            people={people}
            focusRequest={focusRequest}
            onCell={onCell}
            onCreateOption={onCreateOption}
            onAddRow={newRow}
            onDeleteRow={(rowId) => commit(deleteRows(db, [rowId]))}
            onOpenRow={openRow}
            onWidth={(propId, w) => commit(updateView(db, view.id, { widths: { ...(view.widths ?? {}), [propId]: w } }))}
            onHeader={(propId, anchor) => setPop({ kind: 'propMenu', anchor, propId })}
            onAddProperty={(anchor) => setPop({ kind: 'addProp', anchor })}
            onFocusBlock={() => onFocus(index)}
          />
          {rows.length === 0 && db.rows.length > 0 && (
            <p className="docs-db-empty">
              {t('noMatches')}{' '}
              <button type="button" className="docs-db-link-btn" onClick={() => commit(updateView(db, view.id, { filters: [] }))}>
                {t('clearFilters')}
              </button>
            </p>
          )}
        </>
      )}

      {pop && (
        <DbPopover
          anchor={pop.anchor}
          onClose={close}
          label={pop.kind}
          width={pop.kind === 'filter' || pop.kind === 'sort' ? 460 : pop.kind === 'propMenu' ? 280 : 240}
          className={`docs-db-popover-${pop.kind}`}
        >
          {pop.kind === 'filter' && <DbFilterPanel db={db} view={view} members={members} commit={commit} />}
          {pop.kind === 'sort' && <DbSortPanel db={db} view={view} commit={commit} />}
          {pop.kind === 'group' && <DbGroupPanel db={db} view={view} commit={commit} onCreateStatus={addStatusProperty} />}
          {pop.kind === 'props' && (
            <DbPropertiesPanel db={db} view={view} commit={commit} onNewProperty={(anchor) => setPop({ kind: 'addProp', anchor })} />
          )}
          {pop.kind === 'addProp' && <PropertyTypeList onPick={createProperty} />}
          {pop.kind === 'propMenu' && (
            <DbPropertyMenu
              db={db}
              view={view}
              propId={pop.propId}
              members={members}
              commit={commit}
              onClose={close}
              onFilter={(propId) => {
                const prop = db.properties.find((p) => p.id === propId);
                if (prop) commit(updateView(db, view.id, { filters: [...filters, newFilter(prop)] }));
                setPop({ kind: 'filter', anchor: pop.anchor });
              }}
            />
          )}
          {pop.kind === 'addView' && (
            <div className="docs-db-menu" role="menu" aria-label={t('addView')}>
              {(['table', 'board', 'gallery'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  role="menuitem"
                  className="docs-db-menu-item"
                  onClick={() => {
                    commit(addView(db, type).db);
                    close();
                  }}
                >
                  <DocsGlyph name={VIEW_GLYPH[type]} size={14} />
                  {t(`viewTypes.${type}`)}
                </button>
              ))}
            </div>
          )}
          {pop.kind === 'viewMenu' && (
            <div className="docs-db-menu" role="menu" aria-label={viewName(view)}>
              <p className="docs-db-menu-label">{t('layout')}</p>
              {(['table', 'board', 'gallery'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  role="menuitemradio"
                  aria-checked={view.type === type}
                  className={`docs-db-menu-item${view.type === type ? ' on' : ''}`}
                  onClick={() => {
                    const patch: Partial<typeof view> = { type };
                    // Board sin columnas: toma la primera propiedad agrupable.
                    if (type === 'board' && !groupProp) patch.group_by = addView(db, 'board').view.group_by;
                    commit(updateView(db, view.id, patch));
                    close();
                  }}
                >
                  <DocsGlyph name={VIEW_GLYPH[type]} size={14} />
                  {t(`viewTypes.${type}`)}
                </button>
              ))}
              <span className="docs-db-menu-sep" role="separator" />
              <button
                type="button"
                role="menuitem"
                className="docs-db-menu-item"
                onClick={() => {
                  close();
                  setRenaming(true);
                }}
              >
                {t('renameView')}
              </button>
              <button
                type="button"
                role="menuitem"
                className="docs-db-menu-item"
                disabled={db.views.length >= DB_MAX_VIEWS}
                onClick={() => {
                  commit(duplicateView(db, view.id));
                  close();
                }}
              >
                {t('duplicateView')}
              </button>
              <button
                type="button"
                role="menuitem"
                className="docs-db-menu-item"
                disabled={db.views.length <= 1}
                onClick={() => {
                  commit(removeView(db, view.id));
                  close();
                }}
              >
                {t('deleteView')}
              </button>
            </div>
          )}
        </DbPopover>
      )}
    </div>
  );
}
