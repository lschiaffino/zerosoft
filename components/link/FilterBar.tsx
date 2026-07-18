'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';

interface FilterBarProps {
  q: string;
  tag: string | null;
  archived: '0' | '1' | 'all';
  sort: 'created' | 'clicks';
  tags: string[];
}

/** Search box, tag chips, archived toggle and sort selector (all server-side via query params). */
export default function FilterBar({ q, tag, archived, sort, tags }: FilterBarProps) {
  const t = useTranslations('link');
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState(q);

  function go(patch: Record<string, string | undefined>) {
    const params = new URLSearchParams();
    const current: Record<string, string | undefined> = {
      q: q || undefined,
      tag: tag ?? undefined,
      archived: archived !== '0' ? archived : undefined,
      sort: sort !== 'created' ? sort : undefined,
      ...patch,
    };
    for (const [key, value] of Object.entries(current)) {
      if (value) params.set(key, value);
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  const archivedOptions: Array<{ value: '0' | '1' | 'all'; label: string }> = [
    { value: '0', label: t('table.archivedOff') },
    { value: '1', label: t('table.archivedOn') },
    { value: 'all', label: t('table.archivedAll') },
  ];

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
          placeholder={t('table.searchPlaceholder')}
          aria-label={t('table.searchPlaceholder')}
        />
      </form>

      <div className="filter-row">
        <div className="filter-chips">
          <button
            type="button"
            className={`chip${!tag ? ' active' : ''}`}
            onClick={() => go({ tag: undefined })}
          >
            {t('table.allTags')}
          </button>
          {tags.map((tagName) => (
            <button
              key={tagName}
              type="button"
              className={`chip${tag === tagName ? ' active' : ''}`}
              onClick={() => go({ tag: tag === tagName ? undefined : tagName })}
            >
              {tagName}
            </button>
          ))}
        </div>

        <div className="filter-right">
          <div className="filter-chips">
            {archivedOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`chip${archived === opt.value ? ' active' : ''}`}
                onClick={() => go({ archived: opt.value === '0' ? undefined : opt.value })}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <select
            className="select filter-sort"
            value={sort}
            onChange={(e) => go({ sort: e.target.value === 'clicks' ? 'clicks' : undefined })}
            aria-label="sort"
          >
            <option value="created">{t('table.sortDate')}</option>
            <option value="clicks">{t('table.sortClicks')}</option>
          </select>
        </div>
      </div>
    </div>
  );
}
