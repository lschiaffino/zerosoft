'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';

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
}

/** Búsqueda + filtros de industria/lifecycle/owner/fecha/custom + sort (todo server-side vía query params). */
export default function CompanyFilters({
  q,
  industry,
  lifecycle,
  owner,
  createdFrom,
  createdTo,
  custom,
  advanced,
  sort,
  industries,
  lifecycles,
  owners,
  customFields,
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

  const activeFilters = [q, industry, lifecycle, owner, createdFrom, createdTo, ...Object.values(custom)].filter(
    Boolean,
  ).length;

  return (
    <div className="filter-bar">
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

      <div className="filter-row">
        <div className="filter-chips">
          <select
            className="filter-select filter-btn"
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
            className="filter-select filter-btn"
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
            className="filter-select filter-btn"
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
          <div className="filter-date-group">
            <input
              className="input filter-date"
              type="date"
              value={createdFrom}
              onChange={(e) => go({ createdFrom: e.target.value || undefined })}
              aria-label={t('companies.filterCreatedFrom')}
              placeholder={t('companies.filterCreatedFrom')}
            />
            <span className="filter-date-sep">—</span>
            <input
              className="input filter-date"
              type="date"
              value={createdTo}
              onChange={(e) => go({ createdTo: e.target.value || undefined })}
              aria-label={t('companies.filterCreatedTo')}
              placeholder={t('companies.filterCreatedTo')}
            />
          </div>
          {customFields.map((cf) => (
            <select
              key={cf.name}
              className="filter-select filter-btn"
              value={custom[cf.name] ?? ''}
              onChange={(e) => setCustom(cf.name, e.target.value)}
              aria-label={cf.label}
            >
              <option value="">{cf.label}</option>
              {cf.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ))}
        </div>

        <div className="filter-right">
          <select
            className="filter-select filter-sort"
            value={sort}
            onChange={(e) =>
              go({ sort: e.target.value === 'newest' ? undefined : e.target.value })
            }
            aria-label="sort"
          >
            <option value="newest">{t('companies.sortNewest')}</option>
            <option value="oldest">{t('companies.sortOldest')}</option>
            <option value="name">{t('companies.sortName')}</option>
            <option value="name_desc">{t('companies.sortNameDesc')}</option>
          </select>
          {activeFilters > 0 && (
            <button
              type="button"
              className="btn btn-ghost btn-small filter-clear"
              onClick={() =>
                go({
                  q: undefined,
                  industry: undefined,
                  lifecycle: undefined,
                  owner: undefined,
                  createdFrom: undefined,
                  createdTo: undefined,
                })
              }
            >
              {t('common.clear')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
