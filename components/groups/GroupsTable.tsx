'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import EmptyState from '@/components/ui/EmptyState';
import MenuSelect from '@/components/ui/MenuSelect';
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
  HUBSPOT_GROUP_COLUMNS,
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
import PropertyInput, { filterOptions, PropertyValueText } from './PropertyInput';
import { useHubspotSchema } from './hubspot-client';
import { ChatPlate, LabelTag, Modal, api, useErrorText, useRelativeTime, useToast } from './ui';
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
  properties: initialProperties,
  selected,
  onSelectedChange,
  onRowsChange,
  reloadSignal,
  toolbarEnd,
  emptyAction,
  canWrite = true,
  canAdmin = false,
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
  /** Puede editar los valores en la celda (no invitados). */
  canWrite?: boolean;
  /** Puede agregar columnas propias (propiedades nuevas del workspace). */
  canAdmin?: boolean;
}) {
  const t = useTranslations('groups');
  const tf = useTranslations('common.ui.filter');
  const locale = useLocale();
  const rel = useRelativeTime();
  const errText = useErrorText();
  const [toast, showToast] = useToast();
  // Las propiedades de zerosoft (columnas propias); una nueva desde "Columnas" se suma acá.
  const [properties, setProperties] = useState(initialProperties);
  useEffect(() => setProperties(initialProperties), [initialProperties]);
  const [newPropOpen, setNewPropOpen] = useState(false);
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
      if (id === 'deal') return t('gt.colDeal');
      if (id === 'stage') return t('gt.colStage');
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
    () => view.columns.filter((c) => (HUBSPOT_GROUP_COLUMNS.includes(c) || c.startsWith('hs:') ? hubspotOn : c.startsWith('prop:') ? propKeys.includes(c.slice(5)) : true)),
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
      if (col === 'deal') return r.deal?.name ?? null;
      if (col === 'stage') return r.deal?.stage || null;
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

  // Edición en la celda: el valor va a todos los chats del grupo (uno por línea).
  const saveProp = useCallback(
    async (row: GroupTableRow, key: string, value: unknown): Promise<boolean> => {
      const res = await api<{ chatIds: string[]; value: unknown }>('/api/groups/table', {
        method: 'PATCH',
        body: { chatIds: row.lines.map((l) => l.chatId).concat(row.chatId), key, value },
      });
      if (!res.data) {
        showToast(errText(res.error), true);
        return false;
      }
      const saved = res.data.value;
      setData((d) =>
        d
          ? {
              ...d,
              rows: d.rows.map((x) => {
                if (x.key !== row.key) return x;
                const props = { ...x.properties };
                if (saved === null || saved === undefined) delete props[key];
                else props[key] = saved;
                return { ...x, properties: props };
              }),
            }
          : d,
      );
      return true;
    },
    [errText, showToast],
  );

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
          <ToolbarPopover
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
          </ToolbarPopover>
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
        <ToolbarPopover open={menu === 'columns'} onOpenChange={(o) => setMenu(o ? 'columns' : null)} button={t('list.columns')} testId="groups-columns-button" align="end">
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
            onNewProperty={
              canAdmin
                ? () => {
                    setMenu(null);
                    setNewPropOpen(true);
                  }
                : undefined
            }
          />
        </ToolbarPopover>
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
                    <Cell
                      key={c}
                      col={c}
                      row={r}
                      label={columnLabel(c)}
                      lineName={lineName}
                      properties={properties}
                      hsDefs={hsDefs}
                      hsFormat={hsFormat}
                      rel={rel}
                      onSaveProp={canWrite ? saveProp : undefined}
                    />
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
      {canAdmin && (
        <NewPropertyModal
          open={newPropOpen}
          onClose={() => setNewPropOpen(false)}
          onCreated={(def) => {
            setNewPropOpen(false);
            setProperties((list) => [...list, def]);
            // La columna nueva queda a la vista.
            updateView((v) => ({ ...v, columns: v.columns.includes(propColumn(def.key)) ? v.columns : toggleColumn(v.columns, propColumn(def.key)) }));
            showToast(t('gt.propCreated', { name: def.label }));
          }}
        />
      )}
      {toast}
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
  onSaveProp,
}: {
  col: string;
  row: GroupTableRow;
  label: string;
  lineName: Map<string, string>;
  properties: PropertyDef[];
  hsDefs: Map<string, HubspotPropDef>;
  hsFormat: Parameters<typeof formatHubspotValue>[2];
  rel: (iso: string) => string;
  /** Sin esto, las propiedades se ven pero no se editan. */
  onSaveProp?: (row: GroupTableRow, key: string, value: unknown) => Promise<boolean>;
}) {
  const t = useTranslations('groups');
  if (col === 'lines') {
    // Una sola fila: la línea principal y "+N" con las demás en el tooltip.
    const [first, ...rest] = row.lines;
    const name = first ? (lineName.get(first.numberId) ?? '') : '';
    const others = rest.map((l) => lineName.get(l.numberId) ?? '').join(', ');
    return (
      <td data-label={label}>
        <span className="gr-gt-lines">
          {first && (
            <Link href={`/app/lines/list/${first.chatId}`} className="gr-gt-line" title={t('gt.openInLine', { line: name })}>
              {name}
            </Link>
          )}
          {rest.length > 0 && (
            <span className="gr-gt-more" title={others} data-testid="groups-more-lines">
              +{rest.length}
              <span className="sr-only">
                {' '}
                {t('gt.moreLines', { n: rest.length })}: {others}
              </span>
            </span>
          )}
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
              <ExternalIcon />
            </a>
            {row.company.broken && <span className="badge badge-warn">{t('gt.broken')}</span>}
          </span>
        ) : (
          <span className="ui-help">{t('gt.notLinked')}</span>
        )}
      </td>
    );
  }
  if (col === 'deal') {
    return (
      <td className={row.deal ? undefined : 'gr-empty-cell'} data-label={row.deal ? label : undefined}>
        {row.deal && (
          <span className="gr-gt-company">
            <a href={row.deal.url} target="_blank" rel="noopener noreferrer" className="gr-gt-company-link" aria-label={t('gt.openInHubspot', { name: row.deal.name })}>
              <span>{row.deal.name}</span>
              <ExternalIcon />
            </a>
            {row.deal.broken && <span className="badge badge-warn">{t('gt.broken')}</span>}
          </span>
        )}
      </td>
    );
  }
  if (col === 'stage') {
    const stage = row.deal?.stage ?? '';
    return (
      <td className={stage ? undefined : 'gr-empty-cell'} data-label={stage ? label : undefined}>
        {stage}
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
    const has = Boolean(def) && v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);
    if (def && onSaveProp) return <PropCell def={def} row={row} value={v} has={has} label={label} onSave={onSaveProp} />;
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

function ExternalIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  );
}

/**
 * Una propiedad de zerosoft editable en la celda, como en Airtable: la casilla
 * se marca ahí mismo; lo demás abre un editor chico debajo (Enter guarda,
 * Esc cancela y el foco vuelve a la celda).
 */
function PropCell({
  def,
  row,
  value,
  has,
  label,
  onSave,
}: {
  def: PropertyDef;
  row: GroupTableRow;
  value: unknown;
  has: boolean;
  label: string;
  onSave: (row: GroupTableRow, key: string, value: unknown) => Promise<boolean>;
}) {
  const t = useTranslations('groups');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<unknown>(value);
  const [busy, setBusy] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLFormElement>(null);
  const close = useCallback((refocus = true) => {
    setEditing(false);
    if (refocus) requestAnimationFrame(() => btn.current?.focus());
  }, []);
  // El editor flota sobre la tabla (la celda corta lo que se sale y la tabla puede tener scroll propio).
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  useEffect(() => {
    if (!editing) return;
    const place = () => {
      const r = btn.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(320, window.innerWidth - 16);
      const h = box.current?.offsetHeight || 160;
      // Sin lugar abajo, se abre arriba de la celda.
      const top = r.bottom + 4 + h > window.innerHeight - 8 && r.top - 4 - h >= 8 ? r.top - 4 - h : r.bottom + 4;
      setPos({ top: Math.round(top), left: Math.round(Math.max(8, Math.min(r.left, window.innerWidth - width - 8))), width });
    };
    place();
    // Al abrir, el foco va al control; un clic afuera cierra sin guardar.
    requestAnimationFrame(() => box.current?.querySelector<HTMLElement>('input, select, button.gr-multi-opt')?.focus());
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (box.current && !box.current.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) close(false);
    };
    // Esc cierra aunque el foco todavía esté en la celda (antes de pasar al control).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [editing, close]);
  const editLabel = t('gt.editCell', { col: label, name: row.name });

  if (def.type === 'checkbox') {
    const on = value === 'true' || value === true;
    return (
      <td data-label={label}>
        <label className="tap-cell gr-gt-checkcell">
          <input
            type="checkbox"
            className="ui-check"
            checked={on}
            disabled={busy}
            aria-label={editLabel}
            onChange={async (e) => {
              setBusy(true);
              await onSave(row, def.key, e.target.checked ? 'true' : '');
              setBusy(false);
            }}
          />
        </label>
      </td>
    );
  }

  return (
    <td className={`gr-gt-editcell${has ? '' : ' gr-empty-cell'}`} data-label={label}>
      <button
        ref={btn}
        type="button"
        className="gr-gt-cellbtn"
        aria-label={editLabel}
        aria-haspopup="dialog"
        aria-expanded={editing}
        data-testid="groups-cell-edit"
        onClick={() => {
          if (editing) return close();
          setDraft(value);
          setEditing(true);
        }}
      >
        {has ? (
          <PropertyValueText def={def} value={value} />
        ) : (
          <span className="gr-gt-cellplaceholder" aria-hidden="true">
            {t('gt.addValue')}
          </span>
        )}
      </button>
      {editing && (
        <form
          ref={box}
          className="gr-gt-celleditor"
          style={pos ? { top: pos.top, left: pos.left, width: pos.width } : { visibility: 'hidden' }}
          role="dialog"
          aria-label={editLabel}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              close();
            }
          }}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const ok = await onSave(row, def.key, draft);
            setBusy(false);
            if (ok) close();
          }}
        >
          <PropertyInput def={def} value={draft} onChange={setDraft} disabled={busy} />
          <div className="gr-gt-celleditor-foot">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => close()}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
              {t('common.save')}
            </button>
          </div>
        </form>
      )}
    </td>
  );
}

/** Tipos que se pueden crear desde la tabla (los de árbol y archivo, en Ajustes). */
const NEW_PROP_TYPES = ['text', 'number', 'select', 'multiselect', 'date', 'checkbox', 'url'] as const;

/** Una columna propia nueva: una propiedad de zerosoft para todos los grupos del workspace. */
function NewPropertyModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (def: PropertyDef) => void }) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const [label, setLabel] = useState('');
  const [type, setType] = useState<(typeof NEW_PROP_TYPES)[number]>('text');
  const [options, setOptions] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    setLabel('');
    setType('text');
    setOptions('');
    setError('');
  }, [open]);
  const needsOptions = type === 'select' || type === 'multiselect';
  const submit = async () => {
    if (!label.trim() || busy) return;
    setBusy(true);
    setError('');
    const res = await api<PropertyDef>('/api/groups/properties', {
      body: { label: label.trim(), type, scope: 'chat', options: needsOptions ? options.split(',').map((o) => o.trim()).filter(Boolean) : [] },
    });
    setBusy(false);
    if (!res.data) return setError(errText(res.error));
    onCreated(res.data);
  };
  return (
    <Modal
      open={open}
      title={t('gt.newColumn')}
      onClose={onClose}
      onSubmit={() => void submit()}
      busy={busy}
      foot={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!label.trim() || busy}>
            {t('gt.newColumnAdd')}
          </button>
        </>
      }
    >
      <p className="ui-help">{t('gt.newColumnHelp')}</p>
      <label className="ui-field">
        <span className="label">{t('props.label')}</span>
        <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder={t('props.placeholder')} />
      </label>
      <label className="ui-field">
        <span className="label">{t('props.type')}</span>
        <select className="select" value={type} onChange={(e) => setType(e.target.value as (typeof NEW_PROP_TYPES)[number])}>
          {NEW_PROP_TYPES.map((x) => (
            <option key={x} value={x}>
              {t(`props.types.${x}`)}
            </option>
          ))}
        </select>
      </label>
      {needsOptions && (
        <label className="ui-field">
          <span className="label">{t('props.options')}</span>
          <input className="input" value={options} onChange={(e) => setOptions(e.target.value)} placeholder={t('props.options')} />
        </label>
      )}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

/** Un botón con un menú que se abre debajo; Esc o un clic afuera lo cierran y el foco vuelve al botón. */
export function ToolbarPopover({
  open,
  onOpenChange,
  button,
  buttonLabel,
  testId,
  align = 'start',
  buttonClass = 'btn btn-ghost gr-gt-menu-btn',
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  button: ReactNode;
  buttonClass?: string;
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
      const target = e.target as Element;
      // La lista de un MenuSelect de adentro vive en un portal: elegir ahí no cierra este menú.
      if (target.closest?.('.zs-msel-list')) return;
      if (box.current && !box.current.contains(target)) onOpenChange(false);
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
        // Un Esc que ya usó un control de adentro (cerrar un MenuSelect) no cierra el menú.
        if (e.key === 'Escape' && open && !e.defaultPrevented) {
          e.stopPropagation();
          onOpenChange(false);
          btn.current?.focus();
        }
      }}
    >
      <button ref={btn} type="button" className={buttonClass} aria-haspopup="true" aria-expanded={open} aria-label={buttonLabel} data-testid={testId} onClick={() => onOpenChange(!open)}>
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
  onNewProperty,
}: {
  view: GroupsView;
  hubspotOn: boolean;
  properties: PropertyDef[];
  hsProps: HubspotPropDef[];
  columnLabel: (id: string) => string;
  onToggle: (id: string) => void;
  onSort: (sort: GroupsView['sort']) => void;
  onReset: () => void;
  /** Solo para quien puede crear propiedades. */
  onNewProperty?: () => void;
}) {
  const t = useTranslations('groups');
  const [query, setQuery] = useState('');
  const sections: Array<{ id: string; title: string; cols: string[] }> = [
    { id: 'group', title: t('gt.secGroup'), cols: GROUP_COLUMNS.filter((c) => hubspotOn || !HUBSPOT_GROUP_COLUMNS.includes(c)) },
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
        <span className="label" aria-hidden="true">
          {t('gt.sortBy')}
        </span>
        <div className="gr-gt-sortctl">
          <MenuSelect
            label={t('gt.sortBy')}
            value={view.sort?.col ?? ''}
            options={[{ value: '', label: t('gt.sortNone') }, ...sortable.map((c) => ({ value: c, label: columnLabel(c) }))]}
            onChange={(v) => onSort(v ? { col: v, dir: view.sort?.dir ?? 'asc' } : null)}
            testId="groups-sort-by"
          />
          {view.sort && (
            <MenuSelect
              label={t('gt.sortDir')}
              value={view.sort.dir}
              options={[
                { value: 'asc', label: t('gt.sortAsc') },
                { value: 'desc', label: t('gt.sortDesc') },
              ]}
              onChange={(v) => onSort({ col: view.sort!.col, dir: v === 'desc' ? 'desc' : 'asc' })}
              testId="groups-sort-dir"
            />
          )}
        </div>
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
      <div className="gr-gt-colfoot">
        {onNewProperty && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onNewProperty} data-testid="groups-new-column">
            {t('gt.newColumn')}
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={onReset}>
          {t('gt.reset')}
        </button>
      </div>
    </div>
  );
}
