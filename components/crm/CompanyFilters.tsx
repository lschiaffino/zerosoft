'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { ColumnsSlot } from './ColumnToggle';

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
  custom: Record<string, string>;
  /** Query param `filters` crudo (advanced filter builder); se preserva al navegar. */
  advanced?: string;
  sort: 'newest' | 'oldest' | 'name' | 'name_desc';
  industries: string[];
  lifecycles: Array<{ value: string; label: string }>;
  owners: Array<{ value: string; label: string }>;
  customFields: CustomFieldOption[];
  /** Filtro avanzado (FilterBuilder): se muestra dentro de "Más filtros". */
  children?: React.ReactNode;
}

/** Búsqueda + filtros de industria/lifecycle/owner/fecha/custom + sort (todo server-side vía query params). */
export default function CompanyFilters({
  q,
  industry,
  lifecycle,
  owner,
  tag = '',
  tags = [],
  createdFrom,
  createdTo,
  custom,
  advanced,
  sort,
  industries,
  lifecycles,
  owners,
  customFields,
  children,
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
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function setCustom(name: string, value: string) {
    go({ [`custom_${name}`]: value || undefined });
  }

  const activeFilters = [q, industry, lifecycle, owner, tag, createdFrom, createdTo, ...Object.values(custom)].filter(
    Boolean,
  ).length;
  const moreActive = [createdFrom, createdTo, advanced, ...Object.values(custom)].filter(Boolean).length;
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
            placeholder={t('companies.searchPlaceholder')}
            aria-label={t('companies.searchPlaceholder')}
          />
        </form>
        <select
          className={`filter-select${industry ? ' on' : ''}`}
          value={industry}
          onChange={(e) => go({ industry: e.target.value || undefined })}
          aria-label={t('companies.filterIndustry')}
        >
          <option value="">{t('companies.filterIndustry')}</option>
          {industries.map((ind) => (
            <option key={ind} value={ind}>
              {ind}
            </option>
          ))}
        </select>
        <select
          className={`filter-select${lifecycle ? ' on' : ''}`}
          value={lifecycle}
          onChange={(e) => go({ lifecycle: e.target.value || undefined })}
          aria-label={t('companies.filterLifecycle')}
        >
          <option value="">{t('companies.filterLifecycle')}</option>
          {lifecycles.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
        <select
          className={`filter-select${owner ? ' on' : ''}`}
          value={owner}
          onChange={(e) => go({ owner: e.target.value || undefined })}
          aria-label={t('companies.filterOwner')}
        >
          <option value="">{t('companies.filterOwner')}</option>
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
                  industry: undefined,
                  lifecycle: undefined,
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
            <option value="newest">{t('companies.sortNewest')}</option>
            <option value="oldest">{t('companies.sortOldest')}</option>
            <option value="name">{t('companies.sortName')}</option>
            <option value="name_desc">{t('companies.sortNameDesc')}</option>
          </select>
          <ColumnsSlot />
        </div>
      </div>

      {moreOpen && (
        <div className="filter-more-panel">
          <label className="filter-field">
            <span className="label">{t('companies.filterCreatedFrom')}</span>
            <input
              className="input filter-date"
              type="date"
              value={createdFrom}
              onChange={(e) => go({ createdFrom: e.target.value || undefined })}
            />
          </label>
          <label className="filter-field">
            <span className="label">{t('companies.filterCreatedTo')}</span>
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
