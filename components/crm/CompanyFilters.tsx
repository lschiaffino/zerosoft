'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { ColumnsSlot } from './ColumnToggle';
import QuickFilters, { type QuickFilterDef } from './QuickFilters';
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
  /** Rangos de los filtros rápidos (lib/crm-date-presets.ts): clave y, a medida, desde/hasta. */
  created?: string;
  activity?: string;
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
  created = '',
  activity = '',
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
      created: created || undefined,
      createdFrom: createdFrom || undefined,
      createdTo: createdTo || undefined,
      activity: activity || undefined,
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
    created,
    createdFrom,
    createdTo,
    activity,
    activityFrom,
    activityTo,
    ...Object.values(custom),
  ].filter(Boolean).length;
  const moreActive = [tag, ...Object.values(custom)].filter(Boolean).length;
  const [moreOpen, setMoreOpen] = useState(moreActive > 0);

  const quick: QuickFilterDef[] = [
    {
      kind: 'select',
      id: 'owner',
      param: 'owner',
      label: t('listBar.companyOwner'),
      value: owner,
      options: [{ value: OWNER_UNASSIGNED, label: t('listBar.noOwner') }, ...owners],
    },
    {
      kind: 'date',
      id: 'created',
      param: 'created',
      fromParam: 'createdFrom',
      toParam: 'createdTo',
      label: t('listBar.createDate'),
      preset: created,
      from: createdFrom,
      to: createdTo,
    },
    {
      kind: 'date',
      id: 'activity',
      param: 'activity',
      fromParam: 'activityFrom',
      toParam: 'activityTo',
      label: t('listBar.lastActivity'),
      preset: activity,
      from: activityFrom,
      to: activityTo,
      allowNone: true,
    },
    { kind: 'select', id: 'lifecycle', param: 'lifecycle', label: t('listBar.lifecycleStage'), value: lifecycle, options: lifecycles },
    {
      kind: 'select',
      id: 'industry',
      param: 'industry',
      label: t('companies.filterIndustry'),
      value: industry,
      options: industries.map((v) => ({ value: v, label: v })),
    },
  ];

  return (
    <div className="filter-bar hs-filters">
      <div className="filter-toolbar hs-toolbar">
        <form
          className="filter-search hs-search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            go({ q: search.trim() || undefined });
          }}
        >
          <svg className="hs-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
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

      <div className="hs-quick" role="group" aria-label={t('listBar.label')} data-testid="quick-filters">
        <QuickFilters filters={quick} onChange={go} />
        <span className="hs-quick-sep" aria-hidden="true" />
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
                created: undefined,
                createdFrom: undefined,
                createdTo: undefined,
                activity: undefined,
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
