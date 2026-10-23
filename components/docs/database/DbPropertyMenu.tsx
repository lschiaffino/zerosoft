'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { DbPropertyType, DbStatusGroup, DbViewConfig, DocsDatabase, DocsMentionableUser } from '@/lib/docs-types';
import {
  DB_GROUPABLE_TYPES,
  DB_MAX_OPTIONS,
  DB_PROPERTY_TYPES,
  DB_STATUS_GROUPS,
  changePropertyType,
  isOptionType,
  newDbId,
  orderedOptions,
  removeOption,
  removeProperty,
  updateProperty,
  updateView,
} from '@/lib/docs-database';
import DocsGlyph from '../DocsGlyphs';
import { StatusGlyph } from './DbValueView';

const TYPE_PATHS: Record<DbPropertyType, string> = {
  title: 'M4 7h16M4 12h10M4 17h13',
  text: 'M4 7h16M4 12h10M4 17h13',
  number: 'M9 4l-2 16M17 4l-2 16M4 9h16M3 15h16',
  select: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 11l4 4 4-4',
  multi_select: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  status: 'M4 4h16v16H4zM12 4v16',
  date: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  checkbox: 'M4 4h16v16H4zM8 12l3 3 5-6',
  url: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  email: 'M3 6h18v12H3zM3 6l9 7 9-7',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4H18A15 15 0 0 1 5 6z',
  created_time: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  last_edited_time: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
};

export function PropertyTypeIcon({ type }: { type: DbPropertyType }) {
  return (
    <svg className="docs-db-type-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={TYPE_PATHS[type]} />
    </svg>
  );
}

/** Clave i18n del nombre de un tipo (docs.database.types.<tipo>). */
export const typeKey = (type: DbPropertyType) => `types.${type}` as const;

/** Lista de tipos para crear una propiedad (popover "+" del encabezado y panel de propiedades). */
export function PropertyTypeList({ onPick }: { onPick: (type: DbPropertyType) => void }) {
  const t = useTranslations('docs.database');
  return (
    <div className="docs-db-menu" role="menu" aria-label={t('addProperty')}>
      {DB_PROPERTY_TYPES.map((type) => (
        <button key={type} type="button" role="menuitem" className="docs-db-menu-item" onClick={() => onPick(type)}>
          <PropertyTypeIcon type={type} />
          {t(typeKey(type))}
        </button>
      ))}
    </div>
  );
}

/**
 * Menú de una propiedad (click en su encabezado): nombre, tipo (convierte los
 * valores), opciones de select/multi/status (con grupo en status), ordenar,
 * filtrar, agrupar, ocultar en esta vista y borrar.
 */
export default function DbPropertyMenu({
  db,
  view,
  propId,
  members,
  commit,
  onFilter,
  onClose,
}: {
  db: DocsDatabase;
  view: DbViewConfig;
  propId: string;
  members: DocsMentionableUser[];
  commit: (next: DocsDatabase) => void;
  onFilter: (propId: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations('docs.database');
  const prop = db.properties.find((p) => p.id === propId);
  const [newOption, setNewOption] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (!prop) return null;
  const isTitle = prop.type === 'title';

  const addOption = () => {
    const name = newOption.trim();
    if (!name || (prop.options?.length ?? 0) >= DB_MAX_OPTIONS) return;
    if (prop.options?.some((o) => o.name.trim().toLowerCase() === name.toLowerCase())) {
      setNewOption('');
      return;
    }
    const option = { id: newDbId(), name, ...(prop.type === 'status' ? { group: 'todo' as DbStatusGroup } : {}) };
    commit(updateProperty(db, prop.id, { options: [...(prop.options ?? []), option] }));
    setNewOption('');
  };

  const sortBy = (direction: 'asc' | 'desc') => {
    const rest = (view.sorts ?? []).filter((s) => s.property !== prop.id);
    commit(updateView(db, view.id, { sorts: [{ property: prop.id, direction }, ...rest] }));
    onClose();
  };

  return (
    <div className="docs-db-propmenu">
      <input
        className="docs-db-field"
        data-autofocus
        aria-label={t('propertyName')}
        value={prop.name}
        maxLength={200}
        onChange={(e) => commit(updateProperty(db, prop.id, { name: e.target.value }))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onClose();
          }
        }}
      />
      <label className="docs-db-row-field">
        <span>{t('propertyType')}</span>
        {isTitle ? (
          <span className="docs-db-muted">{t('types.title')}</span>
        ) : (
          <select
            className="docs-db-select"
            value={prop.type}
            onChange={(e) => commit(changePropertyType(db, prop.id, e.target.value as DbPropertyType, { members }))}
          >
            {DB_PROPERTY_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(typeKey(type))}
              </option>
            ))}
          </select>
        )}
      </label>

      {isOptionType(prop.type) && (
        <div className="docs-db-optedit" role="group" aria-label={t('options')}>
          <p className="docs-db-menu-label">{t('options')}</p>
          {orderedOptions(prop).map((o) => (
            <div key={o.id} className="docs-db-optedit-row">
              {prop.type === 'status' && <StatusGlyph group={o.group ?? 'todo'} />}
              <input
                className="docs-db-field docs-db-field-sm"
                aria-label={t('optionName')}
                value={o.name}
                maxLength={200}
                onChange={(e) =>
                  commit(
                    updateProperty(db, prop.id, {
                      options: (prop.options ?? []).map((x) => (x.id === o.id ? { ...x, name: e.target.value } : x)),
                    }),
                  )
                }
              />
              {prop.type === 'status' && (
                <select
                  className="docs-db-select docs-db-select-sm"
                  aria-label={t('statusGroupLabel')}
                  value={o.group ?? 'todo'}
                  onChange={(e) =>
                    commit(
                      updateProperty(db, prop.id, {
                        options: (prop.options ?? []).map((x) => (x.id === o.id ? { ...x, group: e.target.value as DbStatusGroup } : x)),
                      }),
                    )
                  }
                >
                  {DB_STATUS_GROUPS.map((g) => (
                    <option key={g} value={g}>
                      {t(`statusGroup.${g}`)}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                className="docs-db-remove"
                aria-label={t('removeOption', { name: o.name })}
                title={t('removeOption', { name: o.name })}
                onClick={() => commit(removeOption(db, prop.id, o.id))}
              >
                ×
              </button>
            </div>
          ))}
          <input
            className="docs-db-field docs-db-field-sm"
            placeholder={t('addOption')}
            aria-label={t('addOption')}
            value={newOption}
            maxLength={200}
            onChange={(e) => setNewOption(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addOption();
              }
            }}
            onBlur={addOption}
          />
        </div>
      )}

      <div className="docs-db-menu" role="menu" aria-label={prop.name}>
        <button type="button" role="menuitem" className="docs-db-menu-item" onClick={() => sortBy('asc')}>
          <DocsGlyph name="up" size={14} />
          {t('sortAsc')}
        </button>
        <button type="button" role="menuitem" className="docs-db-menu-item" onClick={() => sortBy('desc')}>
          <DocsGlyph name="down" size={14} />
          {t('sortDesc')}
        </button>
        <button type="button" role="menuitem" className="docs-db-menu-item" onClick={() => onFilter(prop.id)}>
          <DocsGlyph name="filter" size={14} />
          {t('filterBy')}
        </button>
        {DB_GROUPABLE_TYPES.has(prop.type) && view.type !== 'gallery' && (
          <button
            type="button"
            role="menuitem"
            className="docs-db-menu-item"
            onClick={() => {
              commit(updateView(db, view.id, { group_by: view.group_by === prop.id && view.type === 'table' ? null : prop.id }));
              onClose();
            }}
          >
            <DocsGlyph name="group" size={14} />
            {view.group_by === prop.id && view.type === 'table' ? t('ungroup') : t('groupByThis')}
          </button>
        )}
        {!isTitle && (
          <button
            type="button"
            role="menuitem"
            className="docs-db-menu-item"
            onClick={() => {
              commit(updateView(db, view.id, { hidden: [...new Set([...(view.hidden ?? []), prop.id])] }));
              onClose();
            }}
          >
            <DocsGlyph name="eye" size={14} />
            {t('hideInView')}
          </button>
        )}
        {!isTitle &&
          (confirmDelete ? (
            <button
              type="button"
              role="menuitem"
              className="docs-db-menu-item danger"
              data-autofocus
              onClick={() => {
                commit(removeProperty(db, prop.id));
                onClose();
              }}
            >
              <DocsGlyph name="trash" size={14} />
              {t('confirmDeleteProperty')}
            </button>
          ) : (
            <button type="button" role="menuitem" className="docs-db-menu-item" onClick={() => setConfirmDelete(true)}>
              <DocsGlyph name="trash" size={14} />
              {t('deleteProperty')}
            </button>
          ))}
      </div>
    </div>
  );
}
