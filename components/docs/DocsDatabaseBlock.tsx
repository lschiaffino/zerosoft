'use client';

import DocsSyncBanner from './DocsSyncBanner';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { DbLinkedSource, DbPropertyType, DbValue, DbViewConfig, DbViewType, DocsBlock, DocsDatabase } from '@/lib/docs-types';
import {
  DB_MAX_PROPERTIES,
  DB_MAX_ROWS,
  DB_MAX_VIEWS,
  activeView,
  addProperty,
  addRow,
  addRowFromTemplate,
  cardHidesValue,
  cellValue,
  removeRowTemplate,
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
  viewDefaults,
  viewRows,
  visibleProperties,
} from '@/lib/docs-database';
import { applyDbOps, diffDatabase } from '@/lib/docs-db-ops';
import { exportCsv } from '@/lib/docs-db-csv';
import { dbKey } from '@/lib/docs-db-compute';
import DocsGlyph, { type DocsGlyphName } from './DocsGlyphs';
import DbPopover from './database/DbPopover';
import DbGlyph, { type DbGlyphName } from './database/DbGlyph';
import DbTable, { type DbFocusRequest } from './database/DbTable';
import DbBoard from './database/DbBoard';
import DbValueView from './database/DbValueView';
import DbPropertyMenu, { PropertyTypeList, typeKey } from './database/DbPropertyMenu';
import { DbFilterPanel, DbGroupPanel, DbPropertiesPanel, DbSortPanel, newFilter } from './database/DbToolbar';
import { DbCalendar, DbList, DbTimeline, type DbZoom } from './database/DbViews';
import { DbAutomationsPanel } from './database/DbActions';
import { DbCsvImport, downloadCsv } from './database/DbCsv';
import { peopleMap, useDbMembers } from './database/useDbMembers';
import { useDbRuntime, withAutomations, type DbSource } from './database/useDbRuntime';
import { useAutofill, type AutofillError } from './database/useAutofill';
import { publishLocal, sendOps, useSources, useWorkspaceDatabases } from './database/dbSources';

export type DbOpenMode = 'peek' | 'full';

/** Lo que el editor de la página le da a las bases. */
export interface DbHooks {
  /** Abrir una fila como página (panel lateral o página completa); lo pinta el editor. */
  onOpenRow: (blockId: string, rowId: string, mode: DbOpenMode) => void;
  /** De dónde salen los miembros para las propiedades persona. */
  membersUrl: string | null;
  /** Página de Docs abierta (null en Notes: sin relaciones a otras páginas). */
  pageId?: string | null;
  /** Cambiar otra base de esta página (relaciones de dos vías, vistas vinculadas). */
  updateDatabase?: (blockId: string, fn: (db: DocsDatabase) => DocsDatabase) => void;
}

interface DocsDatabaseBlockProps {
  block: DocsBlock;
  index: number;
  onChange: (index: number, patch: Partial<DocsBlock>) => void;
  onFocus: (index: number) => void;
  /** @deprecated: usar `hooks`. */
  onOpenRow?: DbHooks['onOpenRow'];
  /** @deprecated: usar `hooks`. */
  membersUrl?: string | null;
  hooks?: DbHooks;
}

type Pop =
  | { kind: 'filter' | 'sort' | 'group' | 'props' | 'addProp' | 'addView' | 'viewMenu' | 'more' | 'automations' | 'csv' | 'datePick' | 'templates'; anchor: HTMLElement }
  | { kind: 'propMenu'; anchor: HTMLElement; propId: string };

const VIEW_TYPES: DbViewType[] = ['table', 'board', 'gallery', 'list', 'calendar', 'timeline'];
const VIEW_GLYPH: Record<DbViewType, DbGlyphName> = {
  table: 'table',
  board: 'board',
  gallery: 'gallery',
  list: 'list',
  calendar: 'calendar',
  timeline: 'timeline',
};
const GALLERY_PAGE = 60;

/** Saca lo que solo existe en memoria (tipo calculado y error de fórmula) antes de guardar. */
function stripTransient(db: DocsDatabase): DocsDatabase {
  if (!db.properties.some((p) => p.kind !== undefined || p.error !== undefined)) return db;
  return {
    ...db,
    properties: db.properties.map((p) => {
      if (p.kind === undefined && p.error === undefined) return p;
      const { kind: _k, error: _e, ...rest } = p;
      void _k;
      void _e;
      return rest;
    }),
  };
}

/**
 * Bloque base de datos, estilo Notion: propiedades tipadas (con fórmulas,
 * relaciones, rollups, archivos, botones e IA), vistas con pestañas (tabla,
 * board, galería, lista, calendario, timeline) que guardan filtro, orden,
 * agrupado y propiedades visibles, filas que se abren como página,
 * automatizaciones y CSV. Una vista vinculada muestra otra base con sus
 * propias vistas.
 */
export default function DocsDatabaseBlock(props: DocsDatabaseBlockProps) {
  const hooks: DbHooks = props.hooks ?? { onOpenRow: props.onOpenRow ?? (() => {}), membersUrl: props.membersUrl ?? null };
  if (props.block.linked) return <DbLinkedBlock {...props} hooks={hooks} />;
  return <DbOwnBlock {...props} hooks={hooks} />;
}

function DbOwnBlock({ block, index, onChange, onFocus, hooks }: DocsDatabaseBlockProps & { hooks: DbHooks }) {
  const db = normalizeDatabase(block);
  const pageId = hooks.pageId ?? null;
  // Las otras bases de la página (relaciones, vistas vinculadas) la ven al instante.
  useEffect(() => {
    publishLocal(pageId, block.id, db);
  }, [pageId, block.id, db]);
  useEffect(() => () => publishLocal(pageId, block.id, null), [pageId, block.id]);
  const commit = useCallback((next: DocsDatabase) => onChange(index, databasePatch(next)), [index, onChange]);
  const source = useMemo(() => ({ pageId, blockId: block.id }), [pageId, block.id]);
  return (
    <DbView
      db={db}
      commitData={commit}
      source={source}
      hostPageId={pageId}
      hooks={hooks}
      index={index}
      onFocus={onFocus}
      membersUrl={hooks.membersUrl}
      // Base sincronizada (GitHub, Jira, Salesforce, CRM): filas de solo lectura.
      editable={!db.sync}
      linkedHeader={db.sync ? <DocsSyncBanner db={db} canEdit onDb={commit} /> : undefined}
      openRow={(rowId, mode) => hooks.onOpenRow(block.id, rowId, mode)}
    />
  );
}

/** Vista vinculada: elige la base de origen y la muestra con las vistas de este bloque. */
function DbLinkedBlock({ block, index, onChange, onFocus, hooks }: DocsDatabaseBlockProps & { hooks: DbHooks }) {
  const t = useTranslations('docs.database');
  const linked = block.linked as DbLinkedSource;
  const hostPageId = hooks.pageId ?? null;
  const picking = linked.page_id === '_pick';
  const sources = useSources(hostPageId, picking ? [] : [{ page_id: linked.page_id, block_id: linked.block_id }]);
  const src = picking ? null : sources[dbKey(linked.page_id, linked.block_id)];
  const sourceDb = src?.db ?? null;

  const merged = useMemo<DocsDatabase | null>(
    () => (sourceDb ? { ...sourceDb, views: linked.views, active_view: linked.active_view } : null),
    [sourceDb, linked.views, linked.active_view],
  );
  const setLinked = (patch: Partial<DbLinkedSource>) => onChange(index, { linked: { ...linked, ...patch } });

  const commitData = useCallback(
    (next: DocsDatabase) => {
      if (!sourceDb) return;
      const viewsChanged = JSON.stringify(next.views) !== JSON.stringify(linked.views) || next.active_view !== linked.active_view;
      if (viewsChanged) onChange(index, { linked: { ...linked, views: next.views, active_view: next.active_view } });
      const dataNext = { ...next, views: sourceDb.views, active_view: sourceDb.active_view };
      const ops = diffDatabase(sourceDb, dataNext);
      if (!ops.length) return;
      if (hostPageId && linked.page_id === hostPageId && hooks.updateDatabase) hooks.updateDatabase(linked.block_id, (d) => withAutomations(d, applyDbOps(d, ops)));
      else void sendOps(linked.page_id, linked.block_id, ops);
    },
    [sourceDb, linked, onChange, index, hostPageId, hooks],
  );

  const source = useMemo(() => ({ pageId: linked.page_id, blockId: linked.block_id }), [linked.page_id, linked.block_id]);

  if (picking) {
    return (
      <div className="docs-db-wrap" data-index={index} data-testid="docs-database-linked" onFocus={() => onFocus(index)}>
        <DbLinkedPicker
          hostPageId={hostPageId}
          ownBlockId={block.id}
          onPick={(page_id, block_id) => setLinked({ page_id, block_id })}
        />
      </div>
    );
  }
  if (!merged) {
    return (
      <div className="docs-db-wrap" data-index={index} data-testid="docs-database-linked" onFocus={() => onFocus(index)}>
        {src?.status === 'error' ? (
          <div className="docs-db-board-empty">
            <p>{src.error === 'not_found' ? t('linked.gone') : t('linked.loadError')}</p>
            <button type="button" className="docs-table-add" onClick={() => setLinked({ page_id: '_pick', block_id: '_pick' })}>
              {t('linked.pickOther')}
            </button>
          </div>
        ) : (
          <p className="docs-db-empty" role="status">
            {t('relation.loading')}
          </p>
        )}
      </div>
    );
  }
  const href = `/app/docs/${linked.page_id}`;
  return (
    <DbView
      db={merged}
      commitData={commitData}
      source={source}
      hostPageId={hostPageId}
      hooks={hooks}
      index={index}
      onFocus={onFocus}
      membersUrl={`/api/docs/members?page=${encodeURIComponent(linked.page_id)}`}
      editable={src?.access !== 'view' && !sourceDb?.sync}
      linkedHeader={
        <a className="docs-db-linked-src" href={href} title={t('linked.openSource')}>
          <DocsGlyph name="peek" size={12} />
          {src?.page?.title || t('untitledPage')}
        </a>
      }
      openRow={(rowId, mode) => {
        if (hostPageId && linked.page_id === hostPageId) hooks.onOpenRow(linked.block_id, rowId, mode);
        else window.location.assign(`${href}?row=${encodeURIComponent(rowId)}`);
      }}
      testId="docs-database-linked"
    />
  );
}

/** Elegir la base de una vista vinculada (de esta página o de otra del workspace). */
function DbLinkedPicker({ hostPageId, ownBlockId, onPick }: { hostPageId: string | null; ownBlockId: string; onPick: (pageId: string, blockId: string) => void }) {
  const t = useTranslations('docs.database');
  const dbs = useWorkspaceDatabases(true);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const rows = dbs.rows.filter((d) => !(d.page_id === hostPageId && d.block_id === ownBlockId)).filter((d) => `${d.title} ${d.page_title}`.toLowerCase().includes(q.trim().toLowerCase()));
  const sel = Math.min(active, Math.max(0, rows.length - 1));
  const listId = `docs-linked-${ownBlockId}`;
  return (
    <div className="docs-db-linked-pick" role="group" aria-label={t('linked.pick')}>
      <p className="docs-db-menu-label">{t('linked.pick')}</p>
      {/* Como el selector de Notion: se escribe, ↑/↓ mueven y Enter elige. */}
      <input
        className="docs-db-picker-input"
        autoFocus
        role="combobox"
        aria-expanded={rows.length > 0}
        aria-controls={listId}
        aria-activedescendant={rows[sel] ? `${listId}-${sel}` : undefined}
        placeholder={t('linked.search')}
        aria-label={t('linked.search')}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            if (rows.length) setActive((sel + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            const d = rows[sel];
            if (d) onPick(d.page_id, d.block_id);
          }
        }}
      />
      {dbs.status === 'loading' && <p className="docs-db-option-empty">{t('relation.loading')}</p>}
      {dbs.status === 'error' && (
        <p className="docs-db-error">
          {t('relation.loadError')}{' '}
          <button type="button" className="docs-db-link-btn" onClick={dbs.reload}>
            {t('linked.retry')}
          </button>
        </p>
      )}
      {dbs.status === 'ready' && rows.length === 0 && <p className="docs-db-option-empty">{t('linked.none')}</p>}
      <div className="docs-db-options" role="listbox" id={listId} aria-label={t('linked.pick')}>
        {rows.map((d, i) => (
          <button
            key={`${d.page_id}:${d.block_id}`}
            id={`${listId}-${i}`}
            type="button"
            role="option"
            aria-selected={i === sel}
            tabIndex={-1}
            className={`docs-db-option${i === sel ? ' sel' : ''}`}
            onMouseEnter={() => setActive(i)}
            onClick={() => onPick(d.page_id, d.block_id)}
          >
            <DocsGlyph name="database" size={14} />
            <span className="docs-db-option-label">{d.title || t('untitledDatabase')}</span>
            <span className="docs-db-option-sub">{d.page_title || t('untitledPage')}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

interface DbViewProps {
  db: DocsDatabase;
  /** Guarda la base (filas, propiedades y vistas). */
  commitData: (next: DocsDatabase) => void;
  source: DbSource;
  hostPageId: string | null;
  hooks: DbHooks;
  index: number;
  onFocus: (index: number) => void;
  membersUrl: string | null;
  editable: boolean;
  openRow: (rowId: string, mode: DbOpenMode) => void;
  linkedHeader?: ReactNode;
  testId?: string;
}

function DbView({ db, commitData, source, hostPageId, hooks, index, onFocus, membersUrl, editable, openRow: openRowRaw, linkedHeader, testId = 'docs-database' }: DbViewProps) {
  const t = useTranslations('docs.database');
  const locale = useLocale();
  const view = activeView(db);
  const members = useDbMembers(membersUrl);
  const people = useMemo(() => peopleMap(members), [members]);
  const [pop, setPop] = useState<Pop | null>(null);
  const [focusRequest, setFocusRequest] = useState<DbFocusRequest | null>(null);
  const [galleryLimit, setGalleryLimit] = useState(GALLERY_PAGE);
  const [renaming, setRenaming] = useState(false);

  /** Guardar: sin lo que vive solo en memoria y con las automatizaciones aplicadas. */
  const commit = useCallback((next: DocsDatabase) => commitData(withAutomations(db, stripTransient(next))), [commitData, db]);
  const close = () => setPop(null);

  const labels = useMemo(() => ({ untitled: t('untitledRow'), error: t('formula.errorShort'), openMap: t('place.openMap') }), [t]);
  const runtime = useDbRuntime(
    { db, source, hostPageId, commit, updateDatabase: hooks.updateDatabase, people, locale, labels },
    { buttonDone: t('button.done'), buttonError: t('button.failed'), writeError: t('relation.writeError') },
  );
  const { shown, refs, extras, notice, setNotice } = runtime;
  const rowTitles = useMemo(() => refs.titles ?? {}, [refs.titles]);

  const aiError = (code: AutofillError) =>
    setNotice({ kind: 'error', text: code === 'ai_disabled' ? t('ai.disabled') : code === 'quota_exceeded' ? t('ai.quota') : code === 'rate_limited' ? t('ai.rateLimited') : t('ai.failed') });
  const autofill = useAutofill({ db, shown, source, commit, people, rowTitles, editable, onError: aiError });

  const ctx = useMemo(() => ({ people, locale, rowTitles }), [people, locale, rowTitles]);
  const rows = useMemo(() => viewRows(shown, view, ctx), [shown, view, ctx]);
  const visible = useMemo(() => visibleProperties({ properties: shown.properties }, view), [shown.properties, view]);
  const groupProp = groupProperty(shown, view);
  const subGroupProp = view.type === 'board' && view.sub_group_by ? groupProperty(shown, { ...view, group_by: view.sub_group_by }) : null;
  const title = titleProperty(db);
  /** La base para los paneles (vista, filtro): la original con el tipo calculado de fórmulas y rollups. */
  const panelDb = useMemo<DocsDatabase>(() => ({ ...db, properties: shown.properties }), [db, shown.properties]);
  const dateProp = view.date_by ? shown.properties.find((p) => p.id === view.date_by) ?? null : null;
  const endProp = view.end_by ? shown.properties.find((p) => p.id === view.end_by) ?? null : null;

  const openRow = useCallback((rowId: string, mode: DbOpenMode = 'peek') => openRowRaw(rowId, mode), [openRowRaw]);

  /** Fila nueva con los valores de los filtros (y del grupo); en la tabla entra a editar el título. */
  const newRow = (groupKey: string | null, extra: Record<string, DbValue> = {}, subKey?: string) => {
    if (db.rows.length >= DB_MAX_ROWS || !editable) return;
    const values: Record<string, DbValue> = { ...filterDefaults(db, view), ...extra };
    const blank = { id: '', values, created_at: '', updated_at: '' };
    if (groupProp && groupKey !== null) {
      const v = valueForGroup(groupProp, blank, groupKey, null);
      if (v !== null && !(Array.isArray(v) && v.length === 0)) values[groupProp.id] = v;
      // Columna "Sin estado": la fila nueva queda sin estado (no el de por defecto).
      else values[groupProp.id] = null;
    }
    if (subGroupProp && subKey !== undefined) {
      const v = valueForGroup(subGroupProp, blank, subKey, null);
      if (v !== null && !(Array.isArray(v) && v.length === 0)) values[subGroupProp.id] = v;
      else values[subGroupProp.id] = null;
    }
    const { db: next, row } = addRow(db, values);
    commit(next);
    onFocus(index);
    if (view.type === 'table') setFocusRequest({ rowId: row.id, propId: title.id, edit: true, tick: Date.now() });
    else openRow(row.id, 'peek');
  };

  /** Fila nueva desde una plantilla de la base: se abre en el panel lateral. */
  const newRowFromTemplate = (templateId: string) => {
    if (db.rows.length >= DB_MAX_ROWS || !editable) return;
    const res = addRowFromTemplate(db, templateId, filterDefaults(db, view));
    if (!res) return;
    commit(res.db);
    close();
    onFocus(index);
    openRow(res.row.id, 'peek');
  };

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
    // Recién creada: se abre su menú para nombrarla (y configurarla).
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

  /** Propiedad fecha nueva para el calendario o la timeline. */
  const addDateProperty = () => {
    if (db.properties.length >= DB_MAX_PROPERTIES) return;
    const { db: withProp, property } = addProperty(db, 'date', t('types.date'));
    commit(updateView(withProp, view.id, { date_by: property.id }));
    close();
  };

  /** Nombre del popover para lectores de pantalla (traducido, no la clave interna). */
  const popLabel = (p: Pop): string => {
    switch (p.kind) {
      case 'propMenu':
        return shown.properties.find((x) => x.id === p.propId)?.name || t('untitledProperty');
      case 'filter':
        return t('filter');
      case 'sort':
        return t('sort');
      case 'group':
        return t('group');
      case 'props':
        return t('properties');
      case 'addProp':
        return t('addProperty');
      case 'addView':
        return t('addView');
      case 'viewMenu':
        return t('layout');
      case 'more':
        return t('more.title');
      case 'automations':
        return t('automations.title');
      case 'csv':
        return t('csv.importTitle');
      case 'datePick':
        return t('calendar.pickDate');
      case 'templates':
        return t('templates.title');
      default:
        return '';
    }
  };

  const toolButton = (kind: 'filter' | 'sort' | 'group' | 'props' | 'more', glyph: DocsGlyphName, label: string, count = 0) => (
    <button
      type="button"
      className={`docs-db-tool${count ? ' on' : ''}${pop?.kind === kind ? ' open' : ''}${kind === 'more' ? ' docs-db-tool-more' : ''}`}
      aria-haspopup="dialog"
      aria-label={label}
      title={label}
      aria-expanded={pop?.kind === kind}
      data-testid={kind === 'more' ? 'docs-db-more' : undefined}
      onClick={(e) => setPop(pop?.kind === kind ? null : { kind, anchor: e.currentTarget })}
    >
      <DocsGlyph name={glyph} size={14} />
      {kind !== 'more' && <span className="docs-db-tool-label">{label}</span>}
      {count > 0 && <span className="docs-db-tool-count">{count}</span>}
    </button>
  );

  const viewName = (v: DbViewConfig) => v.name || t(`viewTypes.${v.type}`);
  const cardProps = visible.filter((p) => p.type !== 'title');

  const renderGallery = () => {
    if (rows.length === 0) return <p className="docs-db-empty">{db.rows.length ? t('noMatches') : t('emptyGallery')}</p>;
    return (
      <>
        <div className="docs-db-gallery" role="list">
          {rows.slice(0, galleryLimit).map((row) => {
            const name = rowTitle(shown, row);
            return (
              <div key={row.id} role="listitem" className="docs-db-card" onClick={() => openRow(row.id)}>
                <button type="button" className={`docs-db-card-title${name ? '' : ' empty'}`} onClick={(e) => {
                  e.stopPropagation();
                  openRow(row.id);
                }}>
                  {name || t('untitledRow')}
                </button>
                {/* Como Notion: la tarjeta muestra solo las propiedades con valor. */}
                {cardProps.filter((p) => p.type === 'button' || !cardHidesValue(p, cellValue(p, row))).map((p) => (
                  <span key={p.id} className="docs-db-prop">
                    <span className="docs-db-prop-label">{p.name}</span>
                    <span className="docs-db-prop-value">
                      <DbValueView prop={p} row={row} people={people} locale={locale} links={false} refs={refs} />
                    </span>
                  </span>
                ))}
              </div>
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
  const dateChoices = shown.properties.filter((p) => p.type === 'date' || p.type === 'created_time' || p.type === 'last_edited_time' || (p.type === 'formula' && p.kind === 'date'));

  const exportName = db.title || t('untitledDatabase');

  const renderView = () => {
    switch (view.type) {
      case 'board':
        return (
          <DbBoard
            db={shown}
            rows={rows}
            groupProp={groupProp}
            subGroupProp={subGroupProp}
            props={visible.filter((p) => p.type !== 'title' && p.id !== groupProp?.id && p.id !== subGroupProp?.id)}
            people={people}
            refs={refs}
            onOpen={openRow}
            onMove={(rowId, toKey, fromKey, beforeId, sub) => {
              const row = findRow(db, rowId);
              if (!row || !groupProp || !editable) return;
              let next = toKey === fromKey ? db : setCell(db, rowId, groupProp.id, valueForGroup(groupProp, row, toKey, fromKey));
              if (sub && subGroupProp && sub.to !== sub.from) {
                const r2 = findRow(next, rowId)!;
                next = setCell(next, rowId, subGroupProp.id, valueForGroup(subGroupProp, r2, sub.to, sub.from));
              }
              // Sin orden en la vista, soltar sobre una tarjeta también ordena a mano.
              if (!sorts.length) next = moveRow(next, rowId, beforeId);
              if (next !== db) commit(next);
            }}
            onAdd={(key, sub) => newRow(key, {}, sub)}
            onPickGroup={(anchor) => setPop({ kind: 'group', anchor })}
          />
        );
      case 'gallery':
        return renderGallery();
      case 'list':
        return <DbList db={shown} rows={rows} props={cardProps} people={people} refs={refs} onOpen={openRow} onAdd={() => newRow(null)} canAdd={editable && db.rows.length < DB_MAX_ROWS} />;
      case 'calendar':
        return (
          <DbCalendar
            db={shown}
            rows={rows}
            props={cardProps.filter((p) => p.id !== dateProp?.id)}
            people={people}
            refs={refs}
            onOpen={openRow}
            dateProp={dateProp}
            editable={editable}
            onMove={(rowId, day) => dateProp && commit(setCell(db, rowId, dateProp.id, day))}
            onAdd={(day) => dateProp && newRow(null, { [dateProp.id]: day })}
            onPickDate={(anchor) => setPop({ kind: 'datePick', anchor })}
          />
        );
      case 'timeline':
        return (
          <DbTimeline
            db={shown}
            rows={rows}
            onOpen={openRow}
            startProp={dateProp}
            endProp={endProp}
            zoom={(view.zoom ?? 'month') as DbZoom}
            onZoom={(zoom) => commit(updateView(db, view.id, { zoom }))}
            editable={editable}
            onSetRange={(rowId, start, end) => {
              if (!dateProp) return;
              let next = setCell(db, rowId, dateProp.id, start);
              if (endProp && end) next = setCell(next, rowId, endProp.id, end);
              commit(next);
            }}
            onPickDate={(anchor) => setPop({ kind: 'datePick', anchor })}
          />
        );
      default:
        return (
          <>
            <DbTable
              db={shown}
              rows={rows}
              props={visible}
              groupProp={groupProp}
              widths={view.widths}
              members={members}
              people={people}
              focusRequest={focusRequest}
              refs={refs}
              extras={extras}
              onCell={runtime.setValue}
              onCreateOption={onCreateOption}
              onAddRow={newRow}
              readOnly={!editable}
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
        );
    }
  };

  return (
    <div className={`docs-db-wrap${editable ? '' : ' is-readonly'}`} data-index={index} data-testid={testId} data-view={view.type} onFocus={() => onFocus(index)}>
      <div className="docs-db-titlebar">
        <input
          className="docs-db-title"
          value={db.title ?? ''}
          placeholder={t('untitledDatabase')}
          aria-label={t('databaseName')}
          maxLength={200}
          readOnly={!editable}
          onChange={(e) => commit({ ...db, title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        {linkedHeader}
      </div>
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
                    <DbGlyph name={VIEW_GLYPH[v.type]} size={13} />
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
          {(view.type === 'table' || view.type === 'board') && toolButton('group', 'group', view.type === 'board' ? t('boardColumns') : t('group'), view.type === 'table' && groupProp ? 1 : 0)}
          {toolButton('props', 'eye', t('properties'), view.hidden?.length ?? 0)}
          {toolButton('more', 'more', t('more.title'))}
          {editable && (
            <span className="docs-db-new-group">
              <button type="button" className="docs-db-new" onClick={() => newRow(null)} disabled={db.rows.length >= DB_MAX_ROWS}>
                {t('new')}
              </button>
              <button
                type="button"
                className="docs-db-new docs-db-new-more"
                aria-label={t('templates.open')}
                title={t('templates.open')}
                aria-haspopup="menu"
                aria-expanded={pop?.kind === 'templates'}
                data-testid="docs-db-templates"
                onClick={(e) => setPop({ kind: 'templates', anchor: e.currentTarget })}
              >
                <DocsGlyph name="down" size={12} />
              </button>
            </span>
          )}
        </div>
      </div>

      {renderView()}

      {notice && (
        <p className={`docs-db-notice${notice.kind === 'error' ? ' is-error' : ''}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
          {notice.text}
          <button type="button" className="docs-db-remove" aria-label={t('closeNotice')} onClick={() => setNotice(null)}>
            ×
          </button>
        </p>
      )}

      {pop && (
        <DbPopover
          // Otro popover (p. ej. de "agregar propiedad" al menú de la nueva): se vuelve a montar y toma el foco.
          key={pop.kind === 'propMenu' ? `propMenu:${pop.propId}` : pop.kind}
          anchor={pop.anchor}
          onClose={close}
          label={popLabel(pop)}
          width={pop.kind === 'filter' || pop.kind === 'sort' ? 460 : pop.kind === 'propMenu' ? 320 : pop.kind === 'automations' || pop.kind === 'csv' ? 440 : 240}
          className={`docs-db-popover-${pop.kind}`}
        >
          {pop.kind === 'filter' && <DbFilterPanel db={panelDb} view={view} members={members} commit={commit} />}
          {pop.kind === 'sort' && <DbSortPanel db={panelDb} view={view} commit={commit} />}
          {pop.kind === 'group' && <DbGroupPanel db={panelDb} view={view} commit={commit} onCreateStatus={addStatusProperty} />}
          {pop.kind === 'props' && <DbPropertiesPanel db={panelDb} view={view} commit={commit} onNewProperty={(anchor) => setPop({ kind: 'addProp', anchor })} />}
          {pop.kind === 'addProp' && <PropertyTypeList onPick={createProperty} docsOnly={Boolean(source.pageId)} />}
          {pop.kind === 'propMenu' && (
            <DbPropertyMenu
              db={panelDb}
              view={view}
              propId={pop.propId}
              members={members}
              commit={commit}
              onClose={close}
              source={source}
              runtime={runtime}
              env={runtime.env}
              filling={autofill.filling === pop.propId}
              onAutofill={(propId, onlyEmpty) => void autofill.fill(propId, null, onlyEmpty)}
              onFilter={(propId) => {
                const prop = shown.properties.find((p) => p.id === propId);
                if (prop) commit(updateView(db, view.id, { filters: [...filters, newFilter(prop)] }));
                setPop({ kind: 'filter', anchor: pop.anchor });
              }}
            />
          )}
          {pop.kind === 'templates' && (
            <div className="docs-db-menu" role="menu" aria-label={t('templates.title')}>
              <p className="docs-db-menu-label">{t('templates.title')}</p>
              {(db.templates ?? []).map((tpl) => (
                <div key={tpl.id} className="docs-db-template-row">
                  <button
                    type="button"
                    role="menuitem"
                    className="docs-db-menu-item"
                    disabled={db.rows.length >= DB_MAX_ROWS}
                    onClick={() => newRowFromTemplate(tpl.id)}
                  >
                    <DocsGlyph name="template" size={14} />
                    {tpl.name || t('templates.untitled')}
                  </button>
                  <button
                    type="button"
                    className="docs-db-icon-btn"
                    aria-label={t('templates.delete', { name: tpl.name || t('templates.untitled') })}
                    title={t('templates.delete', { name: tpl.name || t('templates.untitled') })}
                    onClick={() => commit(removeRowTemplate(db, tpl.id))}
                  >
                    <DocsGlyph name="trash" size={13} />
                  </button>
                </div>
              ))}
              {!(db.templates ?? []).length && <p className="docs-db-menu-empty">{t('templates.empty')}</p>}
              {!!(db.templates ?? []).length && <p className="docs-db-menu-hint">{t('templates.hint')}</p>}
            </div>
          )}
          {pop.kind === 'addView' && (
            <div className="docs-db-menu" role="menu" aria-label={t('addView')}>
              {VIEW_TYPES.map((type) => (
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
                  <DbGlyph name={VIEW_GLYPH[type]} size={14} />
                  {t(`viewTypes.${type}`)}
                </button>
              ))}
            </div>
          )}
          {pop.kind === 'datePick' && (
            <div className="docs-db-panel" aria-label={t('calendar.pickDate')}>
              <label className="docs-db-row-field">
                <span>{view.type === 'timeline' ? t('timeline.start') : t('calendar.dateBy')}</span>
                <select className="docs-db-select" data-autofocus value={view.date_by ?? ''} onChange={(e) => commit(updateView(db, view.id, { date_by: e.target.value || null }))}>
                  <option value="">{t('pickProperty')}</option>
                  {dateChoices.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name || t('untitledProperty')}
                    </option>
                  ))}
                </select>
              </label>
              {editable && (
                <button type="button" className="docs-db-link-btn" onClick={addDateProperty}>
                  <DocsGlyph name="plus" size={12} />
                  {t('calendar.addDateProperty')}
                </button>
              )}
            </div>
          )}
          {pop.kind === 'viewMenu' && (
            <div className="docs-db-menu" role="menu" aria-label={viewName(view)}>
              <p className="docs-db-menu-label">{t('layout')}</p>
              {VIEW_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  role="menuitemradio"
                  aria-checked={view.type === type}
                  className={`docs-db-menu-item${view.type === type ? ' on' : ''}`}
                  onClick={() => {
                    commit(updateView(db, view.id, { type, ...viewDefaults(db, type, view) }));
                    close();
                  }}
                >
                  <DbGlyph name={VIEW_GLYPH[type]} size={14} />
                  {t(`viewTypes.${type}`)}
                </button>
              ))}
              {(view.type === 'calendar' || view.type === 'timeline') && (
                <div className="docs-db-panel docs-db-panel-inline">
                  <label className="docs-db-row-field">
                    <span>{view.type === 'timeline' ? t('timeline.start') : t('calendar.dateBy')}</span>
                    <select className="docs-db-select" value={view.date_by ?? ''} onChange={(e) => commit(updateView(db, view.id, { date_by: e.target.value || null }))}>
                      <option value="">{t('pickProperty')}</option>
                      {dateChoices.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name || t('untitledProperty')}
                        </option>
                      ))}
                    </select>
                  </label>
                  {view.type === 'timeline' && (
                    <label className="docs-db-row-field">
                      <span>{t('timeline.end')}</span>
                      <select className="docs-db-select" value={view.end_by ?? ''} onChange={(e) => commit(updateView(db, view.id, { end_by: e.target.value || null }))}>
                        <option value="">{t('timeline.noEnd')}</option>
                        {dateChoices
                          .filter((p) => p.type === 'date' && p.id !== view.date_by)
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name || t('untitledProperty')}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                </div>
              )}
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
          {pop.kind === 'more' && (
            <div className="docs-db-menu" role="menu" aria-label={t('more.title')}>
              {editable && (
                <button type="button" role="menuitem" className="docs-db-menu-item" onClick={() => setPop({ kind: 'automations', anchor: pop.anchor })}>
                  <DbGlyph name="bolt" />
                  {t('automations.title')}
                  {(db.automations?.length ?? 0) > 0 && <span className="docs-db-count">{db.automations!.length}</span>}
                </button>
              )}
              {editable && (
                <button type="button" role="menuitem" className="docs-db-menu-item" onClick={() => setPop({ kind: 'csv', anchor: pop.anchor })}>
                  <DbGlyph name="upload" />
                  {t('csv.importTitle')}
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                className="docs-db-menu-item"
                onClick={() => {
                  downloadCsv(`${exportName} - ${viewName(view)}`, exportCsv(shown, view, ctx));
                  close();
                }}
              >
                <DbGlyph name="download" />
                {t('csv.exportView')}
              </button>
              <button
                type="button"
                role="menuitem"
                className="docs-db-menu-item"
                onClick={() => {
                  downloadCsv(exportName, exportCsv(shown, null, ctx));
                  close();
                }}
              >
                <DbGlyph name="download" />
                {t('csv.exportAll')}
              </button>
            </div>
          )}
          {pop.kind === 'automations' && (
            <DbAutomationsPanel
              db={db}
              members={members}
              commit={commit}
              runsUrl={source.pageId ? `/api/docs/databases/${encodeURIComponent(source.pageId)}/${encodeURIComponent(source.blockId)}/runs` : null}
            />
          )}
          {pop.kind === 'csv' && (
            <DbCsvImport
              db={db}
              members={members}
              onClose={close}
              onImport={(next, added) => {
                commit(next);
                setNotice({ kind: 'ok', text: t('csv.imported', { n: added }) });
              }}
            />
          )}
        </DbPopover>
      )}
    </div>
  );
}
