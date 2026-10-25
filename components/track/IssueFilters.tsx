'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { TrackCycleRow, TrackStatusRow } from '@/lib/db';
import type { IssueLabel } from '@/lib/track-schema';
import { safeHexColor } from '@/lib/track-color';
import {
  EMPTY_FILTERS,
  HIERARCHY_VALUES,
  NONE_VALUE,
  RELATION_VALUES,
  fieldKind,
  needsValues,
  operatorsFor,
  type FilterField,
  type FilterOperator,
  type FilterRule,
  type FilterState,
} from '@/lib/track-filter';
import TrackIcon, { type TrackIconName } from './TrackIcon';
import { PriorityIcon, StatusDot } from './InlineEditors';
import { ESTIMATE_OPTIONS } from './trackCommands';

export type { FilterState } from '@/lib/track-filter';
export { EMPTY_FILTERS } from '@/lib/track-filter';

interface IssueFiltersProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  onSaveView: () => void;
  /** Vista activa con cambios sin guardar: "Update view" la pisa y "Save as new" crea otra (como Linear). */
  updateView?: { onUpdate: () => void; updateLabel: string; saveAsNewLabel: string };
  statuses: TrackStatusRow[];
  priorities: Array<{ value: string; label: string }>;
  members: Array<{ id: string; name: string | null; email: string }>;
  cycles: TrackCycleRow[];
  milestones?: Array<{ id: string; name: string }>;
  issueLabels: IssueLabel[];
  labels: FilterLabels;
  /** Compat: las vistas guardadas ahora viven en la barra de pestañas del team. */
  savedViews?: ReactNode;
  /** Controles al final de la barra (el botón Display). */
  trailing?: ReactNode;
}

export interface FilterLabels {
  status: string;
  priority: string;
  assignee: string;
  cycle: string;
  labels: string;
  dueDate: string;
  search: string;
  clear: string;
  saveView: string;
  /** Botón que abre el menú de filtros. */
  filter: string;
  done: string;
}

/** Cantidad de filtros activos (sin contar la búsqueda). */
export function activeFilterCount(filters: FilterState): number {
  return filters.rules.length;
}

interface ValueOption {
  value: string;
  label: string;
  color?: string;
  icon?: ReactNode;
}

/**
 * ¿El foco está en un campo de texto? Las casillas y botones no cuentan: después
 * de clickear un control, F, J/K y el resto de los atajos siguen andando.
 */
export function isTextEntry(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node || typeof node.closest !== 'function') return false;
  if (node.isContentEditable || node.closest('[contenteditable="true"], textarea, select, dialog, [role="dialog"]')) return true;
  const input = node.closest('input') as HTMLInputElement | null;
  if (!input) return false;
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(input.type);
}

function initial(name: string | null | undefined): string {
  return (name ?? '?').trim().charAt(0).toUpperCase() || '?';
}

// ---------- Menú de teclado (como el de Linear) ----------

export interface KeyMenuItem {
  key: string;
  label: string;
  meta?: string;
  icon?: ReactNode;
  /** Casilla (valores múltiples): marca a la derecha y aria-checked. */
  checked?: boolean;
  /** Abre un submenú (→ o Enter). */
  hasChildren?: boolean;
  testId?: string;
  onPick: () => void;
}

/**
 * Lista con filtro tipeado: ↑/↓ mueven, Enter o → eligen, ← o Backspace con
 * el campo vacío vuelven (si hay `onBack`). El primero queda resaltado.
 */
export function KeyMenu({
  items,
  query,
  onQuery,
  placeholder,
  onBack,
  searchable = true,
  inputTestId,
  head,
  hint,
  emptyLabel,
  ariaLabel,
}: {
  items: KeyMenuItem[];
  query?: string;
  onQuery?: (q: string) => void;
  placeholder?: string;
  onBack?: () => void;
  searchable?: boolean;
  inputTestId?: string;
  head?: ReactNode;
  hint?: string;
  emptyLabel?: string;
  ariaLabel: string;
}) {
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const signature = items.map((i) => i.key).join('|');
  useEffect(() => {
    setActive(0);
  }, [query, signature]);
  useEffect(() => {
    if (!searchable) rootRef.current?.focus();
  }, [searchable]);
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);
  const idBase = useMemo(() => `km-${Math.random().toString(36).slice(2, 8)}`, []);
  const current = Math.min(active, Math.max(0, items.length - 1));

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (items.length) setActive((current + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length) setActive((current - 1 + items.length) % items.length);
    } else if (e.key === 'Home' && !searchable) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End' && !searchable) {
      e.preventDefault();
      setActive(Math.max(0, items.length - 1));
    } else if (e.key === 'Enter') {
      const item = items[current];
      if (!item) return;
      e.preventDefault();
      item.onPick();
    } else if (e.key === 'ArrowRight') {
      const item = items[current];
      if (!item?.hasChildren) return;
      const input = e.target as HTMLInputElement;
      if (searchable && input.selectionStart !== null && input.selectionStart < (query ?? '').length) return;
      e.preventDefault();
      item.onPick();
    } else if ((e.key === 'ArrowLeft' || e.key === 'Backspace') && onBack) {
      const input = e.target as HTMLInputElement;
      const atStart = !searchable || !(query ?? '') || (e.key === 'ArrowLeft' && input.selectionStart === 0 && input.selectionEnd === 0);
      if (!atStart) return;
      e.preventDefault();
      onBack();
    } else if (e.key === ' ' && !searchable) {
      const item = items[current];
      if (!item) return;
      e.preventDefault();
      item.onPick();
    }
  };

  return (
    <div
      className="track-keymenu"
      ref={rootRef}
      tabIndex={searchable ? undefined : -1}
      onKeyDown={searchable ? undefined : onKeyDown}
    >
      {head}
      {searchable && (
        <input
          className="input track-filter-search-input"
          value={query ?? ''}
          onChange={(e) => onQuery?.(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label={placeholder ?? ariaLabel}
          role="combobox"
          aria-expanded="true"
          aria-controls={`${idBase}-list`}
          aria-activedescendant={items[current] ? `${idBase}-${current}` : undefined}
          autoFocus
          data-testid={inputTestId}
        />
      )}
      <div className="track-keymenu-list" role="menu" aria-label={ariaLabel} id={`${idBase}-list`} ref={listRef}>
        {items.length === 0 && emptyLabel && <p className="track-keymenu-empty">{emptyLabel}</p>}
        {items.map((item, i) => (
          <button
            key={item.key}
            id={`${idBase}-${i}`}
            type="button"
            tabIndex={-1}
            data-index={i}
            role={item.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked={item.checked !== undefined ? item.checked : undefined}
            className={`track-filter-prop${i === current ? ' is-active' : ''}`}
            onMouseMove={() => i !== current && setActive(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => item.onPick()}
            data-testid={item.testId}
          >
            {item.checked !== undefined && (
              <span className={`track-keymenu-box${item.checked ? ' is-on' : ''}`} aria-hidden>
                {item.checked && <TrackIcon name="check" size={10} />}
              </span>
            )}
            {item.icon && <span className="track-keymenu-icon">{item.icon}</span>}
            <span className="track-keymenu-label">{item.label}</span>
            {item.meta && <span className="track-filter-prop-meta">{item.meta}</span>}
            {item.hasChildren && (
              <span className="track-filter-prop-chevron" aria-hidden>
                <TrackIcon name="chevronDown" size={10} />
              </span>
            )}
          </button>
        ))}
      </div>
      {hint && <p className="track-keymenu-hint">{hint}</p>}
    </div>
  );
}

/** Menú desplegable simple (Esc y clic afuera lo cierran, el foco vuelve al botón). */
function Dropdown({
  open,
  onOpenChange,
  trigger,
  triggerClass,
  label,
  children,
  testId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  triggerClass: string;
  label: string;
  children: ReactNode;
  testId?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) onOpenChange(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, onOpenChange]);
  return (
    <div
      className="track-filter"
      ref={wrap}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.preventDefault();
          e.stopPropagation();
          onOpenChange(false);
          button.current?.focus();
        }
      }}
    >
      <button
        ref={button}
        type="button"
        className={triggerClass}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        onClick={() => onOpenChange(!open)}
        data-testid={testId}
      >
        {trigger}
      </button>
      {open && (
        <div className="track-filter-menu" role="group" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  );
}

const DATE_PRESETS: Array<{ op: FilterOperator; value: string; key: string }> = [
  { op: 'before', value: 'today', key: 'overdue' },
  { op: 'after', value: '-1d', key: 'fromToday' },
  { op: 'before', value: '+7d', key: 'next7' },
  { op: 'after', value: '-7d', key: 'last7' },
  { op: 'after', value: '-30d', key: 'last30' },
  { op: 'before', value: '-30d', key: 'olderThan30' },
];

const FIELD_ICONS: Partial<Record<FilterField, TrackIconName>> = {
  assignee: 'user',
  creator: 'user',
  label: 'tag',
  cycle: 'cycle',
  milestone: 'flag',
  estimate: 'estimate',
  due: 'calendar',
  start: 'calendar',
  created: 'clock',
  updated: 'clock',
  relation: 'link',
  hierarchy: 'subtasks',
};

function fieldIcon(f: FilterField): ReactNode {
  if (f === 'status') return <StatusDot color={null} category="in_progress" />;
  if (f === 'priority') return <PriorityIcon priority="high" />;
  const name = FIELD_ICONS[f];
  return name ? <TrackIcon name={name} size={13} /> : null;
}

/**
 * Filtros como en Linear: "Filter" (o F) abre el menú de propiedades con
 * búsqueda; ↑/↓ y Enter (o →) entran a una propiedad, Enter tilda valores
 * (se aplican al instante) y ← vuelve. Cada filtro es un chip
 * "Status · is · Todo" con el operador clickeable (is, is not, is any of…), y
 * con dos o más se alterna entre que se cumplan todos (and) o alguno (or).
 * Tipear en el menú también busca valores en todas las propiedades.
 */
export default function IssueFilters({
  filters,
  onChange,
  onSaveView,
  updateView,
  statuses,
  priorities,
  members,
  cycles,
  milestones = [],
  issueLabels,
  labels,
  trailing,
}: IssueFiltersProps) {
  const tf = useTranslations('track.ux.filter');
  const search = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  const [addField, setAddField] = useState<FilterField | null>(null);
  const [quick, setQuick] = useState('');
  const [valueQuery, setValueQuery] = useState('');
  const [openChip, setOpenChip] = useState<string | null>(null);
  const [chipQuery, setChipQuery] = useState('');
  const activeCount = activeFilterCount(filters);
  // Lo último que se mandó (varios toques seguidos en el mismo render no se pisan).
  const latest = useRef(filters);
  latest.current = filters;
  const update = (patch: Partial<FilterState>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    onChange(next);
  };

  const fieldLabel = (f: FilterField): string => {
    switch (f) {
      case 'status':
        return labels.status;
      case 'priority':
        return labels.priority;
      case 'assignee':
        return labels.assignee;
      case 'cycle':
        return labels.cycle;
      case 'label':
        return labels.labels;
      case 'due':
        return labels.dueDate;
      default:
        return tf(`fields.${f}`);
    }
  };

  const fields: FilterField[] = useMemo(() => {
    const list: FilterField[] = ['status', 'priority', 'assignee', 'creator', 'label'];
    if (cycles.length) list.push('cycle');
    if (milestones.length) list.push('milestone');
    list.push('estimate', 'due', 'start', 'created', 'updated', 'relation', 'hierarchy');
    return list;
  }, [cycles.length, milestones.length]);

  const avatar = (name: string | null | undefined) => <span className="track-avatar">{initial(name)}</span>;
  const swatch = (color: string) => (
    <span className="track-filter-swatch" style={{ background: safeHexColor(color, '#767676') }} aria-hidden />
  );

  const optionsFor = (f: FilterField): ValueOption[] => {
    switch (f) {
      case 'status':
        return statuses.map((s) => ({ value: s.id, label: s.name, icon: <StatusDot color={s.color} category={s.category} /> }));
      case 'priority':
        return priorities.map((p) => ({ ...p, icon: <PriorityIcon priority={p.value} /> }));
      case 'assignee':
        return [
          { value: NONE_VALUE, label: tf('noAssignee'), icon: <span className="track-avatar track-avatar-empty" aria-hidden /> },
          ...members.map((m) => ({ value: m.id, label: m.name ?? m.email, icon: avatar(m.name ?? m.email) })),
        ];
      case 'creator':
        return members.map((m) => ({ value: m.id, label: m.name ?? m.email, icon: avatar(m.name ?? m.email) }));
      case 'label':
        return issueLabels.map((l) => ({ value: l.id, label: l.name, color: l.color, icon: swatch(l.color) }));
      case 'cycle':
        return [{ value: NONE_VALUE, label: tf('noCycle') }, ...cycles.map((c) => ({ value: c.id, label: c.name }))].map((o) => ({
          ...o,
          icon: <TrackIcon name="cycle" size={13} />,
        }));
      case 'milestone':
        return [{ value: NONE_VALUE, label: tf('noMilestone') }, ...milestones.map((m) => ({ value: m.id, label: m.name }))].map(
          (o) => ({ ...o, icon: <TrackIcon name="flag" size={13} /> }),
        );
      case 'estimate':
        return ESTIMATE_OPTIONS.map((n) => ({ value: String(n), label: tf('points', { count: n }), icon: <TrackIcon name="estimate" size={13} /> }));
      case 'relation':
        return RELATION_VALUES.map((v) => ({ value: v, label: tf(`relation.${v}`), icon: <TrackIcon name="link" size={13} /> }));
      case 'hierarchy':
        return HIERARCHY_VALUES.map((v) => ({ value: v, label: tf(`hierarchy.${v}`), icon: <TrackIcon name="subtasks" size={13} /> }));
      default:
        return [];
    }
  };

  const valueLabel = (rule: FilterRule): string => {
    if (!needsValues(rule.op)) return '';
    if (fieldKind(rule.field) === 'date') {
      const v = rule.values[0] ?? '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
      return tf(`rel.${v}`);
    }
    const opts = optionsFor(rule.field);
    const names = rule.values.map((v) => opts.find((o) => o.value === v)?.label ?? v);
    return names.length > 2 ? tf('nValues', { first: names[0], count: names.length - 1 }) : names.join(', ');
  };

  const valueIcon = (rule: FilterRule): ReactNode => {
    if (rule.values.length !== 1 || fieldKind(rule.field) === 'date') return null;
    return optionsFor(rule.field).find((o) => o.value === rule.values[0])?.icon ?? null;
  };

  const opLabel = (rule: FilterRule, op: FilterOperator = rule.op): string => {
    const kind = fieldKind(rule.field);
    if (kind === 'date') return tf(`op.date_${op}`);
    if (op === 'is' && rule.values.length > 1) return tf('op.is_any');
    if (op === 'is_not' && rule.values.length > 1) return tf('op.is_none');
    return tf(`op.${op}`);
  };

  const setRule = (index: number, rule: FilterRule | null) => {
    const rules = [...latest.current.rules];
    if (rule) rules[index] = rule;
    else rules.splice(index, 1);
    update({ rules });
  };

  const addRule = (rule: FilterRule) => {
    // Misma propiedad y operador "es": se suman los valores (Linear hace lo mismo).
    const cur = latest.current.rules;
    const i = cur.findIndex((r) => r.field === rule.field && r.op === rule.op && fieldKind(r.field) !== 'date');
    if (i >= 0) {
      const merged = Array.from(new Set([...cur[i].values, ...rule.values]));
      setRule(i, { ...cur[i], values: merged });
    } else update({ rules: [...cur, rule] });
  };

  /** Tilda o destilda un valor de la regla "<campo> is …" (la crea o la saca). */
  const toggleValue = (field: FilterField, value: string) => {
    const cur = latest.current.rules;
    const i = cur.findIndex((r) => r.field === field && r.op === 'is');
    if (i < 0) {
      update({ rules: [...cur, { field, op: 'is', values: [value] }] });
      return;
    }
    const has = cur[i].values.includes(value);
    const values = has ? cur[i].values.filter((v) => v !== value) : [...cur[i].values, value];
    setRule(i, values.length ? { ...cur[i], values } : null);
  };

  const openAdd = () => {
    setAddField(null);
    setQuick('');
    setValueQuery('');
    setAdding(true);
  };

  // F abre el menú de filtros y / enfoca la búsqueda (como en Linear).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTextEntry(e.target)) return;
      if (document.querySelector('.cmdk, [role="menu"], [role="dialog"], dialog[open]')) return;
      if (e.key === '/') {
        e.preventDefault();
        search.current?.focus();
      } else if ((e.key === 'f' || e.key === 'F') && !e.shiftKey) {
        e.preventDefault();
        openAdd();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const closeAdd = (open: boolean) => {
    setAdding(open);
    if (!open) {
      setAddField(null);
      setQuick('');
      setValueQuery('');
    }
  };

  const matches = (label: string, q: string) => label.toLowerCase().includes(q.trim().toLowerCase());

  // Raíz: propiedades que coinciden y, al tipear, valores de todas las propiedades.
  const rootItems: KeyMenuItem[] = useMemo(() => {
    const q = quick.trim();
    const items: KeyMenuItem[] = fields
      .filter((f) => !q || matches(fieldLabel(f), q))
      .map((f) => ({
        key: `field:${f}`,
        label: fieldLabel(f),
        icon: fieldIcon(f),
        hasChildren: true,
        testId: `track-filter-field-${f}`,
        onPick: () => {
          setAddField(f);
          setValueQuery('');
        },
      }));
    if (q) {
      const hits: KeyMenuItem[] = [];
      for (const f of fields) {
        if (fieldKind(f) === 'date') continue;
        for (const o of optionsFor(f)) {
          if (!matches(o.label, q)) continue;
          hits.push({
            key: `value:${f}:${o.value}`,
            label: o.label,
            icon: o.icon,
            meta: fieldLabel(f),
            onPick: () => {
              addRule({ field: f, op: 'is', values: [o.value] });
              closeAdd(false);
            },
          });
        }
      }
      items.push(...hits.slice(0, 12));
    }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quick, fields, statuses, priorities, members, cycles, milestones, issueLabels, filters]);

  const valueItems = (field: FilterField, q: string): KeyMenuItem[] => {
    if (fieldKind(field) === 'date') {
      return [
        ...DATE_PRESETS.map((p) => ({
          key: p.key,
          label: tf(`preset.${p.key}`),
          icon: <TrackIcon name="calendar" size={13} />,
          onPick: () => {
            addRule({ field, op: p.op, values: [p.value] });
            closeAdd(false);
          },
        })),
        {
          key: 'none',
          label: tf('preset.none'),
          icon: <TrackIcon name="calendar" size={13} />,
          onPick: () => {
            addRule({ field, op: 'empty', values: [] });
            closeAdd(false);
          },
        },
      ].filter((i) => !q.trim() || matches(i.label, q));
    }
    const rule = filters.rules.find((r) => r.field === field && r.op === 'is');
    return optionsFor(field)
      .filter((o) => !q.trim() || matches(o.label, q))
      .map((o) => ({
        key: o.value,
        label: o.label,
        icon: o.icon,
        checked: Boolean(rule?.values.includes(o.value)),
        testId: `track-filter-value-${o.value}`,
        onPick: () => toggleValue(field, o.value),
      }));
  };

  const addMenu = (
    <Dropdown
      open={adding}
      onOpenChange={closeAdd}
      label={labels.filter}
      triggerClass={`btn btn-ghost btn-sm track-filter-toggle${activeCount > 0 ? ' is-active' : ''}`}
      testId="track-filter-add"
      trigger={
        <>
          <TrackIcon name="filter" size={12} />
          {labels.filter}
          <kbd className="kbd track-kbd" aria-hidden>
            F
          </kbd>
        </>
      }
    >
      {addField === null ? (
        <KeyMenu
          ariaLabel={labels.filter}
          items={rootItems}
          query={quick}
          onQuery={setQuick}
          placeholder={tf('searchPlaceholder')}
          inputTestId="track-filter-quick"
          hint={tf('hint')}
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
          placeholder={tf('searchPlaceholder')}
          inputTestId="track-filter-value-search"
          onBack={() => {
            setAddField(null);
            setValueQuery('');
          }}
        />
      )}
      {addField !== null && fieldKind(addField) === 'date' && (
        <label className="ui-field track-filter-date">
          <span className="label">{tf('before')}</span>
          <input
            className="input"
            type="date"
            onChange={(e) => {
              if (!e.target.value) return;
              addRule({ field: addField, op: 'before', values: [e.target.value] });
              closeAdd(false);
            }}
          />
        </label>
      )}
    </Dropdown>
  );

  const toggleMatch = () => update({ match: filters.match === 'and' ? 'or' : 'and' });

  const chips = filters.rules.map((rule, index) => {
    const key = `${index}`;
    const kind = fieldKind(rule.field);
    return (
      <span key={`${rule.field}-${index}`} className="track-filter-chip-wrap">
        {index > 0 && (
          <button
            type="button"
            className="track-filter-connector"
            onClick={toggleMatch}
            title={tf('matchToggle', { next: filters.match === 'and' ? tf('or') : tf('and') })}
            data-testid="track-filter-connector"
          >
            {filters.match === 'and' ? tf('and') : tf('or')}
          </button>
        )}
        <span className="track-filter-chip" data-testid="track-filter-chip">
          <span className="track-filter-chip-field">
            {fieldIcon(rule.field)}
            {fieldLabel(rule.field)}
          </span>
          <Dropdown
            open={openChip === `${key}:op`}
            onOpenChange={(o) => setOpenChip(o ? `${key}:op` : null)}
            label={tf('operator')}
            triggerClass="track-filter-chip-part"
            testId="track-filter-op"
            trigger={opLabel(rule)}
          >
            <KeyMenu
              ariaLabel={tf('operator')}
              searchable={false}
              items={operatorsFor(rule.field).map((op) => ({
                key: op,
                label: opLabel(rule, op),
                checked: op === rule.op,
                onPick: () => {
                  setOpenChip(null);
                  const values = needsValues(op) ? (rule.values.length ? rule.values : kind === 'date' ? ['today'] : []) : [];
                  if (needsValues(op) && values.length === 0) setOpenChip(`${key}:values`);
                  setRule(index, { ...rule, op, values });
                },
              }))}
            />
          </Dropdown>
          {needsValues(rule.op) && (
            <Dropdown
              open={openChip === `${key}:values`}
              onOpenChange={(o) => {
                setOpenChip(o ? `${key}:values` : null);
                setChipQuery('');
              }}
              label={fieldLabel(rule.field)}
              triggerClass="track-filter-chip-part is-values"
              trigger={
                <>
                  {valueIcon(rule)}
                  {valueLabel(rule) || '…'}
                </>
              }
            >
              {kind === 'date' ? (
                <>
                  <KeyMenu
                    ariaLabel={fieldLabel(rule.field)}
                    searchable={false}
                    items={['today', '-7d', '-30d', '+7d', '+30d'].map((v) => ({
                      key: v,
                      label: tf(`rel.${v}`),
                      checked: rule.values[0] === v,
                      onPick: () => {
                        setOpenChip(null);
                        setRule(index, { ...rule, values: [v] });
                      },
                    }))}
                  />
                  <label className="ui-field track-filter-date">
                    <span className="label">{tf('pickDate')}</span>
                    <input
                      className="input"
                      type="date"
                      defaultValue={/^\d{4}/.test(rule.values[0] ?? '') ? rule.values[0] : ''}
                      onChange={(e) => e.target.value && setRule(index, { ...rule, values: [e.target.value] })}
                    />
                  </label>
                </>
              ) : (
                <KeyMenu
                  ariaLabel={fieldLabel(rule.field)}
                  query={chipQuery}
                  onQuery={setChipQuery}
                  placeholder={tf('searchPlaceholder')}
                  items={optionsFor(rule.field)
                    .filter((o) => !chipQuery.trim() || matches(o.label, chipQuery))
                    .map((o) => {
                      const single = kind === 'number' && (rule.op === 'gte' || rule.op === 'lte');
                      return {
                        key: o.value,
                        label: o.label,
                        icon: o.icon,
                        checked: rule.values.includes(o.value),
                        onPick: () => {
                          const cur = latest.current.rules[index] ?? rule;
                          if (single) {
                            setRule(index, { ...cur, values: [o.value] });
                            setOpenChip(null);
                            return;
                          }
                          const values = cur.values.includes(o.value) ? cur.values.filter((v) => v !== o.value) : [...cur.values, o.value];
                          setRule(index, values.length ? { ...cur, values } : null);
                          if (!values.length) setOpenChip(null);
                        },
                      };
                    })}
                />
              )}
            </Dropdown>
          )}
          <button
            type="button"
            className="track-filter-chip-remove"
            aria-label={tf('remove', { field: fieldLabel(rule.field) })}
            onClick={() => setRule(index, null)}
          >
            <TrackIcon name="close" size={10} />
          </button>
        </span>
      </span>
    );
  });

  return (
    <div className="track-filters" role="search">
      <div className="track-filter-group" id="track-filter-sheet">
        {addMenu}
        {chips}
        {filters.rules.length > 1 && (
          <button
            type="button"
            className="btn btn-ghost btn-sm track-filter-match"
            onClick={toggleMatch}
            title={tf('matchHelp')}
            data-testid="track-filter-match"
          >
            {filters.match === 'and' ? tf('matchAll') : tf('matchAny')}
          </button>
        )}
        {(activeCount > 0 || filters.q) && (
          <button type="button" className="btn btn-ghost btn-sm track-filter-clear" onClick={() => onChange({ ...EMPTY_FILTERS })}>
            {labels.clear}
          </button>
        )}
      </div>
      <div className="track-filter-search">
        <span className="track-search">
          <TrackIcon name="search" size={14} />
          <input
            ref={search}
            className="input"
            type="search"
            value={filters.q}
            onChange={(e) => update({ q: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                if (filters.q) update({ q: '' });
                else (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder={labels.search}
            aria-label={labels.search}
            aria-keyshortcuts="/"
            data-testid="track-search"
          />
          <kbd className="kbd track-search-kbd" aria-hidden>
            /
          </kbd>
        </span>
        {updateView ? (
          <>
            <button type="button" className="btn btn-sm track-filter-save" onClick={updateView.onUpdate} data-testid="track-update-view">
              {updateView.updateLabel}
            </button>
            <button type="button" className="btn btn-ghost btn-sm track-filter-save" onClick={onSaveView} data-testid="track-save-view">
              {updateView.saveAsNewLabel}
            </button>
          </>
        ) : (
          activeCount > 0 && (
            <button type="button" className="btn btn-ghost btn-sm track-filter-save" onClick={onSaveView} data-testid="track-save-view">
              {labels.saveView}
            </button>
          )
        )}
        {trailing}
      </div>
    </div>
  );
}
