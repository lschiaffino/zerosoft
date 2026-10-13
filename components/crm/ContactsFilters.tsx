'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';

export type ContactSort = 'newest' | 'oldest' | 'name' | 'name_desc' | 'email' | 'email_desc';

interface SavedView {
  id: string;
  name: string;
}

interface CustomFieldOption {
  name: string;
  label: string;
  options: string[];
}

interface ContactsFiltersProps {
  q: string;
  lifecycle: string;
  leadStatus: string;
  source: string;
  owner: string;
  /** Tag activo (?tag=) y tags disponibles. */
  tag?: string;
  tags?: Array<{ id: string; name: string }>;
  createdFrom: string;
  createdTo: string;
  custom: Record<string, string>;
  /** Query param `filters` crudo (advanced filter builder); se preserva al navegar. */
  advanced?: string;
  sort: ContactSort;
  lifecycles: string[];
  leadStatuses: string[];
  sources: string[];
  owners: Array<{ value: string; label: string }>;
  customFields: CustomFieldOption[];
  views: SavedView[];
  activeViewId: string | null;
  /** Filtro avanzado (FilterBuilder): se muestra dentro de "Más filtros". */
  children?: React.ReactNode;
}

/**
 * Barra de filtros del listado de contactos: búsqueda, selects de
 * lifecycle/lead status/origen/owner/fecha/custom y sort; todo server-side
 * via query params; guardar/borrar vistas va por API + refresh.
 */
export default function ContactsFilters({
  q,
  lifecycle,
  leadStatus,
  source,
  owner,
  tag = '',
  tags = [],
  createdFrom,
  createdTo,
  custom,
  advanced,
  sort,
  lifecycles,
  leadStatuses,
  sources,
  owners,
  customFields,
  views,
  activeViewId,
  children,
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
      owner: owner || undefined,
      tag: tag || undefined,
      createdFrom: createdFrom || undefined,
      createdTo: createdTo || undefined,
      filters: advanced || undefined,
      sort: sort !== 'newest' ? sort : undefined,
      view: activeViewId ?? undefined,
      ...patch,
    };
    for (const [key, value] of Object.entries(current)) {
      if (value) params.set(key, value);
    }
    for (const [name, value] of Object.entries(custom)) {
      if (value) params.set(`custom_${name}`, value);
      else params.delete(`custom_${name}`);
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
    if (owner) query.owner = owner;
    if (tag) query.tag = tag;
    if (createdFrom) query.createdFrom = createdFrom;
    if (createdTo) query.createdTo = createdTo;
    if (advanced) query.filters = advanced;
    if (sort !== 'newest') query.sort = sort;
    Object.entries(custom).forEach(([k, v]) => {
      if (v) query[`custom_${k}`] = v;
    });
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

  const activeFilters = [
    q,
    lifecycle,
    leadStatus,
    source,
    owner,
    tag,
    createdFrom,
    createdTo,
    ...Object.values(custom),
  ].filter(Boolean).length;

  const moreActive = [source, createdFrom, createdTo, advanced, ...Object.values(custom)].filter(Boolean).length;
  const [moreOpen, setMoreOpen] = useState(moreActive > 0);
  const [savingOpen, setSavingOpen] = useState(false);

  return (
    <div className="filter-bar">
      <div className="views-tabs" role="tablist" aria-label={t('contacts.savedViews.title')}>
        <button
          type="button"
          role="tab"
          aria-selected={!activeViewId}
          className={`view-tab${!activeViewId ? ' active' : ''}`}
          onClick={() => go({ view: undefined })}
        >
          {t('common.all')}
        </button>
        {views.map((v) => (
          <span key={v.id} className={`view-tab${activeViewId === v.id ? ' active' : ''}`}>
            <button type="button" role="tab" aria-selected={activeViewId === v.id} onClick={() => go({ view: v.id })}>
              {v.name}
            </button>
            <button
              type="button"
              className="view-tab-del"
              onClick={() => deleteView(v.id)}
              title={t('contacts.savedViews.delete')}
              aria-label={t('contacts.savedViews.delete')}
            >
              ✕
            </button>
          </span>
        ))}
        {savingOpen ? (
          <form className="view-save" onSubmit={saveView}>
            <input
              className="input"
              type="text"
              autoFocus
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setSavingOpen(false)}
              placeholder={t('contacts.savedViews.namePlaceholder')}
              aria-label={t('contacts.savedViews.namePlaceholder')}
              maxLength={200}
            />
            <button type="submit" className="btn btn-solid btn-small" disabled={savingView || !viewName.trim()}>
              {t('common.save')}
            </button>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setSavingOpen(false)}>
              {t('common.cancel')}
            </button>
          </form>
        ) : (
          <button type="button" className="view-tab view-tab-add" onClick={() => setSavingOpen(true)}>
            + {t('contacts.savedViews.saveCurrent')}
          </button>
        )}
      </div>

      <div className="filter-toolbar">
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
        <select
          className={`filter-select${lifecycle ? ' on' : ''}`}
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
          className={`filter-select${leadStatus ? ' on' : ''}`}
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
          className={`filter-select${owner ? ' on' : ''}`}
          value={owner}
          onChange={(e) => go({ owner: e.target.value || undefined, view: undefined })}
          aria-label={t('contacts.filterOwner')}
        >
          <option value="">{t('contacts.filterOwner')}</option>
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
                  lifecycle: undefined,
                  leadStatus: undefined,
                  source: undefined,
                  owner: undefined,
                  tag: undefined,
                  createdFrom: undefined,
                  createdTo: undefined,
                  view: undefined,
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
            <option value="newest">{t('contacts.sortNewest')}</option>
            <option value="oldest">{t('contacts.sortOldest')}</option>
            <option value="name">{t('contacts.sortName')}</option>
            <option value="name_desc">{t('contacts.sortNameDesc')}</option>
            <option value="email">{t('contacts.sortEmail')}</option>
            <option value="email_desc">{t('contacts.sortEmailDesc')}</option>
          </select>
        </div>
      </div>

      {moreOpen && (
        <div className="filter-more-panel">
          <label className="filter-field">
            <span className="label">{t('contacts.filterSource')}</span>
            <select
              className={`filter-select${source ? ' on' : ''}`}
              value={source}
              onChange={(e) => go({ source: e.target.value || undefined, view: undefined })}
            >
              <option value="">{t('common.all')}</option>
              {sources.map((v) => (
                <option key={v} value={v}>
                  {t(`enums.source.${v}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span className="label">{t('contacts.filterCreatedFrom')}</span>
            <input
              className="input filter-date"
              type="date"
              value={createdFrom}
              onChange={(e) => go({ createdFrom: e.target.value || undefined, view: undefined })}
            />
          </label>
          <label className="filter-field">
            <span className="label">{t('contacts.filterCreatedTo')}</span>
            <input
              className="input filter-date"
              type="date"
              value={createdTo}
              onChange={(e) => go({ createdTo: e.target.value || undefined, view: undefined })}
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
