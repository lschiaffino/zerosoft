'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocale, useTranslations } from 'next-intl';
import type { DbProperty, DbRow, DbValue, DocsBlock, DocsDatabase, DocsPage } from '@/lib/docs-types';
import { cellValue, DB_MAX_TEMPLATES, isComputedType, newDbId, normalizeDatabase, rowTitle, saveRowAsTemplate, setCell, updateProperty } from '@/lib/docs-database';
import DocsGlyph from '../DocsGlyphs';
import DbValueView from './DbValueView';
import DbCellEditor from './DbCellEditor';
import { PropertyTypeIcon } from './DbPropertyMenu';
import { peopleMap, useDbMembers } from './useDbMembers';

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
}: {
  prop: DbProperty;
  row: DbRow;
  people: Record<string, string>;
  members: ReturnType<typeof useDbMembers>;
  locale: string;
  onChange: (value: DbValue) => void;
  onCreateOption: (name: string) => void;
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
  const isPopover = prop.type === 'select' || prop.type === 'status' || prop.type === 'multi_select' || prop.type === 'person';
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
          if ((e.target as HTMLElement).closest('a, input')) return;
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
            <DbValueView prop={prop} row={row} people={people} locale={locale} />
            {!computed && prop.type !== 'checkbox' && !cellValueShown(prop, row) && <span className="docs-db-placeholder">{t('emptyValue')}</span>}
          </span>
        )}
        {editing && (
          <DbCellEditor
            prop={prop}
            row={row}
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
    </div>
  );
}

function cellValueShown(prop: DbProperty, row: DbRow): boolean {
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
  const [templateSaved, setTemplateSaved] = useState(false);
  // Base vieja (sin `db` todavía): mismos ids que ve la tabla.
  const db = block.type === 'database' ? normalizeDatabase(block) : null;
  const row = db?.rows.find((r) => r.id === rowId);

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

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>('.docs-db-panel-close')?.focus({ preventScroll: true });
    return () => prev?.focus?.({ preventScroll: true });
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

  if (!db || !row || !bodyPage || typeof document === 'undefined') return null;
  const props = db.properties.filter((p) => p.type !== 'title');

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
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        const target = e.target as HTMLElement;
        // Esc mientras se escribe es del editor (seleccionar bloques); afuera cierra.
        if (target.isContentEditable || target.closest('input, textarea, select, .docs-blocks')) return;
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
            className="btn btn-ghost btn-sm"
            onClick={() => onMode(mode === 'peek' ? 'full' : 'peek')}
          >
            <DocsGlyph name={mode === 'peek' ? 'expand' : 'peek'} size={14} />
            {mode === 'peek' ? t('openFullPage') : t('openSidePeek')}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={(db.templates?.length ?? 0) >= DB_MAX_TEMPLATES}
            data-testid="docs-db-save-template"
            onClick={() => {
              updateDb((cur) => saveRowAsTemplate(cur, rowId, rowTitle(cur, row) || t('templates.untitled')));
              setTemplateSaved(true);
              window.setTimeout(() => setTemplateSaved(false), 3000);
            }}
          >
            <DocsGlyph name="template" size={14} />
            {templateSaved ? t('templates.saved') : t('templates.saveRow')}
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
                  row={row}
                  people={people}
                  members={members}
                  locale={locale}
                  onChange={(v) => updateDb((cur) => setCell(cur, rowId, p.id, v))}
                  onCreateOption={(name) =>
                    updateDb((cur) => {
                      const prop = cur.properties.find((x) => x.id === p.id);
                      if (!prop) return cur;
                      const option = { id: newDbId(), name, ...(prop.type === 'status' ? { group: 'todo' as const } : {}) };
                      const withOpt = updateProperty(cur, p.id, { options: [...(prop.options ?? []), option] });
                      const curV = withOpt.rows.find((x) => x.id === rowId)?.values[p.id];
                      const value = prop.type === 'multi_select' ? [...(Array.isArray(curV) ? curV : []), option.id] : option.id;
                      return setCell(withOpt, rowId, p.id, value);
                    })
                  }
                />
              ))}
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
