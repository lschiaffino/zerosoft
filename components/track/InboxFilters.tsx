'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  EMPTY_INBOX_FILTER,
  INBOX_GROUPS,
  INBOX_KINDS,
  INBOX_NONE,
  INBOX_ORDERS,
  inboxFilterCount,
  type InboxFilter,
  type InboxKind,
} from '@/lib/notification-inbox-filter';
import type { InboxFacets } from '@/lib/notification-inbox';
import TrackIcon, { type TrackIconName } from './TrackIcon';
import { Dropdown, KeyMenu, isTextEntry, type KeyMenuItem } from './IssueFilters';
import { Choice } from './IssueDisplayOptions';

/** Propiedades por las que se filtra la bandeja. */
const FIELDS = ['read', 'kind', 'project', 'team', 'from'] as const;
type Field = (typeof FIELDS)[number];

const FIELD_ICON: Record<Field, TrackIconName> = {
  read: 'check',
  kind: 'tag',
  project: 'plans',
  team: 'team',
  from: 'user',
};

interface Option {
  value: string;
  label: string;
  count?: number;
}

/** Valores elegidos de una propiedad (estado leído/sin leer es uno solo). */
function selected(f: InboxFilter, field: Field): string[] {
  if (field === 'read') return f.read === 'all' ? [] : [f.read];
  if (field === 'kind') return f.kinds;
  if (field === 'project') return f.projects;
  if (field === 'team') return f.teams;
  return f.actors;
}

function withValues(f: InboxFilter, field: Field, values: string[]): InboxFilter {
  if (field === 'read') return { ...f, read: (values[values.length - 1] as InboxFilter['read']) ?? 'all' };
  if (field === 'kind') return { ...f, kinds: values as InboxKind[] };
  if (field === 'project') return { ...f, projects: values };
  if (field === 'team') return { ...f, teams: values };
  return { ...f, actors: values };
}

/**
 * Filtros y Display de la bandeja de Track, como en Linear: "Filter" (o F)
 * abre las propiedades (estado, tipo, project, team, quién) con búsqueda; cada
 * filtro queda como chip con sus valores y una X. "Display" ordena (más nuevas
 * o más viejas) y agrupa (tipo, project, team). Usa el menú de teclado y los
 * desplegables de la lista de issues (IssueFilters, IssueDisplayOptions).
 */
export default function InboxFilters({
  filter,
  onChange,
  facets,
  showDisplay = true,
}: {
  filter: InboxFilter;
  onChange: (f: InboxFilter) => void;
  facets: InboxFacets | null;
  /** En pospuestos el orden es el de vuelta: sin Display. */
  showDisplay?: boolean;
}) {
  const t = useTranslations('track');
  const [adding, setAdding] = useState(false);
  const [addField, setAddField] = useState<Field | null>(null);
  const [quick, setQuick] = useState('');
  const [valueQuery, setValueQuery] = useState('');
  const [openChip, setOpenChip] = useState<Field | null>(null);
  const [chipQuery, setChipQuery] = useState('');
  const [displayOpen, setDisplayOpen] = useState(false);
  const latest = useRef(filter);
  latest.current = filter;
  const displayWrap = useRef<HTMLDivElement>(null);
  const displayButton = useRef<HTMLButtonElement>(null);
  const displayPanel = useRef<HTMLDivElement>(null);

  const fieldLabel = (f: Field) => t(`inbox.filter.${f}`);
  const kindLabel = (k: InboxKind) => t(`inbox.kinds.${k}`);

  const optionsFor = (field: Field): Option[] => {
    if (field === 'read') return [
      { value: 'unread', label: t('inbox.filter.unread') },
      { value: 'read', label: t('inbox.filter.readOnes') },
    ];
    if (field === 'kind') {
      const counts = new Map((facets?.kinds ?? []).map((k) => [k.value, k.count]));
      return INBOX_KINDS.filter((k) => counts.has(k) || filter.kinds.includes(k)).map((k) => ({ value: k, label: kindLabel(k), count: counts.get(k) }));
    }
    if (field === 'project') {
      const list: Option[] = (facets?.projects ?? []).map((p) => ({ value: p.value, label: p.label, count: p.count }));
      if (facets?.noProject) list.push({ value: INBOX_NONE, label: t('inbox.filter.noProject'), count: facets.noProject });
      return list;
    }
    if (field === 'team') {
      const list: Option[] = (facets?.teams ?? []).map((p) => ({ value: p.value, label: p.label, count: p.count }));
      if (facets?.noTeam) list.push({ value: INBOX_NONE, label: t('inbox.filter.noTeam'), count: facets.noTeam });
      return list;
    }
    return (facets?.actors ?? []).map((p) => ({ value: p.value, label: p.label || t('inbox.someone'), count: p.count }));
  };

  // Un valor elegido que ya no está en la lista (otro tab, se borró) igual se muestra en el chip.
  const valueLabel = (field: Field, value: string) => optionsFor(field).find((o) => o.value === value)?.label ?? (field === 'kind' ? kindLabel(value as InboxKind) : value === INBOX_NONE ? t(field === 'team' ? 'inbox.filter.noTeam' : 'inbox.filter.noProject') : field === 'read' ? t(value === 'read' ? 'inbox.filter.readOnes' : 'inbox.filter.unread') : '…');

  const matches = (label: string, q: string) => label.toLowerCase().includes(q.trim().toLowerCase());

  const toggle = (field: Field, value: string) => {
    const cur = selected(latest.current, field);
    const next = field === 'read' ? (cur.includes(value) ? [] : [value]) : cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
    onChange(withValues(latest.current, field, next));
  };

  const closeAdd = (open: boolean) => {
    setAdding(open);
    if (!open) {
      setAddField(null);
      setQuick('');
      setValueQuery('');
    }
  };

  // F abre el filtro (como en la lista de issues), fuera de los campos de texto.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'f' && e.key !== 'F') return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || isTextEntry(e.target)) return;
      e.preventDefault();
      setAdding(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Display: clic afuera lo cierra; al abrir, el foco va al primer control.
  useEffect(() => {
    if (!displayOpen) return;
    displayPanel.current?.querySelector<HTMLElement>('button')?.focus();
    const onDown = (e: MouseEvent) => {
      if (!displayWrap.current?.contains(e.target as Node)) setDisplayOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [displayOpen]);

  const valueItems = (field: Field, q: string): KeyMenuItem[] => {
    const cur = selected(filter, field);
    return optionsFor(field)
      .filter((o) => !q.trim() || matches(o.label, q))
      .map((o) => ({
        key: o.value,
        label: o.label,
        meta: o.count !== undefined ? String(o.count) : undefined,
        checked: cur.includes(o.value),
        testId: `track-inbox-filter-value-${field}-${o.value}`,
        onPick: () => {
          toggle(field, o.value);
          if (field === 'read') closeAdd(false);
        },
      }));
  };

  const rootItems: KeyMenuItem[] = useMemo(() => {
    const q = quick.trim();
    const items: KeyMenuItem[] = FIELDS.filter((f) => !q || matches(fieldLabel(f), q)).map((f) => ({
      key: `field:${f}`,
      label: fieldLabel(f),
      icon: <TrackIcon name={FIELD_ICON[f]} size={13} />,
      hasChildren: true,
      testId: `track-inbox-filter-field-${f}`,
      onPick: () => {
        setAddField(f);
        setValueQuery('');
      },
    }));
    // Al tipear, también los valores de todas las propiedades.
    if (q) {
      for (const f of FIELDS) {
        for (const o of optionsFor(f)) {
          if (!matches(o.label, q)) continue;
          items.push({
            key: `value:${f}:${o.value}`,
            label: o.label,
            meta: fieldLabel(f),
            onPick: () => {
              if (!selected(latest.current, f).includes(o.value)) toggle(f, o.value);
              closeAdd(false);
            },
          });
          if (items.length > 20) break;
        }
      }
    }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quick, facets, filter]);

  const active = FIELDS.filter((f) => selected(filter, f).length > 0);
  const count = inboxFilterCount(filter);

  const chips: ReactNode[] = active.map((field) => {
    const values = selected(filter, field);
    const first = valueLabel(field, values[0]);
    const text = values.length > 1 ? t('ux.filter.nValues', { first, count: values.length - 1 }) : first;
    return (
      <span key={field} className="track-filter-chip-wrap">
        <span className="track-filter-chip" data-testid="track-inbox-filter-chip" data-field={field}>
          <span className="track-filter-chip-field">
            <TrackIcon name={FIELD_ICON[field]} size={13} />
            {fieldLabel(field)}
          </span>
          <Dropdown
            open={openChip === field}
            onOpenChange={(o) => {
              setOpenChip(o ? field : null);
              setChipQuery('');
            }}
            label={fieldLabel(field)}
            triggerClass="track-filter-chip-part is-values"
            testId={`track-inbox-chip-values-${field}`}
            trigger={text}
          >
            <KeyMenu
              ariaLabel={fieldLabel(field)}
              searchable={field !== 'read'}
              query={chipQuery}
              onQuery={setChipQuery}
              placeholder={t('ux.filter.searchPlaceholder')}
              items={valueItems(field, chipQuery).map((i) => ({
                ...i,
                onPick: () => {
                  i.onPick();
                  if (field === 'read') setOpenChip(null);
                },
              }))}
            />
          </Dropdown>
          <button
            type="button"
            className="track-filter-chip-remove"
            aria-label={t('ux.filter.remove', { field: fieldLabel(field) })}
            onClick={() => onChange(withValues(filter, field, []))}
            data-testid={`track-inbox-chip-remove-${field}`}
          >
            <TrackIcon name="close" size={10} />
          </button>
        </span>
      </span>
    );
  });

  return (
    <div className="track-filters track-inbox-filters" role="search" data-testid="track-inbox-filters">
      <div className="track-filter-group">
        <Dropdown
          open={adding}
          onOpenChange={closeAdd}
          label={t('filters.button')}
          triggerClass={`btn btn-ghost btn-sm track-filter-toggle${count > 0 ? ' is-active' : ''}`}
          testId="track-inbox-filter-add"
          trigger={
            <>
              <TrackIcon name="filter" size={12} />
              {t('filters.button')}
              <kbd className="kbd track-kbd" aria-hidden>
                F
              </kbd>
            </>
          }
        >
          {addField === null ? (
            <KeyMenu
              ariaLabel={t('filters.button')}
              items={rootItems}
              query={quick}
              onQuery={setQuick}
              placeholder={t('ux.filter.searchPlaceholder')}
              inputTestId="track-inbox-filter-quick"
              hint={t('ux.filter.hint')}
            />
          ) : (
            <KeyMenu
              key={addField}
              ariaLabel={fieldLabel(addField)}
              head={
                <button type="button" className="track-filter-menu-head track-keymenu-back" onClick={() => setAddField(null)}>
                  <span className="track-keymenu-back-icon" aria-hidden>
                    <TrackIcon name="chevronDown" size={10} />
                  </span>
                  {fieldLabel(addField)}
                </button>
              }
              items={valueItems(addField, valueQuery)}
              query={valueQuery}
              onQuery={setValueQuery}
              placeholder={t('ux.filter.searchPlaceholder')}
              inputTestId="track-inbox-filter-value-search"
              emptyLabel={t('inbox.filter.noValues')}
              onBack={() => {
                setAddField(null);
                setValueQuery('');
              }}
            />
          )}
        </Dropdown>
        {chips}
        {count > 0 && (
          <button
            type="button"
            className="btn btn-ghost btn-sm track-filter-clear"
            onClick={() => onChange({ ...EMPTY_INBOX_FILTER, order: filter.order, group: filter.group })}
            data-testid="track-inbox-filter-clear"
          >
            {t('filters.clear')}
          </button>
        )}
      </div>
      {showDisplay && (
        <div
          className="track-display"
          ref={displayWrap}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && displayOpen) {
              e.preventDefault();
              e.stopPropagation();
              setDisplayOpen(false);
              displayButton.current?.focus();
            }
          }}
        >
          <button
            ref={displayButton}
            type="button"
            className={`btn btn-ghost btn-sm track-display-btn${displayOpen ? ' is-open' : ''}`}
            aria-haspopup="dialog"
            aria-expanded={displayOpen}
            onClick={() => setDisplayOpen((o) => !o)}
            data-testid="track-inbox-display"
          >
            <TrackIcon name="settings" size={12} />
            {t('ux.display.button')}
          </button>
          {displayOpen && (
            <div className="track-display-panel" role="dialog" aria-label={t('ux.display.button')} ref={displayPanel} data-testid="track-inbox-display-panel">
              <Choice
                label={t('ux.display.ordering')}
                value={filter.order}
                options={INBOX_ORDERS}
                optionLabel={(o) => t(`inbox.order.${o}`)}
                onChange={(order) => onChange({ ...latest.current, order })}
                testId="track-inbox-ordering"
              />
              <Choice
                label={t('ux.display.grouping')}
                value={filter.group}
                options={INBOX_GROUPS}
                optionLabel={(g) => t(`inbox.group.${g}`)}
                onChange={(group) => onChange({ ...latest.current, group })}
                testId="track-inbox-grouping"
              />
              {(filter.order !== 'newest' || filter.group !== 'none') && (
                <>
                  <div className="track-display-sep" />
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm track-display-reset"
                    onClick={() => onChange({ ...latest.current, order: 'newest', group: 'none' })}
                  >
                    {t('ux.display.reset')}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
