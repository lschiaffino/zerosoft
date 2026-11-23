'use client';

import { Fragment, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { ColumnsSlot } from './ColumnToggle';
import DateRangeFilter from './DateRangeFilter';
import QuickFilterPicker from './QuickFilterPicker';
import ExportViewButton from './ExportViewButton';
import { quickFiltersFor } from '@/lib/crm-quick-filters';
import { ACTIVITY_DATE_SORTS, type ActivityDateSort } from '@/lib/crm-activity-dates';
import type { ExtraSort } from '@/lib/crm-list-sort';

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
  /** Tag activo (?tag=) y tags disponibles. */
  tag?: string;
  tags?: Array<{ id: string; name: string }>;
  /** ?stalled=1: solo deals abiertos que pasaron el umbral de rotting de su etapa. */
  stalled?: boolean;
  createdFrom: string;
  createdTo: string;
  /** Fecha de cierre y última actividad (filtros rápidos, como en HubSpot). */
  closeFrom?: string;
  closeTo?: string;
  activityFrom?: string;
  activityTo?: string;
  /** "Sin actividad" en el filtro de última actividad (?noActivity=1). */
  noActivity?: boolean;
  /** Filtros rápidos que muestra la vista (?qf=; lib/crm-quick-filters.ts). */
  qf?: string;
  /** "Exportar la vista" (admins, en la tabla). */
  canExport?: boolean;
  locale?: string;
  /** Pipeline y cambio tabla/board: a la derecha de la búsqueda. */
  trailing?: React.ReactNode;
  custom: Record<string, string>;
  /** Query param `filters` crudo (advanced filter builder); se preserva al navegar. */
  advanced?: string;
  sort: 'newest' | 'oldest' | 'amount' | 'amount_asc' | 'close_date' | 'close_date_desc' | ActivityDateSort | ExtraSort;
  stages: Array<{ id: string; name: string }>;
  priorities: Array<{ value: string; label: string }>;
  sources: Array<{ value: string; label: string }>;
  owners: Array<{ value: string; label: string }>;
  customFields: CustomFieldOption[];
  /** Órdenes por owner y custom fields (lib/crm-list-sort.ts). */
  extraSorts?: Array<{ value: string; label: string }>;
  /** El botón de filtros avanzados (AdvancedFilters): va en la barra, al lado de "Más filtros". */
  children?: React.ReactNode;
  /** Params que se conservan al filtrar (vista activa, columnas; lib/crm-views-shared.ts). */
  keep?: Record<string, string>;
  /** En el board no hay filtro por etapa (las columnas son las etapas), ni orden ni columnas. */
  layout?: 'table' | 'board';
}

/** Filtros de la vista tabla de deals (server-side vía query params). */
export default function DealsFilters({
  pipeline,
  q,
  stageId,
  priority,
  source,
  owner,
  tag = '',
  tags = [],
  stalled = false,
  createdFrom,
  createdTo,
  closeFrom = '',
  closeTo = '',
  activityFrom = '',
  activityTo = '',
  noActivity = false,
  qf = '',
  canExport = false,
  locale = 'en',
  trailing,
  custom,
  advanced,
  sort,
  stages,
  priorities,
  sources,
  owners,
  customFields,
  extraSorts = [],
  children,
  keep = {},
  layout = 'table',
}: DealsFiltersProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState(q);

  function go(patch: Record<string, string | undefined>) {
    const params = new URLSearchParams();
    const current: Record<string, string | undefined> = {
      pipeline,
      view: layout === 'table' ? 'table' : undefined,
      q: q || undefined,
      stageId: stageId || undefined,
      priority: priority || undefined,
      source: source || undefined,
      owner: owner || undefined,
      tag: tag || undefined,
      stalled: stalled ? '1' : undefined,
      createdFrom: createdFrom || undefined,
      createdTo: createdTo || undefined,
      closeFrom: closeFrom || undefined,
      closeTo: closeTo || undefined,
      activityFrom: activityFrom || undefined,
      activityTo: activityTo || undefined,
      noActivity: noActivity ? '1' : undefined,
      filters: advanced || undefined,
      qf: qf || undefined,
      sort: sort !== 'newest' ? sort : undefined,
      ...keep,
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
    tag,
    stalled,
    createdFrom,
    createdTo,
    closeFrom,
    closeTo,
    activityFrom,
    activityTo,
    noActivity,
    ...Object.values(custom),
  ].filter(Boolean).length;
  // Los filtros rápidos de la vista, en su orden (en el board no hay etapa: las columnas son las etapas).
  const chosen = quickFiltersFor('deals', qf).filter((id) => layout === 'table' || id !== 'stage');
  // Un filtro con valor sigue a la vista aunque la vista no lo muestre (si no, quedaría aplicado sin control).
  const activeById: Record<string, unknown> = { owner, created: createdFrom || createdTo, close: closeFrom || closeTo, activity: activityFrom || activityTo || noActivity, stage: layout === 'table' ? stageId : '' };
  const shown = [...chosen, ...Object.keys(activeById).filter((id) => activeById[id] && !chosen.includes(id))];
  const inRow = (id: string) => shown.includes(id);
  // Lo que vive en "Más filtros" (lo que no está en la fila).
  const moreActive = [
    inRow('priority') ? '' : priority,
    inRow('source') ? '' : source,
    inRow('tag') ? '' : tag,
    inRow('stalled') ? false : stalled,
    ...Object.values(custom),
  ].filter(Boolean).length;
  const [moreOpen, setMoreOpen] = useState(moreActive > 0);

  const quick: Record<string, ReactNode> = {
    owner: (
      <select
        className={`filter-select${owner ? ' on' : ''}`}
        value={owner}
        onChange={(e) => go({ owner: e.target.value || undefined })}
        aria-label={t('deals.filterOwner')}
        data-testid="deals-owner-filter"
      >
        <option value="">{t('deals.filterOwner')}</option>
        {owners.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    ),
    created: (
      <DateRangeFilter
        label={t('dateFilter.created')}
        kind="past"
        from={createdFrom}
        to={createdTo}
        locale={locale}
        testId="deals-created-filter"
        onChange={(f, tt) => go({ createdFrom: f || undefined, createdTo: tt || undefined })}
      />
    ),
    close: (
      <DateRangeFilter
        label={t('dateFilter.close')}
        kind="future"
        from={closeFrom}
        to={closeTo}
        locale={locale}
        testId="deals-close-filter"
        onChange={(f, tt) => go({ closeFrom: f || undefined, closeTo: tt || undefined })}
      />
    ),
    activity: (
      <DateRangeFilter
        label={t('dateFilter.activity')}
        kind="past"
        from={activityFrom}
        to={activityTo}
        locale={locale}
        testId="deals-activity-filter"
        none={noActivity}
        onNone={() => go({ activityFrom: undefined, activityTo: undefined, noActivity: '1' })}
        onChange={(f, tt) => go({ activityFrom: f || undefined, activityTo: tt || undefined, noActivity: undefined })}
      />
    ),
    stage: (
      <select
        className={`filter-select${stageId ? ' on' : ''}`}
        value={stageId}
        onChange={(e) => go({ stageId: e.target.value || undefined })}
        aria-label={t('deals.table.stage')}
        data-testid="deals-stage-filter"
      >
        <option value="">{t('deals.table.stage')}</option>
        {stages.map((st) => (
          <option key={st.id} value={st.id}>
            {st.name}
          </option>
        ))}
      </select>
    ),
    priority: (
      <select
        className={`filter-select${priority ? ' on' : ''}`}
        value={priority}
        onChange={(e) => go({ priority: e.target.value || undefined })}
        aria-label={t('deals.table.priority')}
        data-testid="deals-priority-filter"
      >
        <option value="">{t('deals.table.priority')}</option>
        {priorities.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
    ),
    source: (
      <select
        className={`filter-select${source ? ' on' : ''}`}
        value={source}
        onChange={(e) => go({ source: e.target.value || undefined })}
        aria-label={t('deals.filterSource')}
        data-testid="deals-source-filter"
      >
        <option value="">{t('deals.filterSource')}</option>
        {sources.map((x) => (
          <option key={x.value} value={x.value}>
            {x.label}
          </option>
        ))}
      </select>
    ),
    tag: tags.length ? (
      <select
        className={`filter-select${tag ? ' on' : ''}`}
        value={tag}
        onChange={(e) => go({ tag: e.target.value || undefined })}
        aria-label={t('tags.filter')}
        data-testid="deals-tag-filter"
      >
        <option value="">{t('tags.filter')}</option>
        {tags.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </select>
    ) : null,
    stalled: (
      <button
        type="button"
        className={`filter-select filter-btn${stalled ? ' on' : ''}`}
        onClick={() => go({ stalled: stalled ? undefined : '1' })}
        aria-pressed={stalled}
        data-testid="deals-stalled-quick"
      >
        {t('deals.filterStalled')}
      </button>
    ),
  };
  const quickLabels: Record<string, string> = {
    owner: t('deals.filterOwner'),
    created: t('dateFilter.created'),
    close: t('dateFilter.close'),
    activity: t('dateFilter.activity'),
    stage: t('deals.table.stage'),
    priority: t('deals.table.priority'),
    source: t('deals.filterSource'),
    tag: t('tags.filter'),
    stalled: t('deals.filterStalled'),
  };

  return (
    <div className="filter-bar deals-filter-bar">
      <div className="filter-toolbar">
        <form
          className="filter-search"
          role="search"
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
        <div className="filter-right">
          {trailing}
          {layout === 'table' && (
            <>
              <select
                className="filter-select filter-sort"
                value={sort}
                onChange={(e) => go({ sort: e.target.value === 'newest' ? undefined : e.target.value })}
                aria-label={t('common.sortBy')}
              >
                <option value="newest">{t('deals.sortNewest')}</option>
                <option value="oldest">{t('deals.sortOldest')}</option>
                <option value="amount">{t('deals.sortAmount')}</option>
                <option value="amount_asc">{t('deals.sortAmountAsc')}</option>
                <option value="close_date">{t('deals.sortCloseDate')}</option>
                <option value="close_date_desc">{t('deals.sortCloseDesc')}</option>
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
              {canExport && <ExportViewButton entity="deals" />}
              <ColumnsSlot />
            </>
          )}
        </div>
      </div>

      <div className="filter-quick" role="group" aria-label={t('dateFilter.quickFilters')} data-testid="quick-filters">
        {shown.map((id) => (
          <Fragment key={id}>{quick[id]}</Fragment>
        ))}
        <button
          type="button"
          className={`filter-more${moreOpen ? ' open' : ''}${moreActive ? ' on' : ''}`}
          onClick={() => setMoreOpen((v) => !v)}
          aria-expanded={moreOpen}
          data-testid="deals-more-filters"
        >
          {t('common.moreFilters')}
          {moreActive > 0 && <span className="filter-count">{moreActive}</span>}
        </button>
        {children}
        <QuickFilterPicker entity="deals" shown={chosen} labels={quickLabels} onChange={(v) => go({ qf: v })} />
        {activeFilters > 0 && (
          <button
            type="button"
            className="filter-clear"
            onClick={() =>
              go({
                q: undefined,
                stageId: undefined,
                priority: undefined,
                source: undefined,
                owner: undefined,
                tag: undefined,
                stalled: undefined,
                createdFrom: undefined,
                createdTo: undefined,
                closeFrom: undefined,
                closeTo: undefined,
                activityFrom: undefined,
                activityTo: undefined,
                noActivity: undefined,
              })
            }
          >
            {t('common.clear')}
          </button>
        )}
      </div>

      {moreOpen && (
        <div className="filter-more-panel">
          {!inRow('priority') && (
          <label className="filter-field">
            <span className="label">{t('deals.table.priority')}</span>
            <select
              className={`filter-select${priority ? ' on' : ''}`}
              value={priority}
              onChange={(e) => go({ priority: e.target.value || undefined })}
              aria-label={t('deals.table.priority')}
            >
              <option value="">{t('common.all')}</option>
              {priorities.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          )}
          {!inRow('source') && (
          <label className="filter-field">
            <span className="label">{t('deals.filterSource')}</span>
            <select
              className={`filter-select${source ? ' on' : ''}`}
              value={source}
              onChange={(e) => go({ source: e.target.value || undefined })}
            >
              <option value="">{t('common.all')}</option>
              {sources.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          )}
          {tags.length > 0 && !inRow('tag') && (
            <label className="filter-field">
              <span className="label">{t('tags.filter')}</span>
              <select
                className={`filter-select${tag ? ' on' : ''}`}
                value={tag}
                onChange={(e) => go({ tag: e.target.value || undefined })}
                aria-label={t('tags.filter')}
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
          {!inRow('stalled') && (
          <div className="filter-field">
            <span className="label">{t('deals.filterStalledLabel')}</span>
            <button
              type="button"
              className={`filter-more${stalled ? ' on' : ''}`}
              onClick={() => go({ stalled: stalled ? undefined : '1' })}
              aria-pressed={stalled}
              data-testid="stalled-filter"
            >
              {t('deals.filterStalled')}
            </button>
          </div>
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
        </div>
      )}
    </div>
  );
}
