'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocale, useTranslations } from 'next-intl';
import type { DbProperty, DbRow, DbValue, DocsBlock, DocsDatabase, DocsPage } from '@/lib/docs-types';
import { cellValue, DB_MAX_TEMPLATES, isComputedType, newDbId, normalizeDatabase, rowTitle, saveRowAsTemplate, setCell, updateProperty } from '@/lib/docs-database';
import DocsGlyph from '../DocsGlyphs';
import DbValueView, { type DbRefs } from './DbValueView';
import DbCellEditor, { POPOVER_TYPES, type DbCellExtras } from './DbCellEditor';
import { PropertyTypeIcon } from './DbPropertyMenu';
import { peopleMap, useDbMembers } from './useDbMembers';
import { useDbRuntime, withAutomations } from './useDbRuntime';
import { useAutofill } from './useAutofill';
import DbGlyph from './DbGlyph';

export type DbRowPanelMode = 'peek' | 'full';

/** Una propiedad de la fila: etiqueta y valor que se edita con click o Enter. */
function PropRow({
  prop,
  row,
  people,
  members,
  locale,
  onChange,
  onCreateOption,
  refs,
  extras,
  onAutofill,
  filling,
}: {
  prop: DbProperty;
  row: DbRow;
  people: Record<string, string>;
  members: ReturnType<typeof useDbMembers>;
  locale: string;
  onChange: (value: DbValue) => void;
  onCreateOption: (name: string) => void;
  refs?: DbRefs;
  extras?: DbCellExtras;
  onAutofill?: () => void;
  filling?: boolean;
}) {
  const t = useTranslations('docs.database');
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const computed = isComputedType(prop.type);
  const start = () => {
    if (computed) return;
    if (prop.type === 'checkbox') onChange(cellValue(prop, row) !== true);
    else setEditing(true);
  };
  const isPopover = POPOVER_TYPES.has(prop.type);
  return (
    <div className="docs-db-prow">
      <span className="docs-db-prow-label">
        <PropertyTypeIcon type={prop.type} />
        <span>{prop.name || t('untitledProperty')}</span>
      </span>
      <div
        ref={ref}
        className={`docs-db-prow-value${editing ? ' editing' : ''}${computed ? ' readonly' : ''}`}
        role="button"
        tabIndex={computed ? -1 : 0}
        aria-label={prop.name}
        aria-disabled={computed || undefined}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('a, input, button')) return;
          if (!editing) start();
        }}
        onKeyDown={(e) => {
          if (editing) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            start();
          }
        }}
      >
        {(!editing || isPopover) && (
          <span className="docs-db-cell-value">
            <DbValueView prop={prop} row={row} people={people} locale={locale} refs={refs} />
            {!computed && prop.type !== 'checkbox' && !cellValueShown(prop, row) && <span className="docs-db-placeholder">{t('emptyValue')}</span>}
          </span>
        )}
        {editing && (
          <DbCellEditor
            prop={prop}
            row={row}
            extras={extras}
            members={members}
            anchor={ref.current}
            onChange={onChange}
            onCreateOption={onCreateOption}
            onExit={() => {
              setEditing(false);
              requestAnimationFrame(() => ref.current?.focus());
            }}
          />
        )}
      </div>
      {onAutofill && (
        <button type="button" className="docs-db-ai-btn" disabled={filling} onClick={onAutofill} aria-label={t('ai.fillRow', { name: prop.name })} title={t('ai.fillRow', { name: prop.name })} data-testid="docs-db-ai-row">
          <DbGlyph name="sparkle" size={13} />
        </button>
      )}
    </div>
  );
}

function cellValueShown(prop: DbProperty, row: DbRow): boolean {
  if (prop.type === 'files') return Boolean(row.files?.[prop.id]?.length);
  const v = cellValue(prop, row);
  if (v === null || v === undefined || v === '') return false;
  return !(Array.isArray(v) && v.length === 0);
}

/**
 * Fila abierta como página: panel lateral (peek) o página completa. Arriba
 * las propiedades, abajo el cuerpo (un editor de bloques embebido que pasa
 * el editor de afuera con `renderBody`, así este archivo no importa al
 * editor). Esc cierra cuando el foco no está escribiendo.
 */
export default function DbRowPanel({
  block,
  rowId,
  mode,
  membersUrl,
  pageId = null,
  updateDatabase,
  pageTitle,
  updateDb,
  onMode,
  onClose,
  renderBody,
}: {
  block: DocsBlock;
  rowId: string;
  mode: DbRowPanelMode;
  membersUrl: string | null;
  /** Página de Docs (relaciones, archivos, botones e IA); null en Notes. */
  pageId?: string | null;
  /** Cambiar otra base de la página (relaciones de dos vías). */
  updateDatabase?: (blockId: string, fn: (db: DocsDatabase) => DocsDatabase) => void;
  pageTitle: string;
  /** Cambio sobre la base más reciente (no la del render: el cuerpo guarda con debounce). */
  updateDb: (fn: (db: DocsDatabase) => DocsDatabase) => void;
  onMode: (mode: DbRowPanelMode) => void;
  onClose: () => void;
  /** Editor del cuerpo: título, después `properties` y los bloques. */
  renderBody: (page: DocsPage, onSave: (patch: Partial<DocsPage>) => void, properties: ReactNode) => ReactNode;
}) {
  const t = useTranslations('docs.database');
  const locale = useLocale();
  const members = useDbMembers(membersUrl);
  const people = useMemo(() => peopleMap(members), [members]);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [templateSaved, setTemplateSaved] = useState<string | null>(null);
  // Base vieja (sin `db` todavía): mismos ids que ve la tabla.
  const db = block.type === 'database' ? normalizeDatabase(block) : null;
  const emptyDb = useMemo<DocsDatabase>(() => ({ properties: [{ id: 'title', name: '', type: 'title' }], rows: [], views: [{ id: 'v', name: '', type: 'table' }] }), []);
  const source = useMemo(() => ({ pageId, blockId: block.id }), [pageId, block.id]);
  const commit = (next: DocsDatabase) => updateDb((cur) => withAutomations(cur, next));
  const labels = useMemo(() => ({ untitled: t('untitledRow'), error: t('formula.errorShort'), openMap: t('place.openMap') }), [t]);
  const runtime = useDbRuntime(
    { db: db ?? emptyDb, source, hostPageId: pageId, commit, updateDatabase, people, locale, labels },
    { buttonDone: t('button.done'), buttonError: t('button.failed'), writeError: t('relation.writeError') },
  );
  const autofill = useAutofill({
    db: db ?? emptyDb,
    shown: runtime.shown,
    source,
    commit,
    people,
    rowTitles: runtime.refs.titles ?? {},
    editable: false,
    onError: (code) =>
      runtime.setNotice({ kind: 'error', text: code === 'ai_disabled' ? t('ai.disabled') : code === 'quota_exceeded' ? t('ai.quota') : code === 'rate_limited' ? t('ai.rateLimited') : t('ai.failed') }),
  });
  const row = db?.rows.find((r) => r.id === rowId);
  const shownRow = runtime.shown.rows.find((r) => r.id === rowId) ?? row;

  // La página del cuerpo cambia solo al cambiar de fila (el editor guarda su propio estado).
  const bodyPage = useMemo<DocsPage | null>(() => {
    if (!db || !row) return null;
    return {
      id: row.id,
      user_id: '',
      parent_id: null,
      title: rowTitle(db, row),
      icon: null,
      cover_url: null,
      content: row.body ?? [],
      is_public: false,
      archived: false,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
    // Solo al cambiar de fila.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id]);

  // Al cerrar, el foco vuelve a lo que abrió el panel (la celda, la tarjeta del
  // board o del calendario); si se repintó mientras tanto, a la tarjeta de la fila.
  const openedRow = useRef(row?.id ?? null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const rowId = openedRow.current;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>('.docs-db-panel-close')?.focus({ preventScroll: true });
    return () => {
      requestAnimationFrame(() => {
        if (document.activeElement && document.activeElement !== document.body && !panel?.contains(document.activeElement)) return;
        let target: HTMLElement | null = prev && prev.isConnected && prev !== document.body ? prev : null;
        if (!target && rowId) {
          const card = document.querySelector<HTMLElement>(`[data-row="${CSS.escape(rowId)}"]`);
          target = card?.matches('button, [tabindex]') ? card : card?.querySelector<HTMLElement>('button, [tabindex]') ?? null;
        }
        target?.focus({ preventScroll: true });
      });
    };
  }, []);

  // Click afuera cierra el panel lateral (no la página completa). Un click en
  // la base de origen no: puede estar abriendo otra fila.
  useEffect(() => {
    if (mode !== 'peek') return;
    const onDown = (e: MouseEvent) => {
      const el = e.target as Element;
      if (panelRef.current?.contains(el)) return;
      if (el.closest?.('.docs-db-popover, .docs-db-wrap, .docs-menu, .docs-mention-popover, .docs-command-menu')) return;
      onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [mode, onClose]);

  // La fila ya no existe (borrada, deshacer): se cierra.
  useEffect(() => {
    if (!row) onClose();
  }, [row, onClose]);

  if (!db || !row || !shownRow || !bodyPage || typeof document === 'undefined') return null;
  const props = runtime.shown.properties.filter((p) => p.type !== 'title');

  const onSave = (patch: Partial<DocsPage>) => {
    updateDb((cur) => {
      const r = cur.rows.find((x) => x.id === rowId);
      if (!r) return cur;
      const titleId = cur.properties.find((p) => p.type === 'title')?.id;
      const values = { ...r.values };
      if (patch.title !== undefined && titleId) {
        if (patch.title) values[titleId] = patch.title;
        else delete values[titleId];
      }
      const body = patch.content !== undefined ? patch.content.filter((b) => b.type !== 'database') : r.body;
      const sameTitle = titleId ? (values[titleId] ?? '') === (r.values[titleId] ?? '') : true;
      if (sameTitle && JSON.stringify(body ?? []) === JSON.stringify(r.body ?? [])) return cur;
      const now = new Date().toISOString();
      return { ...cur, rows: cur.rows.map((x) => (x.id === rowId ? { ...x, values, body, updated_at: now } : x)) };
    });
  };

  return createPortal(
    <div
      ref={panelRef}
      className={`docs-db-rowpanel is-${mode}`}
      role="dialog"
      aria-modal={mode === 'full' || undefined}
      aria-label={rowTitle(db, row) || t('untitledRow')}
      data-testid="docs-db-rowpanel"
      onKeyDownCapture={(e) => {
        if (e.key !== 'Escape') return;
        const target = e.target as HTMLElement;
        // Las propiedades (editores de celda, popovers) manejan su propio Esc.
        if (target.closest('.docs-db-props, .docs-db-popover')) return;
        // En el título o el cuerpo: Esc cierra (como el peek de Notion), salvo
        // que haya un menú del editor abierto (/, @, links, formato): ese se cierra primero.
        if (target.closest('.docs-title, .docs-blocks, .docs-db-rowpanel-body')) {
          const menu = document.querySelector('.docs-command-menu, .docs-mention-popover, .docs-link-popover, .docs-block-menu, .docs-format-toolbar');
          if (menu) return;
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || e.defaultPrevented) return;
        const target = e.target as HTMLElement;
        if (target.isContentEditable || target.closest('input, textarea, select')) return;
        e.preventDefault();
        onClose();
      }}
    >
      <div className="docs-db-rowpanel-bar">
        {mode === 'full' ? (
          <nav className="docs-db-rowpanel-crumbs" aria-label={t('rowBreadcrumb')}>
            <button type="button" className="docs-db-link-btn" onClick={onClose}>
              {pageTitle || t('untitledPage')}
            </button>
            <span aria-hidden="true">/</span>
            <span>{db.title || t('untitledDatabase')}</span>
          </nav>
        ) : (
          <span />
        )}
        <div className="docs-db-rowpanel-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm docs-db-rowpanel-mode"
            aria-label={mode === 'peek' ? t('openFullPage') : t('openSidePeek')}
            title={mode === 'peek' ? t('openFullPage') : t('openSidePeek')}
            onClick={() => onMode(mode === 'peek' ? 'full' : 'peek')}
          >
            <DocsGlyph name={mode === 'peek' ? 'expand' : 'peek'} size={14} />
            <span>{mode === 'peek' ? t('openFullPage') : t('openSidePeek')}</span>
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label={templateSaved ? t('templates.saved') : t('templates.saveRow')}
            title={t('templates.saveRow')}
            disabled={(db.templates?.length ?? 0) >= DB_MAX_TEMPLATES}
            data-testid="docs-db-save-template"
            onClick={() => {
              const name = rowTitle(db, row) || t('templates.untitled');
              updateDb((cur) => saveRowAsTemplate(cur, rowId, rowTitle(cur, row) || t('templates.untitled')));
              setTemplateSaved(name);
              window.setTimeout(() => setTemplateSaved(null), 4000);
            }}
          >
            <DocsGlyph name="template" size={14} />
            <span>{templateSaved ? t('templates.saved') : t('templates.saveRow')}</span>
          </button>
          {confirmDelete ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm docs-db-danger"
              onClick={() => {
                updateDb((cur) => ({ ...cur, rows: cur.rows.filter((r) => r.id !== rowId) }));
                onClose();
              }}
              onBlur={() => setConfirmDelete(false)}
              autoFocus
            >
              {t('confirmDeleteRow')}
            </button>
          ) : (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(true)} aria-label={t('removeRow')} title={t('removeRow')}>
              <DocsGlyph name="trash" size={14} />
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm btn-icon docs-db-panel-close" onClick={onClose} aria-label={t('closeRow')} title={t('closeRow')}>
            <DocsGlyph name="close" size={16} />
          </button>
        </div>
      </div>
      {templateSaved && (
        <p className="docs-db-toast" role="status" data-testid="docs-db-template-toast">
          {t('templates.savedToast', { name: templateSaved })}
        </p>
      )}
      <div className="docs-db-rowpanel-scroll">
        <div className="docs-db-rowpanel-inner">
          <div className="docs-db-rowpanel-body">
            {renderBody(
              bodyPage,
              onSave,
              props.length > 0 ? (
            <div className="docs-db-props" role="group" aria-label={t('properties')}>
              {props.map((p) => (
                <PropRow
                  key={p.id}
                  prop={p}
                  row={shownRow}
                  people={people}
                  members={members}
                  locale={locale}
                  refs={runtime.refs}
                  extras={runtime.extras}
                  filling={autofill.filling === p.id}
                  onAutofill={p.ai && pageId ? () => void autofill.fill(p.id, [rowId]) : undefined}
                  onChange={(v) => runtime.setValue(rowId, p.id, v)}
                  onCreateOption={(name) =>
                    updateDb((cur) => {
                      const prop = cur.properties.find((x) => x.id === p.id);
                      if (!prop) return cur;
                      const option = { id: newDbId(), name, ...(prop.type === 'status' ? { group: 'todo' as const } : {}) };
                      const withOpt = updateProperty(cur, p.id, { options: [...(prop.options ?? []), option] });
                      const curV = withOpt.rows.find((x) => x.id === rowId)?.values[p.id];
                      const value = prop.type === 'multi_select' ? [...(Array.isArray(curV) ? curV : []), option.id] : option.id;
                      return withAutomations(cur, setCell(withOpt, rowId, p.id, value));
                    })
                  }
                />
              ))}
              {runtime.notice && (
                <p className={`docs-db-notice${runtime.notice.kind === 'error' ? ' is-error' : ''}`} role={runtime.notice.kind === 'error' ? 'alert' : 'status'}>
                  {runtime.notice.text}
                </p>
              )}
            </div>
              ) : null,
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
