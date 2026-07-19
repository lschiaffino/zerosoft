'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';

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
  createdFrom: string;
  createdTo: string;
  custom: Record<string, string>;
  sort: 'newest' | 'oldest' | 'amount' | 'amount_asc' | 'close_date' | 'close_date_desc';
  stages: Array<{ id: string; name: string }>;
  priorities: Array<{ value: string; label: string }>;
  sources: Array<{ value: string; label: string }>;
  owners: Array<{ value: string; label: string }>;
  customFields: CustomFieldOption[];
}

/** Filtros de la vista tabla de deals (server-side vía query params). */
export default function DealsFilters({
  pipeline,
  q,
  stageId,
  priority,
  source,
  owner,
  createdFrom,
  createdTo,
  custom,
  sort,
  stages,
  priorities,
  sources,
  owners,
  customFields,
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
      createdFrom: createdFrom || undefined,
      createdTo: createdTo || undefined,
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
    createdFrom,
    createdTo,
    ...Object.values(custom),
  ].filter(Boolean).length;

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
            className="filter-select filter-btn"
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
            className="filter-select filter-btn"
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
            className="filter-select filter-btn"
            value={source}
            onChange={(e) => go({ source: e.target.value || undefined })}
            aria-label={t('deals.filterSource')}
          >
            <option value="">{t('deals.filterSource')}</option>
            {sources.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <select
            className="filter-select filter-btn"
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
          <div className="filter-date-group">
            <input
              className="input filter-date"
              type="date"
              value={createdFrom}
              onChange={(e) => go({ createdFrom: e.target.value || undefined })}
              aria-label={t('deals.filterCreatedFrom')}
              placeholder={t('deals.filterCreatedFrom')}
            />
            <span className="filter-date-sep">—</span>
            <input
              className="input filter-date"
              type="date"
              value={createdTo}
              onChange={(e) => go({ createdTo: e.target.value || undefined })}
              aria-label={t('deals.filterCreatedTo')}
              placeholder={t('deals.filterCreatedTo')}
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
            onChange={(e) => go({ sort: e.target.value === 'newest' ? undefined : e.target.value })}
            aria-label="sort"
          >
            <option value="newest">{t('deals.sortNewest')}</option>
            <option value="oldest">{t('deals.sortOldest')}</option>
            <option value="amount">{t('deals.sortAmount')}</option>
            <option value="amount_asc">{t('deals.sortAmountAsc')}</option>
            <option value="close_date">{t('deals.sortCloseDate')}</option>
            <option value="close_date_desc">{t('deals.sortCloseDesc')}</option>
          </select>
          {activeFilters > 0 && (
            <button
              type="button"
              className="btn btn-ghost btn-small filter-clear"
              onClick={() =>
                go({
                  q: undefined,
                  stageId: undefined,
                  priority: undefined,
                  source: undefined,
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
