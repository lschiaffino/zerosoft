'use client';

import { useTranslations } from 'next-intl';
import type {
  DbFilter,
  DbFilterOp,
  DbProperty,
  DbSort,
  DbValue,
  DbViewConfig,
  DocsDatabase,
  DocsMentionableUser,
} from '@/lib/docs-types';
import {
  DB_GROUPABLE_TYPES,
  effectiveType,
  filterOpsFor,
  newDbId,
  opNeedsValue,
  orderedOptions,
  parseNumber,
  updateView,
} from '@/lib/docs-database';
import DocsGlyph from '../DocsGlyphs';
import { memberName } from './useDbMembers';
import { PropertyTypeIcon } from './DbPropertyMenu';

type Commit = (next: DocsDatabase) => void;

export function newFilter(prop: DbProperty): DbFilter {
  return { id: newDbId(), property: prop.id, op: filterOpsFor(prop)[0] ?? 'not_empty' };
}

function FilterValue({
  prop,
  filter,
  members,
  onChange,
}: {
  prop: DbProperty;
  filter: DbFilter;
  members: DocsMentionableUser[];
  onChange: (value: DbValue) => void;
}) {
  const t = useTranslations('docs.database');
  if (!opNeedsValue(filter.op)) return null;
  const v = filter.value;
  const type = effectiveType(prop);
  if (prop.type === 'select' || prop.type === 'status' || prop.type === 'multi_select') {
    return (
      <select className="docs-db-select" aria-label={t('filterValue')} value={typeof v === 'string' ? v : ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{t('pickOption')}</option>
        {orderedOptions(prop).map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    );
  }
  if (type === 'person') {
    return (
      <select className="docs-db-select" aria-label={t('filterValue')} value={typeof v === 'string' ? v : ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{t('pickPerson')}</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {memberName(m)}
          </option>
        ))}
      </select>
    );
  }
  if (type === 'date' || prop.type === 'created_time' || prop.type === 'last_edited_time') {
    return (
      <input className="docs-db-field mono" type="date" aria-label={t('filterValue')} value={typeof v === 'string' ? v : ''} onChange={(e) => onChange(e.target.value || null)} />
    );
  }
  if (type === 'number') {
    return (
      <input
        className="docs-db-field mono"
        inputMode="decimal"
        aria-label={t('filterValue')}
        placeholder={t('filterValuePlaceholder')}
        defaultValue={typeof v === 'number' ? String(v) : ''}
        onChange={(e) => onChange(parseNumber(e.target.value))}
      />
    );
  }
  return (
    <input
      className="docs-db-field"
      aria-label={t('filterValue')}
      placeholder={t('filterValuePlaceholder')}
      value={typeof v === 'string' ? v : ''}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** Filtros de la vista (todas las condiciones en AND). */
export function DbFilterPanel({ db, view, members, commit }: { db: DocsDatabase; view: DbViewConfig; members: DocsMentionableUser[]; commit: Commit }) {
  const t = useTranslations('docs.database');
  const filters = view.filters ?? [];
  const set = (next: DbFilter[]) => commit(updateView(db, view.id, { filters: next }));
  const patch = (id: string, p: Partial<DbFilter>) => set(filters.map((f) => (f.id === id ? { ...f, ...p } : f)));
  return (
    <div className="docs-db-panel" aria-label={t('filter')}>
      {filters.length === 0 && <p className="docs-db-panel-empty">{t('noFilters')}</p>}
      {filters.map((f, i) => {
        const prop = db.properties.find((p) => p.id === f.property);
        if (!prop) return null;
        return (
          <div key={f.id} className="docs-db-filter-row">
            <span className="docs-db-filter-join">{i === 0 ? t('where') : t('and')}</span>
            <select
              className="docs-db-select"
              aria-label={t('property')}
              value={f.property}
              data-autofocus={i === filters.length - 1 || undefined}
              onChange={(e) => {
                const next = db.properties.find((p) => p.id === e.target.value);
                if (next) patch(f.id, { property: next.id, op: filterOpsFor(next)[0] ?? 'not_empty', value: undefined });
              }}
            >
              {db.properties.filter((p) => p.type !== 'button').map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || t('untitledProperty')}
                </option>
              ))}
            </select>
            <select
              className="docs-db-select"
              aria-label={t('condition')}
              value={f.op}
              onChange={(e) => patch(f.id, { op: e.target.value as DbFilterOp })}
            >
              {filterOpsFor(prop).map((op) => (
                <option key={op} value={op}>
                  {t(`ops.${op}`)}
                </option>
              ))}
            </select>
            <FilterValue prop={prop} filter={f} members={members} onChange={(value) => patch(f.id, { value })} />
            <button
              type="button"
              className="docs-db-remove"
              aria-label={t('removeFilter')}
              title={t('removeFilter')}
              onClick={() => set(filters.filter((x) => x.id !== f.id))}
            >
              ×
            </button>
          </div>
        );
      })}
      <div className="docs-db-panel-foot">
        <button
          type="button"
          className="docs-db-link-btn"
          disabled={filters.length >= 20}
          onClick={() => set([...filters, newFilter(db.properties.find((p) => p.type !== 'button') ?? db.properties[0])])}
        >
          <DocsGlyph name="plus" size={12} />
          {t('addFilter')}
        </button>
        {filters.length > 0 && (
          <button type="button" className="docs-db-link-btn" onClick={() => set([])}>
            {t('clearFilters')}
          </button>
        )}
      </div>
    </div>
  );
}

/** Orden de la vista: varias claves, la primera manda. */
export function DbSortPanel({ db, view, commit }: { db: DocsDatabase; view: DbViewConfig; commit: Commit }) {
  const t = useTranslations('docs.database');
  const sorts = view.sorts ?? [];
  const set = (next: DbSort[]) => commit(updateView(db, view.id, { sorts: next }));
  const unused = db.properties.filter((p) => !sorts.some((s) => s.property === p.id));
  return (
    <div className="docs-db-panel" aria-label={t('sort')}>
      {sorts.length === 0 && <p className="docs-db-panel-empty">{t('noSorts')}</p>}
      {sorts.map((s, i) => (
        <div key={s.property} className="docs-db-filter-row">
          <span className="docs-db-filter-join">{i === 0 ? t('sortBy') : t('thenBy')}</span>
          <select
            className="docs-db-select"
            aria-label={t('property')}
            value={s.property}
            data-autofocus={i === sorts.length - 1 || undefined}
            onChange={(e) => set(sorts.map((x, j) => (j === i ? { ...x, property: e.target.value } : x)))}
          >
            {db.properties
              .filter((p) => p.id === s.property || !sorts.some((x) => x.property === p.id))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || t('untitledProperty')}
                </option>
              ))}
          </select>
          <select
            className="docs-db-select"
            aria-label={t('direction')}
            value={s.direction}
            onChange={(e) => set(sorts.map((x, j) => (j === i ? { ...x, direction: e.target.value as 'asc' | 'desc' } : x)))}
          >
            <option value="asc">{t('ascending')}</option>
            <option value="desc">{t('descending')}</option>
          </select>
          {i > 0 && (
            <button
              type="button"
              className="docs-db-remove"
              aria-label={t('moveSortUp')}
              title={t('moveSortUp')}
              onClick={() => {
                const next = [...sorts];
                [next[i - 1], next[i]] = [next[i], next[i - 1]];
                set(next);
              }}
            >
              <DocsGlyph name="up" size={12} />
            </button>
          )}
          <button
            type="button"
            className="docs-db-remove"
            aria-label={t('removeSort')}
            title={t('removeSort')}
            onClick={() => set(sorts.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <div className="docs-db-panel-foot">
        <button
          type="button"
          className="docs-db-link-btn"
          disabled={unused.length === 0 || sorts.length >= 10}
          onClick={() => unused[0] && set([...sorts, { property: unused[0].id, direction: 'asc' }])}
        >
          <DocsGlyph name="plus" size={12} />
          {t('addSort')}
        </button>
        {sorts.length > 0 && (
          <button type="button" className="docs-db-link-btn" onClick={() => set([])}>
            {t('clearSorts')}
          </button>
        )}
      </div>
    </div>
  );
}

/** Agrupar (tabla) o columnas del board. */
export function DbGroupPanel({
  db,
  view,
  commit,
  onCreateStatus,
}: {
  db: DocsDatabase;
  view: DbViewConfig;
  commit: Commit;
  onCreateStatus: () => void;
}) {
  const t = useTranslations('docs.database');
  const groupable = db.properties.filter((p) => DB_GROUPABLE_TYPES.has(p.type));
  return (
    <div className="docs-db-panel" aria-label={view.type === 'board' ? t('boardColumns') : t('group')}>
      <label className="docs-db-row-field">
        <span>{view.type === 'board' ? t('columnsBy') : t('groupBy')}</span>
        <select
          className="docs-db-select"
          data-autofocus
          value={view.group_by ?? ''}
          onChange={(e) => commit(updateView(db, view.id, { group_by: e.target.value || null }))}
        >
          {view.type !== 'board' && <option value="">{t('noGrouping')}</option>}
          {view.type === 'board' && !view.group_by && <option value="">{t('pickProperty')}</option>}
          {groupable.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name || t('untitledProperty')}
            </option>
          ))}
        </select>
      </label>
      {view.type === 'board' && groupable.length > 1 && (
        <label className="docs-db-row-field">
          <span>{t('subGroupBy')}</span>
          <select
            className="docs-db-select"
            value={view.sub_group_by ?? ''}
            data-testid="docs-db-subgroup-select"
            onChange={(e) => commit(updateView(db, view.id, { sub_group_by: e.target.value || null }))}
          >
            <option value="">{t('noGrouping')}</option>
            {groupable
              .filter((p) => p.id !== view.group_by)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || t('untitledProperty')}
                </option>
              ))}
          </select>
        </label>
      )}
      {groupable.length === 0 && (
        <div className="docs-db-panel-foot">
          <p className="docs-db-panel-empty">{t('noGroupable')}</p>
          <button type="button" className="docs-db-link-btn" onClick={onCreateStatus}>
            <DocsGlyph name="plus" size={12} />
            {t('addStatusProperty')}
          </button>
        </div>
      )}
    </div>
  );
}

/** Propiedades visibles en la vista (el título no se oculta) y crear una nueva. */
export function DbPropertiesPanel({
  db,
  view,
  commit,
  onNewProperty,
}: {
  db: DocsDatabase;
  view: DbViewConfig;
  commit: Commit;
  onNewProperty: (anchor: HTMLElement) => void;
}) {
  const t = useTranslations('docs.database');
  const hidden = new Set(view.hidden ?? []);
  const setHidden = (ids: string[]) => commit(updateView(db, view.id, { hidden: ids }));
  return (
    <div className="docs-db-panel" aria-label={t('properties')}>
      <ul className="docs-db-proplist">
        {db.properties.map((p) => (
          <li key={p.id}>
            <label className="docs-db-propitem">
              <input
                type="checkbox"
                checked={p.type === 'title' || !hidden.has(p.id)}
                disabled={p.type === 'title'}
                onChange={(e) => setHidden(e.target.checked ? [...hidden].filter((h) => h !== p.id) : [...hidden, p.id])}
              />
              <PropertyTypeIcon type={p.type} />
              <span>{p.name || t('untitledProperty')}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="docs-db-panel-foot">
        <button type="button" className="docs-db-link-btn" onClick={(e) => onNewProperty(e.currentTarget)}>
          <DocsGlyph name="plus" size={12} />
          {t('addProperty')}
        </button>
        {hidden.size > 0 && (
          <button type="button" className="docs-db-link-btn" onClick={() => setHidden([])}>
            {t('showAll')}
          </button>
        )}
      </div>
    </div>
  );
}
