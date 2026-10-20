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
  /** Filtro "Creado por" (id real de la persona). */
  creator?: string | null;
  creators?: Array<{ id: string; name: string }>;
}

/** Búsqueda, estado, tag y orden (todo por query params, del lado del server). */
export default function FilterBar({ q, tag, archived, sort, tags, creator = null, creators = [] }: FilterBarProps) {
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
      creator: creator ?? undefined,
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
    <div className="lk-filters">
      <form
        className="lk-search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          go({ q: search.trim() || undefined });
        }}
      >
        <svg className="lk-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-4-4" />
        </svg>
        <input
          className="input"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('table.searchPlaceholder')}
          aria-label={t('table.searchLabel')}
        />
      </form>

      <div className="btn-group" role="group" aria-label={t('table.status')}>
        {archivedOptions.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className="btn btn-sm"
            aria-pressed={archived === opt.value}
            onClick={() => go({ archived: opt.value === '0' ? undefined : opt.value })}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {tags.length > 0 && (
        <select
          className="select lk-select-auto"
          value={tag ?? ''}
          onChange={(e) => go({ tag: e.target.value || undefined })}
          aria-label={t('table.tagLabel')}
        >
          <option value="">{t('table.allTags')}</option>
          {tags.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      )}

      {/* Con una sola persona el filtro no cambia nada, salvo que ya venga aplicado por URL. */}
      {(creators.length > 1 || creator) && (
        <select
          className="select lk-select-auto"
          value={creator ?? ''}
          onChange={(e) => go({ creator: e.target.value || undefined })}
          aria-label={t('table.creatorLabel')}
        >
          <option value="">{t('table.allCreators')}</option>
          {creators.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}

      <select
        className="select lk-select-auto"
        value={sort}
        onChange={(e) => go({ sort: e.target.value === 'clicks' ? 'clicks' : undefined })}
        aria-label={t('table.sortLabel')}
      >
        <option value="created">{t('table.sortDate')}</option>
        <option value="clicks">{t('table.sortClicks')}</option>
      </select>
    </div>
  );
}
