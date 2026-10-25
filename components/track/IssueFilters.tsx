'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import TrackIcon from './TrackIcon';
import { ESTIMATE_OPTIONS } from './trackCommands';

export type { FilterState } from '@/lib/track-filter';
export { EMPTY_FILTERS } from '@/lib/track-filter';

interface IssueFiltersProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  onSaveView: () => void;
  statuses: TrackStatusRow[];
  priorities: Array<{ value: string; label: string }>;
  members: Array<{ id: string; name: string | null; email: string }>;
  cycles: TrackCycleRow[];
  milestones?: Array<{ id: string; name: string }>;
  issueLabels: IssueLabel[];
  labels: FilterLabels;
  /** Vistas guardadas: en pantallas chicas viven dentro de la hoja "Filtrar". */
  savedViews?: ReactNode;
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
}

function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node || typeof node.closest !== 'function') return false;
  return node.isContentEditable || Boolean(node.closest('input, textarea, select, [contenteditable="true"], dialog, [role="dialog"]'));
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
        aria-haspopup="true"
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

/** Lista con búsqueda y checkboxes (valores de una regla). */
function ValuePicker({
  options,
  values,
  onChange,
  placeholder,
  multiple = true,
}: {
  options: ValueOption[];
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  multiple?: boolean;
}) {
  const [q, setQ] = useState('');
  const list = options.filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="track-filter-values">
      {options.length > 6 && (
        <input
          className="input track-filter-search-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          autoFocus
        />
      )}
      {list.map((o) => (
        <label key={o.value} className="ui-check track-filter-option">
          <input
            type={multiple ? 'checkbox' : 'radio'}
            checked={values.includes(o.value)}
            onChange={(e) => {
              if (!multiple) onChange([o.value]);
              else if (e.target.checked) onChange([...values, o.value]);
              else onChange(values.filter((v) => v !== o.value));
            }}
          />
          {o.color && <span className="track-filter-swatch" style={{ background: safeHexColor(o.color, '#767676') }} aria-hidden />}
          <span>{o.label}</span>
        </label>
      ))}
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

/**
 * Filtros como en Linear: "Filtro" (o F) abre el menú de propiedades; cada
 * filtro es un chip "Estado · es · Todo, En curso" donde se cambia el
 * operador (es, no es, vacío, antes, después…) y los valores. Con dos o más,
 * se elige si tienen que cumplirse todos (AND) o alguno (OR). Tipear en el
 * menú busca valores en todas las propiedades (filtro rápido).
 */
export default function IssueFilters({
  filters,
  onChange,
  onSaveView,
  statuses,
  priorities,
  members,
  cycles,
  milestones = [],
  issueLabels,
  labels,
  savedViews,
}: IssueFiltersProps) {
  const t = useTranslations('track');
  const tf = useTranslations('track.ux.filter');
  const search = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  const [addField, setAddField] = useState<FilterField | null>(null);
  const [quick, setQuick] = useState('');
  const [openChip, setOpenChip] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const activeCount = activeFilterCount(filters);
  const update = (patch: Partial<FilterState>) => onChange({ ...filters, ...patch });

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

  const optionsFor = (f: FilterField): ValueOption[] => {
    switch (f) {
      case 'status':
        return statuses.map((s) => ({ value: s.id, label: s.name, color: s.color }));
      case 'priority':
        return priorities;
      case 'assignee':
        return [{ value: NONE_VALUE, label: tf('noAssignee') }, ...members.map((m) => ({ value: m.id, label: m.name ?? m.email }))];
      case 'creator':
        return members.map((m) => ({ value: m.id, label: m.name ?? m.email }));
      case 'label':
        return issueLabels.map((l) => ({ value: l.id, label: l.name, color: l.color }));
      case 'cycle':
        return [{ value: NONE_VALUE, label: tf('noCycle') }, ...cycles.map((c) => ({ value: c.id, label: c.name }))];
      case 'milestone':
        return [{ value: NONE_VALUE, label: tf('noMilestone') }, ...milestones.map((m) => ({ value: m.id, label: m.name }))];
      case 'estimate':
        return ESTIMATE_OPTIONS.map((n) => ({ value: String(n), label: tf('points', { count: n }) }));
      case 'relation':
        return RELATION_VALUES.map((v) => ({ value: v, label: tf(`relation.${v}`) }));
      case 'hierarchy':
        return HIERARCHY_VALUES.map((v) => ({ value: v, label: tf(`hierarchy.${v}`) }));
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

  const setRule = (index: number, rule: FilterRule | null) => {
    const rules = [...filters.rules];
    if (rule) rules[index] = rule;
    else rules.splice(index, 1);
    update({ rules });
  };

  const addRule = (rule: FilterRule) => {
    // Misma propiedad y operador "es": se suman los valores (Linear hace lo mismo).
    const i = filters.rules.findIndex((r) => r.field === rule.field && r.op === rule.op && fieldKind(r.field) !== 'date');
    if (i >= 0) {
      const merged = Array.from(new Set([...filters.rules[i].values, ...rule.values]));
      setRule(i, { ...filters.rules[i], values: merged });
    } else update({ rules: [...filters.rules, rule] });
  };

  // F abre el menú de filtros y / enfoca la búsqueda (como en Linear).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (document.querySelector('.cmdk, [role="menu"]')) return;
      if (e.key === '/') {
        e.preventDefault();
        search.current?.focus();
      } else if ((e.key === 'f' || e.key === 'F') && !e.shiftKey) {
        e.preventDefault();
        setAddField(null);
        setQuick('');
        setAdding(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Filtro rápido: valores de todas las propiedades que coinciden con lo tipeado.
  const quickHits = useMemo(() => {
    const q = quick.trim().toLowerCase();
    if (!q) return [];
    const hits: Array<{ field: FilterField; option: ValueOption }> = [];
    for (const f of fields) {
      if (fieldKind(f) === 'date') continue;
      for (const o of optionsFor(f)) {
        if (o.label.toLowerCase().includes(q)) hits.push({ field: f, option: o });
      }
    }
    return hits.slice(0, 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quick, fields, statuses, priorities, members, cycles, milestones, issueLabels]);

  const closeAdd = (open: boolean) => {
    setAdding(open);
    if (!open) {
      setAddField(null);
      setQuick('');
    }
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
        <div className="track-filter-props" onKeyDown={(e) => {
          if (e.key === 'Enter' && quickHits[0]) {
            e.preventDefault();
            addRule({ field: quickHits[0].field, op: 'is', values: [quickHits[0].option.value] });
            closeAdd(false);
          }
        }}>
          <input
            className="input track-filter-search-input"
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            placeholder={tf('searchPlaceholder')}
            aria-label={tf('searchPlaceholder')}
            autoFocus
            data-testid="track-filter-quick"
          />
          {quickHits.length > 0
            ? quickHits.map((h) => (
                <button
                  key={`${h.field}:${h.option.value}`}
                  type="button"
                  className="track-filter-prop"
                  onClick={() => {
                    addRule({ field: h.field, op: 'is', values: [h.option.value] });
                    closeAdd(false);
                  }}
                >
                  {h.option.color && <span className="track-filter-swatch" style={{ background: safeHexColor(h.option.color, '#767676') }} aria-hidden />}
                  <span>{h.option.label}</span>
                  <span className="track-filter-prop-meta">{fieldLabel(h.field)}</span>
                </button>
              ))
            : fields
                .filter((f) => !quick.trim() || fieldLabel(f).toLowerCase().includes(quick.trim().toLowerCase()))
                .map((f) => (
                  <button key={f} type="button" className="track-filter-prop" onClick={() => setAddField(f)} data-testid={`track-filter-field-${f}`}>
                    <span>{fieldLabel(f)}</span>
                    <TrackIcon name="chevronDown" size={10} />
                  </button>
                ))}
        </div>
      ) : fieldKind(addField) === 'date' ? (
        <div className="track-filter-values">
          <p className="track-filter-menu-head">{fieldLabel(addField)}</p>
          {DATE_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              className="track-filter-prop"
              onClick={() => {
                addRule({ field: addField, op: p.op, values: [p.value] });
                closeAdd(false);
              }}
            >
              {tf(`preset.${p.key}`)}
            </button>
          ))}
          <button
            type="button"
            className="track-filter-prop"
            onClick={() => {
              addRule({ field: addField, op: 'empty', values: [] });
              closeAdd(false);
            }}
          >
            {tf('preset.none')}
          </button>
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
        </div>
      ) : (
        <div>
          <p className="track-filter-menu-head">{fieldLabel(addField)}</p>
          <ValuePicker
            options={optionsFor(addField)}
            values={[]}
            placeholder={tf('searchPlaceholder')}
            onChange={(values) => {
              if (values.length) addRule({ field: addField, op: 'is', values });
              closeAdd(false);
            }}
          />
        </div>
      )}
    </Dropdown>
  );

  const chips = filters.rules.map((rule, index) => {
    const key = `${index}`;
    const kind = fieldKind(rule.field);
    return (
      <span key={`${rule.field}-${index}`} className="track-filter-chip" data-testid="track-filter-chip">
        <span className="track-filter-chip-field">{fieldLabel(rule.field)}</span>
        <Dropdown
          open={openChip === `${key}:op`}
          onOpenChange={(o) => setOpenChip(o ? `${key}:op` : null)}
          label={tf('operator')}
          triggerClass="track-filter-chip-part"
          testId="track-filter-op"
          trigger={tf(`op.${kind === 'date' ? `date_${rule.op}` : rule.op}`)}
        >
          {operatorsFor(rule.field).map((op) => (
            <button
              key={op}
              type="button"
              className={`track-filter-prop${op === rule.op ? ' is-active' : ''}`}
              onClick={() => {
                setOpenChip(null);
                const values = needsValues(op) ? (rule.values.length ? rule.values : kind === 'date' ? ['today'] : []) : [];
                if (needsValues(op) && values.length === 0) setOpenChip(`${key}:values`);
                setRule(index, { ...rule, op, values });
              }}
            >
              {tf(`op.${kind === 'date' ? `date_${op}` : op}`)}
            </button>
          ))}
        </Dropdown>
        {needsValues(rule.op) && (
          <Dropdown
            open={openChip === `${key}:values`}
            onOpenChange={(o) => setOpenChip(o ? `${key}:values` : null)}
            label={fieldLabel(rule.field)}
            triggerClass="track-filter-chip-part is-values"
            trigger={valueLabel(rule) || '…'}
          >
            {kind === 'date' ? (
              <div className="track-filter-values">
                {['today', '-7d', '-30d', '+7d', '+30d'].map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={`track-filter-prop${rule.values[0] === v ? ' is-active' : ''}`}
                    onClick={() => {
                      setOpenChip(null);
                      setRule(index, { ...rule, values: [v] });
                    }}
                  >
                    {tf(`rel.${v}`)}
                  </button>
                ))}
                <label className="ui-field track-filter-date">
                  <span className="label">{tf('pickDate')}</span>
                  <input
                    className="input"
                    type="date"
                    defaultValue={/^\d{4}/.test(rule.values[0] ?? '') ? rule.values[0] : ''}
                    onChange={(e) => e.target.value && setRule(index, { ...rule, values: [e.target.value] })}
                  />
                </label>
              </div>
            ) : kind === 'number' && (rule.op === 'gte' || rule.op === 'lte') ? (
              <ValuePicker
                multiple={false}
                options={optionsFor(rule.field)}
                values={rule.values}
                placeholder={tf('searchPlaceholder')}
                onChange={(values) => setRule(index, { ...rule, values })}
              />
            ) : (
              <ValuePicker
                options={optionsFor(rule.field)}
                values={rule.values}
                placeholder={tf('searchPlaceholder')}
                onChange={(values) => setRule(index, values.length ? { ...rule, values } : null)}
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
    );
  });

  return (
    <div className={`track-filters${sheetOpen ? ' is-sheet-open' : ''}`} role="search">
      <div className="track-filter-group" id="track-filter-sheet">
        {addMenu}
        {filters.rules.length > 1 && (
          <button
            type="button"
            className="btn btn-ghost btn-sm track-filter-match"
            onClick={() => update({ match: filters.match === 'and' ? 'or' : 'and' })}
            title={tf('matchHelp')}
            data-testid="track-filter-match"
          >
            {filters.match === 'and' ? tf('matchAll') : tf('matchAny')}
          </button>
        )}
        {chips}
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
              if (e.key === 'Escape' && filters.q) {
                e.preventDefault();
                update({ q: '' });
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
        <span className="track-filter-sheet-views">{sheetOpen && savedViews}</span>
        <button
          type="button"
          className={`btn btn-sm track-filter-sheet-btn${sheetOpen ? ' is-active' : ''}`}
          onClick={() => setSheetOpen((v) => !v)}
          aria-expanded={sheetOpen}
          data-testid="track-filter-sheet-open"
        >
          {t('savedViews.title')}
        </button>
        <button type="button" className="btn btn-ghost btn-sm track-filter-save" onClick={onSaveView} data-testid="track-save-view">
          {labels.saveView}
        </button>
      </div>
    </div>
  );
}
