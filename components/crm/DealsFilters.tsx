'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { ColumnsSlot } from './ColumnToggle';
import { ACTIVITY_DATE_SORTS, type ActivityDateSort } from '@/lib/crm-activity-dates';
import type { ExtraSort } from '@/lib/crm-list-sort';

interface CustomFieldOption {
  name: string;
  label: string;
  options: string[];
}

interface DealsFiltersProps {
  pipeline: string;
  q: string;
  stageId: string;
  priority: string;
  source: string;
  owner: string;
  /** Tag activo (?tag=) y tags disponibles. */
  tag?: string;
  tags?: Array<{ id: string; name: string }>;
  createdFrom: string;
  createdTo: string;
  custom: Record<string, string>;
  /** Query param `filters` crudo (advanced filter builder); se preserva al navegar. */
  advanced?: string;
  sort: 'newest' | 'oldest' | 'amount' | 'amount_asc' | 'close_date' | 'close_date_desc' | ActivityDateSort | ExtraSort;
  stages: Array<{ id: string; name: string }>;
  priorities: Array<{ value: string; label: string }>;
  sources: Array<{ value: string; label: string }>;
  owners: Array<{ value: string; label: string }>;
  customFields: CustomFieldOption[];
  /** Órdenes por owner y custom fields (lib/crm-list-sort.ts). */
  extraSorts?: Array<{ value: string; label: string }>;
  /** Filtro avanzado (FilterBuilder): se muestra dentro de "Más filtros". */
  children?: React.ReactNode;
}

/** Filtros de la vista tabla de deals (server-side vía query params). */
export default function DealsFilters({
  pipeline,
  q,
  stageId,
  priority,
  source,
  owner,
  tag = '',
  tags = [],
  createdFrom,
  createdTo,
  custom,
  advanced,
  sort,
  stages,
  priorities,
  sources,
  owners,
  customFields,
  extraSorts = [],
  children,
}: DealsFiltersProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState(q);

  function go(patch: Record<string, string | undefined>) {
    const params = new URLSearchParams();
    const current: Record<string, string | undefined> = {
      pipeline,
      view: 'table',
      q: q || undefined,
      stageId: stageId || undefined,
      priority: priority || undefined,
      source: source || undefined,
      owner: owner || undefined,
      tag: tag || undefined,
      createdFrom: createdFrom || undefined,
      createdTo: createdTo || undefined,
      filters: advanced || undefined,
      sort: sort !== 'newest' ? sort : undefined,
      ...patch,
    };
    for (const [key, value] of Object.entries(current)) {
      if (value) params.set(key, value);
    }
    for (const [name, value] of Object.entries(custom)) {
      if (value) params.set(`custom_${name}`, value);
    }
    for (const [name, value] of Object.entries(patch)) {
      if (name.startsWith('custom_') && !value) params.delete(name);
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  function setCustom(name: string, value: string) {
    go({ [`custom_${name}`]: value || undefined });
  }

  const activeFilters = [
    q,
    stageId,
    priority,
    source,
    owner,
    tag,
    createdFrom,
    createdTo,
    ...Object.values(custom),
  ].filter(Boolean).length;
  const moreActive = [source, createdFrom, createdTo, advanced, ...Object.values(custom)].filter(Boolean).length;
  const [moreOpen, setMoreOpen] = useState(moreActive > 0);

  return (
    <div className="filter-bar">
      <div className="filter-toolbar">
        <form
          className="filter-search"
          onSubmit={(e) => {
            e.preventDefault();
            go({ q: search.trim() || undefined });
          }}
        >
          <input
            className="input"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('deals.table.searchPlaceholder')}
            aria-label={t('deals.table.searchPlaceholder')}
          />
        </form>
        <select
          className={`filter-select${stageId ? ' on' : ''}`}
          value={stageId}
          onChange={(e) => go({ stageId: e.target.value || undefined })}
          aria-label={t('deals.table.stage')}
        >
          <option value="">{t('deals.table.stage')}</option>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          className={`filter-select${priority ? ' on' : ''}`}
          value={priority}
          onChange={(e) => go({ priority: e.target.value || undefined })}
          aria-label={t('deals.table.priority')}
        >
          <option value="">{t('deals.table.priority')}</option>
          {priorities.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <select
          className={`filter-select${owner ? ' on' : ''}`}
          value={owner}
          onChange={(e) => go({ owner: e.target.value || undefined })}
          aria-label={t('deals.filterOwner')}
        >
          <option value="">{t('deals.filterOwner')}</option>
          {owners.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {tags.length > 0 && (
          <select
            className={`filter-select${tag ? ' on' : ''}`}
            value={tag}
            onChange={(e) => go({ tag: e.target.value || undefined })}
            aria-label={t('tags.filter')}
            data-testid="tag-filter"
          >
            <option value="">{t('tags.filter')}</option>
            {tags.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          className={`filter-more${moreOpen ? ' open' : ''}${moreActive ? ' on' : ''}`}
          onClick={() => setMoreOpen((v) => !v)}
          aria-expanded={moreOpen}
        >
          {t('common.moreFilters')}
          {moreActive > 0 && <span className="filter-count">{moreActive}</span>}
        </button>

        <div className="filter-right">
          {activeFilters > 0 && (
            <button
              type="button"
              className="filter-clear"
              onClick={() =>
                go({
                  q: undefined,
                  stageId: undefined,
                  priority: undefined,
                  source: undefined,
                  owner: undefined,
                  tag: undefined,
                  createdFrom: undefined,
                  createdTo: undefined,
                })
              }
            >
              {t('common.clear')}
            </button>
          )}
          <select
            className="filter-select filter-sort"
            value={sort}
            onChange={(e) => go({ sort: e.target.value === 'newest' ? undefined : e.target.value })}
            aria-label={t('common.sortBy')}
          >
            <option value="newest">{t('deals.sortNewest')}</option>
            <option value="oldest">{t('deals.sortOldest')}</option>
            <option value="amount">{t('deals.sortAmount')}</option>
            <option value="amount_asc">{t('deals.sortAmountAsc')}</option>
            <option value="close_date">{t('deals.sortCloseDate')}</option>
            <option value="close_date_desc">{t('deals.sortCloseDesc')}</option>
            {ACTIVITY_DATE_SORTS.map((v) => (
              <option key={v} value={v}>
                {t(`activityDates.sort.${v}`)}
              </option>
            ))}
            {extraSorts.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <ColumnsSlot />
        </div>
      </div>

      {moreOpen && (
        <div className="filter-more-panel">
          <label className="filter-field">
            <span className="label">{t('deals.filterSource')}</span>
            <select
              className={`filter-select${source ? ' on' : ''}`}
              value={source}
              onChange={(e) => go({ source: e.target.value || undefined })}
            >
              <option value="">{t('common.all')}</option>
              {sources.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span className="label">{t('deals.filterCreatedFrom')}</span>
            <input
              className="input filter-date"
              type="date"
              value={createdFrom}
              onChange={(e) => go({ createdFrom: e.target.value || undefined })}
            />
          </label>
          <label className="filter-field">
            <span className="label">{t('deals.filterCreatedTo')}</span>
            <input
              className="input filter-date"
              type="date"
              value={createdTo}
              onChange={(e) => go({ createdTo: e.target.value || undefined })}
            />
          </label>
          {customFields.map((cf) => (
            <label key={cf.name} className="filter-field">
              <span className="label">{cf.label}</span>
              <select
                className={`filter-select${custom[cf.name] ? ' on' : ''}`}
                value={custom[cf.name] ?? ''}
                onChange={(e) => setCustom(cf.name, e.target.value)}
              >
                <option value="">{t('common.all')}</option>
                {cf.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {children && <div className="filter-advanced">{children}</div>}
        </div>
      )}
    </div>
  );
}
