'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';

export type ContactSort = 'newest' | 'oldest' | 'name' | 'name_desc' | 'email' | 'email_desc';

interface SavedView {
  id: string;
  name: string;
}

interface ContactsFiltersProps {
  q: string;
  lifecycle: string;
  leadStatus: string;
  source: string;
  sort: ContactSort;
  lifecycles: string[];
  leadStatuses: string[];
  sources: string[];
  views: SavedView[];
  activeViewId: string | null;
}

/**
 * Barra de filtros del listado de contactos: búsqueda, selects de
 * lifecycle/lead status/origen, sort y vistas guardadas (todo server-side
 * via query params; guardar/borrar vistas va por API + refresh).
 */
export default function ContactsFilters({
  q,
  lifecycle,
  leadStatus,
  source,
  sort,
  lifecycles,
  leadStatuses,
  sources,
  views,
  activeViewId,
}: ContactsFiltersProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState(q);
  const [viewName, setViewName] = useState('');
  const [savingView, setSavingView] = useState(false);

  function go(patch: Record<string, string | undefined>) {
    const params = new URLSearchParams();
    const current: Record<string, string | undefined> = {
      q: q || undefined,
      lifecycle: lifecycle || undefined,
      leadStatus: leadStatus || undefined,
      source: source || undefined,
      sort: sort !== 'newest' ? sort : undefined,
      view: activeViewId ?? undefined,
      ...patch,
    };
    for (const [key, value] of Object.entries(current)) {
      if (value) params.set(key, value);
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  async function saveView(e: React.FormEvent) {
    e.preventDefault();
    const name = viewName.trim();
    if (!name) return;
    setSavingView(true);
    const query: Record<string, string> = {};
    if (q) query.q = q;
    if (lifecycle) query.lifecycle = lifecycle;
    if (leadStatus) query.leadStatus = leadStatus;
    if (source) query.source = source;
    if (sort !== 'newest') query.sort = sort;
    await fetch('/api/crm/views', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entity: 'contacts', name, query }),
    }).catch(() => null);
    setSavingView(false);
    setViewName('');
    router.refresh();
  }

  async function deleteView(id: string) {
    await fetch(`/api/crm/views/${id}`, { method: 'DELETE' }).catch(() => null);
    if (id === activeViewId) {
      go({ view: undefined });
      return;
    }
    router.refresh();
  }

  return (
    <div className="filter-bar">
      <form
        className="filter-search"
        onSubmit={(e) => {
          e.preventDefault();
          go({ q: search.trim() || undefined, view: undefined });
        }}
      >
        <input
          className="input"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('contacts.searchPlaceholder')}
          aria-label={t('contacts.searchPlaceholder')}
        />
      </form>

      <div className="filter-row">
        <div className="filter-right">
          <select
            className="filter-select"
            value={lifecycle}
            onChange={(e) => go({ lifecycle: e.target.value || undefined, view: undefined })}
            aria-label={t('contacts.filterLifecycle')}
          >
            <option value="">{t('contacts.filterLifecycle')}</option>
            {lifecycles.map((v) => (
              <option key={v} value={v}>
                {t(`enums.lifecycle.${v}`)}
              </option>
            ))}
          </select>
          <select
            className="filter-select"
            value={leadStatus}
            onChange={(e) => go({ leadStatus: e.target.value || undefined, view: undefined })}
            aria-label={t('contacts.filterLeadStatus')}
          >
            <option value="">{t('contacts.filterLeadStatus')}</option>
            {leadStatuses.map((v) => (
              <option key={v} value={v}>
                {t(`enums.leadStatus.${v}`)}
              </option>
            ))}
          </select>
          <select
            className="filter-select"
            value={source}
            onChange={(e) => go({ source: e.target.value || undefined, view: undefined })}
            aria-label={t('contacts.filterSource')}
          >
            <option value="">{t('contacts.filterSource')}</option>
            {sources.map((v) => (
              <option key={v} value={v}>
                {t(`enums.source.${v}`)}
              </option>
            ))}
          </select>
          <select
            className="filter-select"
            value={sort}
            onChange={(e) => go({ sort: e.target.value === 'newest' ? undefined : e.target.value })}
            aria-label="sort"
          >
            <option value="newest">{t('contacts.sortNewest')}</option>
            <option value="oldest">{t('contacts.sortOldest')}</option>
            <option value="name">{t('contacts.sortName')}</option>
            <option value="name_desc">{t('contacts.sortNameDesc')}</option>
            <option value="email">{t('contacts.sortEmail')}</option>
            <option value="email_desc">{t('contacts.sortEmailDesc')}</option>
          </select>
        </div>
      </div>

      <div className="filter-row views-row">
        <div className="filter-chips">
          <button
            type="button"
            className={`chip${!activeViewId ? ' active' : ''}`}
            onClick={() => go({ view: undefined })}
          >
            {t('common.all')}
          </button>
          {views.map((v) => (
            <span key={v.id} className={`chip chip-view${activeViewId === v.id ? ' active' : ''}`}>
              <button
                type="button"
                className="chip-view-name"
                onClick={() => go({ view: v.id })}
              >
                {v.name}
              </button>
              <button
                type="button"
                className="chip-view-del"
                onClick={() => deleteView(v.id)}
                title={t('contacts.savedViews.delete')}
                aria-label={t('contacts.savedViews.delete')}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
        <form className="view-save" onSubmit={saveView}>
          <input
            className="input"
            type="text"
            value={viewName}
            onChange={(e) => setViewName(e.target.value)}
            placeholder={t('contacts.savedViews.namePlaceholder')}
            aria-label={t('contacts.savedViews.namePlaceholder')}
            maxLength={200}
          />
          <button type="submit" className="btn btn-ghost btn-small" disabled={savingView || !viewName.trim()}>
            {t('contacts.savedViews.saveCurrent')}
          </button>
        </form>
      </div>
    </div>
  );
}
