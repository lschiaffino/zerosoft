'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import EmptyState from '@/components/ui/EmptyState';
import FilterPanel, { FilterChips } from '@/components/ui/FilterPanel';
import { filterChips, fold, type ChipStrings, type FilterCategory, type FilterField, type FilterValues } from '@/lib/filter-panel';
import type { LabelDto, NumberDto, PropertyDef } from '@/lib/groups';
import { NONE, PROP_SET, PROP_UNSET, filtersToValues, propFieldId, serializeLinesFilters, valuesToFilters, type PropKinds } from '@/lib/groups-filters';
import { cleanHubspotFilters, formatHubspotValue, hubspotTime, type HubspotPropDef, type HubspotPropFilter } from '@/lib/groups-hubspot-shared';
import { propertyText } from '@/lib/groups-rules';
import type { GroupTableRow, GroupsTableDto } from '@/lib/groups-table';
import {
  GROUPS_TABLE_MAX,
  GROUP_COLUMNS,
  defaultView,
  hsColumn,
  hsColumnsOf,
  nextSort,
  parseView,
  propColumn,
  sortRows,
  toggleColumn,
  type GroupsView,
  type SortValue,
} from '@/lib/groups-table-view';
import HubspotFilter from './HubspotFilter';
import { filterOptions, PropertyValueText } from './PropertyInput';
import { useHubspotSchema } from './hubspot-client';
import { ChatPlate, LabelTag, api, useRelativeTime } from './ui';
import { FilterIcon } from './wa/icons';

const VIEW_STORE = 'zs-groups-view-v1';
/** Columnas de propiedades de la tabla anterior (solo claves). */
const LEGACY_STORE = 'zs-groups-columns';
const NO_HS: HubspotPropFilter[] = [];

/** El color de cada etiqueta, para el punto de la opción en el panel de filtros (los de .gr-label-*). */
const LABEL_HEX: Record<string, string> = {
  gray: 'var(--dim)',
  red: '#d93a40',
  orange: '#f2611d',
  yellow: '#e6b400',
  green: '#12a150',
  teal: '#00b8a9',
  blue: '#2f6bff',
  purple: '#7b4dff',
  pink: '#e23d7f',
};

function readStore(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

/**
 * Lines › Grupos como una vista de Linear: una fila por grupo de WhatsApp
 * (aunque esté en varias líneas), columnas a elección (del grupo, propiedades
 * de zerosoft y de la empresa de HubSpot), orden por cualquier columna,
 * filtro por línea y el panel de filtros. La vista se recuerda en este
 * navegador.
 */
export default function GroupsTable({
  initial,
  numbers,
  labels,
  properties,
  selected,
  onSelectedChange,
  onRowsChange,
  reloadSignal,
  toolbarEnd,
  emptyAction,
}: {
  initial: GroupsTableDto;
  numbers: NumberDto[];
  labels: LabelDto[];
  properties: PropertyDef[];
  /** Chats elegidos (el principal de cada fila) para las acciones en lote. */
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
  onRowsChange?: (rows: GroupTableRow[]) => void;
  /** Cambia para volver a pedir la tabla (después de crear o editar en lote). */
  reloadSignal: number;
  toolbarEnd: ReactNode;
  emptyAction?: ReactNode;
}) {
  const t = useTranslations('groups');
  const tf = useTranslations('common.ui.filter');
  const locale = useLocale();
  const rel = useRelativeTime();
  const propKeys = useMemo(() => properties.map((p) => p.key), [properties]);
  const [view, setView] = useState<GroupsView>(() => defaultView(propKeys));
  const [viewReady, setViewReady] = useState(false);
  const [q, setQ] = useState('');
  const [data, setData] = useState<GroupsTableDto | null>(initial);
  const [error, setError] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelField, setPanelField] = useState<string | null>(null);
  const [menu, setMenu] = useState<'lines' | 'columns' | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const filterBtn = useRef<HTMLButtonElement>(null);
  const hubspotOn = Boolean(data?.hubspot ?? initial.hubspot);
  const { schema } = useHubspotSchema(hubspotOn);
  const hsDefs = useMemo(() => new Map((schema?.props ?? []).map((d) => [d.name, d])), [schema]);
  const lineName = useMemo(() => new Map(numbers.map((n) => [n.id, n.name || (n.phone ? `+${n.phone}` : n.id)])), [numbers]);

  // La vista guardada en este navegador (columnas, orden, filtros).
  useEffect(() => {
    setView(parseView(readStore(VIEW_STORE), propKeys, readStore(LEGACY_STORE)));
    setViewReady(true);
  }, [propKeys]);
  const updateView = useCallback((fn: (v: GroupsView) => GroupsView) => {
    setView((prev) => {
      const next = fn(prev);
      try {
        window.localStorage.setItem(VIEW_STORE, JSON.stringify(next));
      } catch {
        // Sin storage: dura lo que la página.
      }
      return next;
    });
  }, []);

  // ---------- Datos ----------
  const filtersKey = serializeLinesFilters(view.filters);
  const statusKey = view.status.join(',');
  const hsKey = hubspotOn ? hsColumnsOf(view.columns).join(',') : '';
  const reqKey = JSON.stringify([filtersKey, statusKey, q.trim(), hsKey]);
  const lastKey = useRef(JSON.stringify(['', '', '', '']));
  const seq = useRef(0);
  const load = useCallback(async () => {
    const p = new URLSearchParams();
    if (filtersKey) p.set('f', filtersKey);
    if (statusKey) p.set('status', statusKey);
    if (q.trim()) p.set('q', q.trim());
    if (hsKey) p.set('hs', hsKey);
    p.set('tz', String(-new Date().getTimezoneOffset()));
    const mine = ++seq.current;
    const res = await api<GroupsTableDto>(`/api/groups/table?${p}`);
    if (mine !== seq.current) return;
    if (!res.data) {
      setError(true);
      return;
    }
    setError(false);
    setData(res.data);
  }, [filtersKey, statusKey, q, hsKey]);
  useEffect(() => {
    if (!viewReady || reqKey === lastKey.current) return;
    lastKey.current = reqKey;
    const id = setTimeout(() => void load(), 200);
    return () => clearTimeout(id);
  }, [reqKey, viewReady, load]);
  const firstSignal = useRef(reloadSignal);
  useEffect(() => {
    if (reloadSignal !== firstSignal.current) void load();
    // Solo cuando el padre pide recargar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadSignal]);

  // ---------- Columnas ----------
  const columnLabel = useCallback(
    (id: string): string => {
      if (id === 'name') return t('list.colName');
      if (id === 'lines') return t('gt.colLines');
      if (id === 'members') return t('list.colMembers');
      if (id === 'labels') return t('list.colLabels');
      if (id === 'company') return t('gt.colCompany');
      if (id === 'activity') return t('list.colActivity');
      if (id === 'created') return t('gt.colCreated');
      if (id === 'status') return t('gt.colStatus');
      if (id.startsWith('prop:')) return properties.find((p) => p.key === id.slice(5))?.label ?? id.slice(5);
      if (id.startsWith('hs:')) return hsDefs.get(id.slice(3))?.label ?? id.slice(3);
      return id;
    },
    [t, properties, hsDefs],
  );
  const shown = useMemo(
    () => view.columns.filter((c) => (c === 'company' || c.startsWith('hs:') ? hubspotOn : c.startsWith('prop:') ? propKeys.includes(c.slice(5)) : true)),
    [view.columns, hubspotOn, propKeys],
  );

  // ---------- Orden ----------
  const hsFormat = useMemo(() => ({ locale, owners: schema?.owners ?? [], yes: t('props.yes'), no: tf('no') }), [locale, schema, t, tf]);
  const sortValue = useCallback(
    (col: string, r: GroupTableRow): SortValue => {
      if (col === 'name') return r.name;
      if (col === 'lines') return r.lines.map((l) => lineName.get(l.numberId) ?? '').join(', ');
      if (col === 'members') return r.memberCount;
      if (col === 'labels') return r.labels[0]?.name ?? null;
      if (col === 'company') return r.company?.name ?? null;
      if (col === 'activity') return Date.parse(r.lastActivity) || null;
      if (col === 'created') return Date.parse(r.createdAt) || null;
      if (col === 'status') return r.status === 'open' ? t('gt.open') : t('gt.closed');
      if (col.startsWith('prop:')) {
        const def = properties.find((p) => p.key === col.slice(5));
        const v = r.properties[col.slice(5)];
        if (def?.type === 'number') return v === undefined || v === null || v === '' ? null : Number(v);
        return propertyText(v, def?.type) || null;
      }
      if (col.startsWith('hs:')) {
        const name = col.slice(3);
        const v = r.hs[name];
        if (!v) return null;
        const def = hsDefs.get(name);
        if (def?.kind === 'number') return Number.isFinite(Number(v)) ? Number(v) : v;
        if (def?.kind === 'date' || def?.kind === 'datetime') return hubspotTime(v);
        return formatHubspotValue(def ?? null, v, hsFormat);
      }
      return null;
    },
    [lineName, properties, hsDefs, hsFormat, t],
  );
  const rows = useMemo(() => {
    const list = data?.rows ?? [];
    if (!view.sort) return list;
    const { col, dir } = view.sort;
    return sortRows(list, dir, (r) => sortValue(col, r), locale);
  }, [data, view.sort, sortValue, locale]);
  useEffect(() => onRowsChange?.(rows), [rows, onRowsChange]);

  // ---------- Filtros ----------
  const propKinds = useMemo<PropKinds>(() => Object.fromEntries(properties.map((d) => [d.key, filterOptions(d).length > 0 ? 'multi' : 'text'])), [properties]);
  const categories = useMemo<FilterCategory[]>(() => (['status', 'dates', 'channel', 'labels', 'links'] as const).map((id) => ({ id, label: t(`fp.cats.${id}`) })), [t]);
  const fields = useMemo<FilterField[]>(() => {
    const out: FilterField[] = [
      {
        id: 'status',
        type: 'multi',
        category: 'status',
        label: t('gt.statusField'),
        keywords: t('fp.kw.status'),
        options: [
          { id: 'open', label: t('fp.statusOpen') },
          { id: 'closed', label: t('fp.statusClosed') },
        ],
      },
      { id: 'flagged', type: 'bool', category: 'status', label: t('fp.flagged'), help: t('fp.help.flagged'), keywords: t('fp.kw.flagged') },
      { id: 'lastMessage', type: 'date', category: 'dates', label: t('fp.lastMessage'), keywords: t('fp.kw.lastMessage') },
      { id: 'created', type: 'date', category: 'dates', label: t('fp.created'), help: t('fp.help.created'), keywords: t('fp.kw.created') },
      {
        id: 'lines',
        type: 'multi',
        category: 'channel',
        label: t('gt.colLines'),
        keywords: t('fp.kw.lines'),
        options: numbers.map((n) => ({ id: n.id, label: lineName.get(n.id) ?? n.id, hint: n.ownerName || undefined })),
      },
      {
        id: 'labels',
        type: 'multi',
        category: 'labels',
        label: t('fp.labels'),
        keywords: t('fp.kw.labels'),
        options: [{ id: NONE, label: t('fp.noLabel'), special: true }, ...labels.map((l) => ({ id: l.id, label: l.name, color: LABEL_HEX[l.color] ?? LABEL_HEX.gray }))],
      },
    ];
    for (const d of properties) {
      const opts = filterOptions(d);
      if (opts.length > 0) {
        out.push({
          id: propFieldId(d.key),
          type: 'multi',
          category: 'labels',
          label: d.label,
          options: [
            { id: PROP_SET, label: t('fp.propSet'), special: true },
            { id: PROP_UNSET, label: t('fp.propUnset'), special: true },
            ...opts.map((o) => ({ id: o, label: o === 'true' && d.type === 'checkbox' ? t('fp.propYes') : o })),
          ],
        });
      } else out.push({ id: propFieldId(d.key), type: 'text', category: 'labels', label: d.label });
    }
    if (hubspotOn || view.filters.hubspot) out.push({ id: 'hubspot', type: 'bool', category: 'links', label: t('fp.hubspot'), keywords: t('fp.kw.hubspot') });
    if (hubspotOn || view.filters.hsProps?.length) {
      out.push({
        id: 'hsProps',
        type: 'custom',
        category: 'links',
        label: t('fp.hsProps'),
        help: t('fp.help.hsProps'),
        keywords: t('fp.kw.hubspot'),
        count: (v) => cleanHubspotFilters(v).length,
        summary: (v) => t('fp.hsSummary', { n: cleanHubspotFilters(v).length }),
      });
    }
    return out;
  }, [t, numbers, lineName, labels, properties, hubspotOn, view.filters.hubspot, view.filters.hsProps]);
  const values = useMemo<FilterValues>(() => ({ ...filtersToValues(view.filters, propKinds), ...(view.status.length ? { status: view.status } : {}) }), [view.filters, view.status, propKinds]);
  const chipStrings = useMemo<ChipStrings>(() => {
    const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    return {
      yes: tf('yes'),
      no: tf('no'),
      presets: {
        today: tf('presets.today'),
        yesterday: tf('presets.yesterday'),
        last7: tf('presets.last7'),
        last30: tf('presets.last30'),
        thisWeek: tf('presets.thisWeek'),
        thisMonth: tf('presets.thisMonth'),
        lastMonth: tf('presets.lastMonth'),
      },
      from: (d) => tf('from', { day: d }),
      until: (d) => tf('until', { day: d }),
      range: (from, to) => tf('range', { from, to }),
      more: (n) => tf('more', { n }),
      unavailable: (n) => tf('unavailableShort', { n }),
      hasValue: tf('hasValue'),
      noValue: tf('noValue'),
      day: (d) => day.format(new Date(`${d}T00:00:00Z`)),
    };
  }, [tf, locale]);
  const chips = useMemo(() => filterChips(fields, values, chipStrings), [fields, values, chipStrings]);
  const applyValues = useCallback(
    (next: FilterValues) => {
      const status = (['open', 'closed'] as const).filter((s) => Array.isArray(next.status) && (next.status as string[]).includes(s));
      const { status: _s, q: _q, ...filters } = valuesToFilters({ ...next, status: undefined });
      updateView((v) => ({ ...v, status: status.length === 2 ? [] : status, filters }));
    },
    [updateView],
  );
  const setLines = (ids: string[]) =>
    updateView((v) => {
      const { lines: _l, ...rest } = v.filters;
      return { ...v, filters: ids.length ? { ...rest, lines: ids } : rest };
    });
  const filtering = q.trim() !== '' || chips.length > 0;

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.chatId));
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedChange(next);
  };
  const pickedLines = view.filters.lines ?? [];
  const linesText =
    pickedLines.length === 0 ? t('gt.allLines') : pickedLines.length === 1 ? (lineName.get(pickedLines[0]) ?? t('gt.nLines', { n: 1 })) : t('gt.nLines', { n: pickedLines.length });

  return (
    <>
      <div className="gr-toolbar gr-gt-toolbar" ref={toolbarRef}>
        <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('list.search')} aria-label={t('list.search')} />
        {numbers.length > 1 && (
          <Popover
            open={menu === 'lines'}
            onOpenChange={(o) => setMenu(o ? 'lines' : null)}
            button={
              <>
                <span className="gr-gt-btn-key">{t('gt.lines')}:</span> {linesText}
              </>
            }
            buttonLabel={`${t('gt.linesLabel')}: ${linesText}`}
            testId="groups-lines-button"
          >
            <div className="gr-gt-menu" role="group" aria-label={t('gt.linesLabel')}>
              <label className="gr-check-label gr-gt-option">
                <input type="checkbox" className="ui-check" checked={pickedLines.length === 0} onChange={() => setLines([])} />
                {t('gt.allLines')}
              </label>
              {numbers.map((n) => (
                <label key={n.id} className="gr-check-label gr-gt-option">
                  <input
                    type="checkbox"
                    className="ui-check"
                    checked={pickedLines.includes(n.id)}
                    onChange={() => setLines(pickedLines.includes(n.id) ? pickedLines.filter((x) => x !== n.id) : [...pickedLines, n.id])}
                  />
                  <span className="gr-gt-option-text">{lineName.get(n.id)}</span>
                  {n.phone && <span className="ui-help">+{n.phone}</span>}
                </label>
              ))}
            </div>
          </Popover>
        )}
        <button
          ref={filterBtn}
          type="button"
          className={`btn btn-secondary gr-gt-filter${chips.length ? ' is-on' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={panelOpen}
          aria-label={chips.length > 0 ? t('fp.openCount', { n: chips.length }) : t('fp.open')}
          data-testid="groups-filter-button"
          onClick={() => {
            setPanelField(null);
            setPanelOpen((v) => !v);
          }}
        >
          <FilterIcon size={16} />
          <span>{t('fp.open')}</span>
          {chips.length > 0 && <span className="gr-gt-count">{chips.length}</span>}
        </button>
        <Popover open={menu === 'columns'} onOpenChange={(o) => setMenu(o ? 'columns' : null)} button={t('list.columns')} testId="groups-columns-button" align="end">
          <ColumnsMenu
            view={view}
            hubspotOn={hubspotOn}
            properties={properties}
            hsProps={schema?.props ?? []}
            columnLabel={columnLabel}
            onToggle={(id) =>
              // Ocultar la columna por la que se ordena vuelve al orden de siempre.
              updateView((v) => ({ ...v, columns: toggleColumn(v.columns, id), sort: v.sort?.col === id && v.columns.includes(id) ? null : v.sort }))
            }
            onSort={(sort) => updateView((v) => ({ ...v, sort }))}
            onReset={() => updateView(() => defaultView(propKeys))}
          />
        </Popover>
        <span className="gr-toolbar-spacer" />
        {toolbarEnd}
      </div>
      <FilterChips chips={chips} onRemove={(id) => applyValues(Object.fromEntries(Object.entries(values).filter(([k]) => k !== id)))} onClear={() => applyValues({})} onOpen={(id) => {
        setPanelField(id);
        setPanelOpen(true);
      }} />

      {error && (
        <div className="gr-error" role="alert">
          {t('list.loadError')}
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load()}>
            {t('common.retry')}
          </button>
        </div>
      )}
      {data?.truncated && (
        <p className="gr-banner" role="status">
          {t('gt.truncated', { n: GROUPS_TABLE_MAX })}
        </p>
      )}

      {data === null ? (
        <div className="ui-loading-stack" aria-busy="true" aria-label={t('common.loading')}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="ui-skeleton ui-skeleton-row" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          quiet
          title={filtering ? (chips.length ? t('gt.filterEmpty') : t('list.noResults')) : t('list.emptyTitle')}
          body={filtering ? undefined : t('list.emptyBody')}
          action={filtering ? undefined : emptyAction}
          product="groups"
        />
      ) : (
        <div className="table-wrap table-stack gr-gt-wrap">
          <table className="table gr-table gr-gt-table" aria-label={t('list.title')}>
            <thead>
              <tr>
                <th className="gr-check-col">
                  <label className="tap-cell">
                    <input
                      type="checkbox"
                      className="ui-check"
                      checked={allSelected}
                      onChange={() => onSelectedChange(allSelected ? new Set() : new Set(rows.map((r) => r.chatId)))}
                      aria-label={t('list.selectAll')}
                    />
                  </label>
                </th>
                {['name', ...shown].map((c) => {
                  const on = view.sort?.col === c ? view.sort.dir : null;
                  return (
                    <th key={c} className={c === 'members' ? 'num' : undefined} aria-sort={on === 'asc' ? 'ascending' : on === 'desc' ? 'descending' : undefined}>
                      <button type="button" className="gr-gt-sort" onClick={() => updateView((v) => ({ ...v, sort: nextSort(v.sort, c) }))} title={t('gt.sortHeader', { col: columnLabel(c) })}>
                        {columnLabel(c)}
                        <span className="gr-gt-arrow" aria-hidden="true">
                          {on === 'asc' ? '↑' : on === 'desc' ? '↓' : ''}
                        </span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} data-group={r.key}>
                  <td className="gr-check-col">
                    <label className="tap-cell">
                      <input type="checkbox" className="ui-check" checked={selected.has(r.chatId)} onChange={() => toggle(r.chatId)} aria-label={t('list.select', { name: r.name })} />
                    </label>
                  </td>
                  <td>
                    <Link href={`/app/lines/list/${r.chatId}`} className="gr-table-name">
                      <ChatPlate name={r.name} kind="group" />
                      <span className="gr-gt-name">{r.name}</span>
                      {r.leftAt ? (
                        <span className="badge badge-outline">{t('groupSettings.leftTag')}</span>
                      ) : (
                        r.status === 'closed' && <span className="badge badge-outline">{t('list.closed')}</span>
                      )}
                      {r.flagged && <span className="badge badge-bad">{t('inbox.flagged')}</span>}
                    </Link>
                  </td>
                  {shown.map((c) => (
                    <Cell key={c} col={c} row={r} label={columnLabel(c)} lineName={lineName} properties={properties} hsDefs={hsDefs} hsFormat={hsFormat} rel={rel} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <FilterPanel
        open={panelOpen}
        title={t('fp.title')}
        anchorRef={toolbarRef}
        returnFocusRef={filterBtn}
        categories={categories}
        fields={fields}
        values={values}
        initialField={panelField}
        onClose={() => setPanelOpen(false)}
        onApply={(next) => {
          setPanelOpen(false);
          applyValues(next);
        }}
        renderCustom={(field, value, onChange) =>
          field.id === 'hsProps' ? <HubspotFilter immediate value={Array.isArray(value) ? (value as HubspotPropFilter[]) : NO_HS} onChange={(next) => onChange(next.length ? next : undefined)} /> : null
        }
      />
    </>
  );
}

function Cell({
  col,
  row,
  label,
  lineName,
  properties,
  hsDefs,
  hsFormat,
  rel,
}: {
  col: string;
  row: GroupTableRow;
  label: string;
  lineName: Map<string, string>;
  properties: PropertyDef[];
  hsDefs: Map<string, HubspotPropDef>;
  hsFormat: Parameters<typeof formatHubspotValue>[2];
  rel: (iso: string) => string;
}) {
  const t = useTranslations('groups');
  if (col === 'lines') {
    return (
      <td data-label={label}>
        <span className="gr-gt-lines">
          {row.lines.map((l) => {
            const name = lineName.get(l.numberId) ?? '';
            return (
              <Link key={l.numberId} href={`/app/lines/list/${l.chatId}`} className="gr-gt-line" title={t('gt.openInLine', { line: name })}>
                {name}
              </Link>
            );
          })}
        </span>
      </td>
    );
  }
  if (col === 'members') {
    return (
      <td className="num" data-label={label}>
        {row.memberCount}
      </td>
    );
  }
  if (col === 'labels') {
    return (
      <td className={row.labels.length ? undefined : 'gr-empty-cell'} data-label={row.labels.length ? label : undefined}>
        <span className="gr-label-row">
          {row.labels.map((l) => (
            <LabelTag key={l.id} name={l.name} color={l.color} />
          ))}
        </span>
      </td>
    );
  }
  if (col === 'company') {
    return (
      <td data-label={label}>
        {row.company ? (
          <span className="gr-gt-company">
            <a href={row.company.url} target="_blank" rel="noopener noreferrer" className="gr-gt-company-link" aria-label={t('gt.openInHubspot', { name: row.company.name })}>
              <span>{row.company.name}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
              </svg>
            </a>
            {row.company.broken && <span className="badge badge-warn">{t('gt.broken')}</span>}
          </span>
        ) : (
          <span className="ui-help">{t('gt.notLinked')}</span>
        )}
      </td>
    );
  }
  if (col === 'activity' || col === 'created') {
    return (
      <td className="ui-help" data-label={label}>
        {rel(col === 'activity' ? row.lastActivity : row.createdAt)}
      </td>
    );
  }
  if (col === 'status') {
    return <td data-label={label}>{row.status === 'open' ? t('gt.open') : t('gt.closed')}</td>;
  }
  if (col.startsWith('prop:')) {
    const def = properties.find((p) => p.key === col.slice(5));
    const v = row.properties[col.slice(5)];
    const has = def && v !== undefined && v !== null && v !== '';
    return (
      <td className={has ? undefined : 'gr-empty-cell'} data-label={has ? label : undefined}>
        {def && has ? <PropertyValueText def={def} value={v} /> : null}
      </td>
    );
  }
  if (col.startsWith('hs:')) {
    const name = col.slice(3);
    const v = row.hs[name];
    return (
      <td className={v ? undefined : 'gr-empty-cell'} data-label={v ? label : undefined}>
        {v ? formatHubspotValue(hsDefs.get(name) ?? null, v, hsFormat) : null}
      </td>
    );
  }
  return <td />;
}

/** Un botón con un menú que se abre debajo; Esc o un clic afuera lo cierran y el foco vuelve al botón. */
function Popover({
  open,
  onOpenChange,
  button,
  buttonLabel,
  testId,
  align = 'start',
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  button: ReactNode;
  buttonLabel?: string;
  testId?: string;
  align?: 'start' | 'end';
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) onOpenChange(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [open, onOpenChange]);
  return (
    <div
      className="gr-columns"
      ref={box}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          onOpenChange(false);
          btn.current?.focus();
        }
      }}
    >
      <button ref={btn} type="button" className="btn btn-ghost gr-gt-menu-btn" aria-haspopup="true" aria-expanded={open} aria-label={buttonLabel} data-testid={testId} onClick={() => onOpenChange(!open)}>
        {button}
      </button>
      {open && <div className={`gr-columns-menu gr-gt-popover${align === 'end' ? ' is-end' : ''}`}>{children}</div>}
    </div>
  );
}

function ColumnsMenu({
  view,
  hubspotOn,
  properties,
  hsProps,
  columnLabel,
  onToggle,
  onSort,
  onReset,
}: {
  view: GroupsView;
  hubspotOn: boolean;
  properties: PropertyDef[];
  hsProps: HubspotPropDef[];
  columnLabel: (id: string) => string;
  onToggle: (id: string) => void;
  onSort: (sort: GroupsView['sort']) => void;
  onReset: () => void;
}) {
  const t = useTranslations('groups');
  const [query, setQuery] = useState('');
  const sections: Array<{ id: string; title: string; cols: string[] }> = [
    { id: 'group', title: t('gt.secGroup'), cols: GROUP_COLUMNS.filter((c) => c !== 'company' || hubspotOn) },
    { id: 'props', title: t('gt.secProps'), cols: properties.map((p) => propColumn(p.key)) },
    ...(hubspotOn ? [{ id: 'hs', title: t('gt.secHubspot'), cols: hsProps.map((p) => hsColumn(p.name)) }] : []),
  ];
  const total = sections.reduce((n, s) => n + s.cols.length, 0);
  const q = fold(query);
  const visible = sections.map((s) => ({ ...s, cols: q ? s.cols.filter((c) => fold(columnLabel(c)).includes(q)) : s.cols })).filter((s) => s.cols.length > 0);
  const sortable = ['name', ...view.columns];
  return (
    <div className="gr-gt-columns">
      <div className="gr-gt-sortrow">
        <label className="ui-field">
          <span className="label">{t('gt.sortBy')}</span>
          <select
            className="select"
            value={view.sort?.col ?? ''}
            onChange={(e) => onSort(e.target.value ? { col: e.target.value, dir: view.sort?.dir ?? 'asc' } : null)}
          >
            <option value="">{t('gt.sortNone')}</option>
            {sortable.map((c) => (
              <option key={c} value={c}>
                {columnLabel(c)}
              </option>
            ))}
          </select>
        </label>
        {view.sort && (
          <label className="ui-field">
            <span className="label">{t('gt.sortDir')}</span>
            <select className="select" value={view.sort.dir} onChange={(e) => onSort({ col: view.sort!.col, dir: e.target.value === 'desc' ? 'desc' : 'asc' })}>
              <option value="asc">{t('gt.sortAsc')}</option>
              <option value="desc">{t('gt.sortDesc')}</option>
            </select>
          </label>
        )}
      </div>
      {total > 10 && <input className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('gt.searchColumns')} aria-label={t('gt.searchColumns')} />}
      <div className="gr-gt-colsections" role="group" aria-label={t('list.columns')}>
        {visible.length === 0 && <p className="ui-help">{t('gt.noColumns')}</p>}
        {visible.map((s) => (
          <fieldset key={s.id} className="gr-gt-colsection">
            <legend className="label">{s.title}</legend>
            {s.cols.map((c) => (
              <label key={c} className="gr-check-label gr-gt-option">
                <input type="checkbox" className="ui-check" checked={view.columns.includes(c)} onChange={() => onToggle(c)} />
                <span className="gr-gt-option-text">{columnLabel(c)}</span>
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onReset}>
        {t('gt.reset')}
      </button>
    </div>
  );
}
