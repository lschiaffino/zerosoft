'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { ColumnsSlot } from './ColumnToggle';
import DateRangeFilter from './DateRangeFilter';
import { OWNER_UNASSIGNED } from '@/lib/crm-filter-model';
import { ACTIVITY_DATE_SORTS, type ActivityDateSort } from '@/lib/crm-activity-dates';
import type { ExtraSort } from '@/lib/crm-list-sort';

interface CustomFieldOption {
  name: string;
  label: string;
  options: string[];
}

interface CompanyFiltersProps {
  q: string;
  industry: string;
  lifecycle: string;
  owner: string;
  /** Tag activo (?tag=) y tags disponibles. */
  tag?: string;
  tags?: Array<{ id: string; name: string }>;
  createdFrom: string;
  createdTo: string;
  /** Fecha de última actividad (filtro rápido), días YYYY-MM-DD. */
  activityFrom?: string;
  activityTo?: string;
  custom: Record<string, string>;
  /** Query param `filters` crudo (advanced filter builder); se preserva al navegar. */
  advanced?: string;
  sort: 'newest' | 'oldest' | 'name' | 'name_desc' | ActivityDateSort | ExtraSort;
  industries: string[];
  lifecycles: Array<{ value: string; label: string }>;
  owners: Array<{ value: string; label: string }>;
  customFields: CustomFieldOption[];
  /** Órdenes por owner y custom fields (lib/crm-list-sort.ts). */
  extraSorts?: Array<{ value: string; label: string }>;
  /** El botón de filtros avanzados (AdvancedFilters): va en la fila de filtros rápidos. */
  children?: React.ReactNode;
  /** Params que se conservan al filtrar (vista activa, columnas; lib/crm-views-shared.ts). */
  keep?: Record<string, string>;
}

/**
 * Barra del listado de empresas, como la de HubSpot: búsqueda, orden y columnas
 * arriba; abajo los filtros rápidos (owner, fecha de creación, última
 * actividad, etapa del ciclo de vida, industria), "Más filtros" y los avanzados.
 * Todo server-side vía query params.
 */
export default function CompanyFilters({
  q,
  industry,
  lifecycle,
  owner,
  tag = '',
  tags = [],
  createdFrom,
  createdTo,
  activityFrom = '',
  activityTo = '',
  custom,
  advanced,
  sort,
  industries,
  lifecycles,
  owners,
  customFields,
  extraSorts = [],
  children,
  keep = {},
}: CompanyFiltersProps) {
  const t = useTranslations('crm');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState(q);

  function go(patch: Record<string, string | undefined>) {
    const params = new URLSearchParams();
    const current: Record<string, string | undefined> = {
      q: q || undefined,
      industry: industry || undefined,
      lifecycle: lifecycle || undefined,
      owner: owner || undefined,
      tag: tag || undefined,
      createdFrom: createdFrom || undefined,
      createdTo: createdTo || undefined,
      activityFrom: activityFrom || undefined,
      activityTo: activityTo || undefined,
      filters: advanced || undefined,
      sort: sort !== 'newest' ? sort : undefined,
      ...keep,
      ...patch,
    };
    for (const [key, value] of Object.entries(current)) {
      if (value) params.set(key, value);
    }
    for (const [name, value] of Object.entries(custom)) {
      if (`custom_${name}` in patch) continue;
      if (value) params.set(`custom_${name}`, value);
    }
    for (const [name, value] of Object.entries(patch)) {
      if (name.startsWith('custom_') && !value) params.delete(name);
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function setCustom(name: string, value: string) {
    go({ [`custom_${name}`]: value || undefined });
  }

  const activeFilters = [
    q,
    industry,
    lifecycle,
    owner,
    tag,
    createdFrom,
    createdTo,
    activityFrom,
    activityTo,
    ...Object.values(custom),
  ].filter(Boolean).length;
  const moreActive = [tag, ...Object.values(custom)].filter(Boolean).length;
  const [moreOpen, setMoreOpen] = useState(moreActive > 0);

  return (
    // La misma barra que deals (styles/crm.css .deals-filter-bar): las tres listas se ven igual.
    <div className="filter-bar deals-filter-bar">
      <div className="filter-toolbar">
        <form
          className="filter-search"
          role="search"
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
            placeholder={t('companies.searchPlaceholder')}
            aria-label={t('companies.searchPlaceholder')}
          />
        </form>

        <div className="filter-right">
          <select
            className="filter-select filter-sort"
            value={sort}
            onChange={(e) => go({ sort: e.target.value === 'newest' ? undefined : e.target.value })}
            aria-label={t('common.sortBy')}
          >
            <option value="newest">{t('companies.sortNewest')}</option>
            <option value="oldest">{t('companies.sortOldest')}</option>
            <option value="name">{t('companies.sortName')}</option>
            <option value="name_desc">{t('companies.sortNameDesc')}</option>
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

      <div className="filter-quick" role="group" aria-label={t('dateFilter.quickFilters')} data-testid="quick-filters">
        <select
          className={`filter-select${owner ? ' on' : ''}`}
          value={owner}
          onChange={(e) => go({ owner: e.target.value || undefined })}
          aria-label={t('listBar.companyOwner')}
          data-testid="companies-owner-filter"
        >
          <option value="">{t('listBar.companyOwner')}</option>
          <option value={OWNER_UNASSIGNED}>{t('listBar.noOwner')}</option>
          {owners.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <DateRangeFilter
          label={t('dateFilter.created')}
          kind="past"
          from={createdFrom}
          to={createdTo}
          locale={locale}
          testId="companies-created-filter"
          onChange={(f, tt) => go({ createdFrom: f || undefined, createdTo: tt || undefined })}
        />
        <DateRangeFilter
          label={t('dateFilter.activity')}
          kind="past"
          from={activityFrom}
          to={activityTo}
          locale={locale}
          testId="companies-activity-filter"
          onChange={(f, tt) => go({ activityFrom: f || undefined, activityTo: tt || undefined })}
        />
        <select
          className={`filter-select${lifecycle ? ' on' : ''}`}
          value={lifecycle}
          onChange={(e) => go({ lifecycle: e.target.value || undefined })}
          aria-label={t('listBar.lifecycleStage')}
          data-testid="companies-lifecycle-filter"
        >
          <option value="">{t('listBar.lifecycleStage')}</option>
          {lifecycles.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          className={`filter-select${industry ? ' on' : ''}`}
          value={industry}
          onChange={(e) => go({ industry: e.target.value || undefined })}
          aria-label={t('companies.filterIndustry')}
          data-testid="companies-industry-filter"
        >
          <option value="">{t('companies.filterIndustry')}</option>
          {industries.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={`filter-more${moreOpen ? ' open' : ''}${moreActive ? ' on' : ''}`}
          onClick={() => setMoreOpen((v) => !v)}
          aria-expanded={moreOpen}
        >
          {t('common.moreFilters')}
          {moreActive > 0 && <span className="filter-count">{moreActive}</span>}
        </button>
        {children}
        {activeFilters > 0 && (
          <button
            type="button"
            className="filter-clear"
            data-testid="quick-clear"
            onClick={() => {
              setSearch('');
              go({
                q: undefined,
                industry: undefined,
                lifecycle: undefined,
                owner: undefined,
                tag: undefined,
                createdFrom: undefined,
                createdTo: undefined,
                activityFrom: undefined,
                activityTo: undefined,
                ...Object.fromEntries(Object.keys(custom).map((k) => [`custom_${k}`, undefined])),
              });
            }}
          >
            {t('common.clear')}
          </button>
        )}
      </div>

      {moreOpen && (
        <div className="filter-more-panel">
          {tags.length > 0 && (
            <label className="filter-field">
              <span className="label">{t('tags.filter')}</span>
              <select
                className={`filter-select${tag ? ' on' : ''}`}
                value={tag}
                onChange={(e) => go({ tag: e.target.value || undefined })}
                data-testid="tag-filter"
              >
                <option value="">{t('common.all')}</option>
                {tags.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
          )}
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
          {tags.length === 0 && customFields.length === 0 && <p className="muted filter-more-empty">{t('listBar.noMoreFilters')}</p>}
        </div>
      )}
    </div>
  );
}
