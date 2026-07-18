'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';

interface DealsFiltersProps {
  pipeline: string;
  q: string;
  stageId: string;
  priority: string;
  sort: 'newest' | 'oldest' | 'amount' | 'close_date';
  stages: Array<{ id: string; name: string }>;
  priorities: Array<{ value: string; label: string }>;
}

/** Filtros de la vista tabla de deals (server-side vía query params). */
export default function DealsFilters({
  pipeline,
  q,
  stageId,
  priority,
  sort,
  stages,
  priorities,
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
      sort: sort !== 'newest' ? sort : undefined,
      ...patch,
    };
    for (const [key, value] of Object.entries(current)) {
      if (value) params.set(key, value);
    }
    router.push(`${pathname}?${params.toString()}`);
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
          placeholder={t('deals.table.searchPlaceholder')}
          aria-label={t('deals.table.searchPlaceholder')}
        />
      </form>

      <div className="filter-row">
        <div className="filter-chips">
          <select
            className="filter-select"
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
            className="filter-select"
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
        </div>

        <div className="filter-right">
          <select
            className="select filter-sort"
            value={sort}
            onChange={(e) => go({ sort: e.target.value === 'newest' ? undefined : e.target.value })}
            aria-label="sort"
          >
            <option value="newest">{t('deals.sortNewest')}</option>
            <option value="oldest">{t('deals.sortOldest')}</option>
            <option value="amount">{t('deals.sortAmount')}</option>
            <option value="close_date">{t('deals.sortCloseDate')}</option>
          </select>
        </div>
      </div>
    </div>
  );
}
