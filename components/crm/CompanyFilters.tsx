'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';

interface CompanyFiltersProps {
  q: string;
  industry: string;
  lifecycle: string;
  sort: 'newest' | 'oldest' | 'name' | 'name_desc';
  industries: string[];
  lifecycles: Array<{ value: string; label: string }>;
}

/** Búsqueda + filtros de industria/lifecycle + sort (todo server-side vía query params). */
export default function CompanyFilters({
  q,
  industry,
  lifecycle,
  sort,
  industries,
  lifecycles,
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
      sort: sort !== 'newest' ? sort : undefined,
      ...patch,
    };
    for (const [key, value] of Object.entries(current)) {
      if (value) params.set(key, value);
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

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
            className="filter-select"
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
            className="filter-select"
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
        </div>

        <div className="filter-right">
          <select
            className="select filter-sort"
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
        </div>
      </div>
    </div>
  );
}
