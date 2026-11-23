'use client';

import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import {
  DEFAULT_FILTER_OP,
  FILTER_OPS,
  MAX_FILTER_GROUPS,
  MAX_GROUP_RULES,
  MAX_RULE_VALUES,
  countFilterRules,
  isRuleComplete,
  opArity,
  type FilterCond,
  type FilterModel,
} from '@/lib/crm-filter-model';
import CrmIcon from './CrmIcon';
import type { AdvFilterField } from './advancedFilterFields';
import { OPEN_FILTERS_EVENT, describeRule, filterHref, type FilterT } from './advancedFilterText';

/**
 * Filtros avanzados de un listado del CRM (contactos, empresas, deals), al
 * estilo de HubSpot: un panel lateral (hoja a pantalla completa en el
 * teléfono) donde se arman grupos de filtros. Dentro de un grupo se cumplen
 * todos (Y); entre grupos alcanza con uno (O).
 *
 * Lo que se toca es un borrador: vale al tocar "Aplicar filtros", que deja el
 * filtro en la URL (`?filters=`, ver lib/crm-filter-model.ts) para compartirla
 * o recargarla. Cerrar, Esc o un clic afuera lo descartan. Es un <dialog>
 * modal: el foco queda adentro y vuelve al botón al cerrar.
 */

export interface DraftRule {
  id: number;
  /** '' = todavía eligiendo la propiedad. */
  f: string;
  o: string;
  values: string[];
  v2: string;
  /** Texto a medio escribir en un campo de varios valores: cuenta como un valor más al aplicar. */
  text: string;
  picking: boolean;
}

interface DraftGroup {
  id: number;
  rules: DraftRule[];
}

let seq = 0;
const nextId = () => ++seq;

const emptyRule = (): DraftRule => ({ id: nextId(), f: '', o: '', values: [], v2: '', text: '', picking: true });

function toDraft(model: FilterModel): DraftGroup[] {
  const groups = model.groups.map((g) => ({
    id: nextId(),
    rules: g.rules.map(
      (r): DraftRule => ({
        id: nextId(),
        f: r.f,
        o: r.o,
        values: Array.isArray(r.v) ? [...r.v] : r.v === undefined ? [] : [r.v],
        v2: r.v2 ?? '',
        text: '',
        picking: false,
      }),
    ),
  }));
  return groups.length ? groups : [{ id: nextId(), rules: [emptyRule()] }];
}

export function opsOf(field: AdvFilterField, current?: string): readonly string[] {
  const ops = field.ops ?? FILTER_OPS[field.type];
  // Un link viejo puede traer un operador que el panel ya no ofrece (sí/no como "is" con 1 o 0): se conserva.
  return current && !ops.includes(current) ? [...ops, current] : ops;
}

/** La regla del borrador tal como va al modelo. */
export function toCond(rule: DraftRule, field: AdvFilterField): FilterCond {
  const arity = opArity(field.type, rule.o);
  if (arity === 'none') return { f: rule.f, o: rule.o };
  if (arity === 'two') return { f: rule.f, o: rule.o, v: (rule.values[0] ?? '').trim(), v2: rule.v2.trim() };
  if (arity === 'many') {
    const pending = rule.text.trim();
    const values = pending && !rule.values.includes(pending) ? [...rule.values, pending] : rule.values;
    return { f: rule.f, o: rule.o, v: values.slice(0, MAX_RULE_VALUES) };
  }
  return { f: rule.f, o: rule.o, v: (rule.values[0] ?? '').trim() };
}

interface AdvancedFiltersProps {
  fields: AdvFilterField[];
  /** El filtro aplicado (ya validado contra `fields` en el server). */
  model: FilterModel;
  /** Query params vigentes (búsqueda, orden, pipeline…) que se conservan al navegar. */
  baseQuery: Record<string, string>;
  /** Params que se sueltan al cambiar el filtro (la vista guardada activa). */
  resetKeys?: readonly string[];
}

export default function AdvancedFilters({ fields, model, baseQuery, resetKeys }: AdvancedFiltersProps) {
  const t = useTranslations('crm') as unknown as FilterT;
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<DraftGroup[]>([]);
  const [showErrors, setShowErrors] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const byKey = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields]);
  const active = countFilterRules(model);
  /** Reglas recién elegidas: al dibujarse, el foco pasa a su operador (el buscador de propiedades desaparece). */
  const justPicked = useRef(new Set<number>());

  function openPanel() {
    setGroups(toDraft(model));
    setShowErrors(false);
    setOpen(true);
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog || dialog.open) return;
    dialog.showModal();
    // Sin filtros todavía, el foco va al buscador de propiedades (showModal lo deja en el primer botón).
    dialog.querySelector<HTMLElement>('[data-initial-focus]')?.focus();
  }, [open]);

  // Un chip de la barra pide abrir el panel.
  useEffect(() => {
    const onOpen = () => {
      setGroups(toDraft(model));
      setShowErrors(false);
      setOpen(true);
    };
    window.addEventListener(OPEN_FILTERS_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_FILTERS_EVENT, onOpen);
  }, [model]);

  const close = () => dialogRef.current?.close();

  function patchRule(groupId: number, ruleId: number, patch: Partial<DraftRule>) {
    setGroups((prev) =>
      prev.map((g) => (g.id !== groupId ? g : { ...g, rules: g.rules.map((r) => (r.id !== ruleId ? r : { ...r, ...patch })) })),
    );
  }

  function pickField(groupId: number, ruleId: number, field: AdvFilterField) {
    justPicked.current.add(ruleId);
    setGroups((prev) =>
      prev.map((g) =>
        g.id !== groupId
          ? g
          : {
              ...g,
              rules: g.rules.map((r) => {
                if (r.id !== ruleId) return r;
                if (r.f === field.key) return { ...r, picking: false };
                const ops = opsOf(field);
                const o = ops.includes(DEFAULT_FILTER_OP[field.type]) ? DEFAULT_FILTER_OP[field.type] : ops[0];
                return { ...r, f: field.key, o, values: [], v2: '', text: '', picking: false };
              }),
            },
      ),
    );
  }

  function changeOp(groupId: number, rule: DraftRule, field: AdvFilterField, o: string) {
    // Si el operador nuevo lleva otro tipo de valor, lo cargado no sirve.
    const same = opArity(field.type, o) === opArity(field.type, rule.o);
    patchRule(groupId, rule.id, same ? { o } : { o, values: [], v2: '', text: '' });
  }

  function removeRule(groupId: number, ruleId: number) {
    setGroups((prev) => {
      const next = prev
        .map((g) => (g.id !== groupId ? g : { ...g, rules: g.rules.filter((r) => r.id !== ruleId) }))
        .filter((g) => g.rules.length > 0);
      return next.length ? next : [{ id: nextId(), rules: [emptyRule()] }];
    });
  }

  function addRule(groupId: number) {
    setGroups((prev) => prev.map((g) => (g.id !== groupId || g.rules.length >= MAX_GROUP_RULES ? g : { ...g, rules: [...g.rules, emptyRule()] })));
  }

  function addGroup() {
    setGroups((prev) => (prev.length >= MAX_FILTER_GROUPS ? prev : [...prev, { id: nextId(), rules: [emptyRule()] }]));
  }

  function removeGroup(groupId: number) {
    setGroups((prev) => {
      const next = prev.filter((g) => g.id !== groupId);
      return next.length ? next : [{ id: nextId(), rules: [emptyRule()] }];
    });
  }

  const incomplete = (rule: DraftRule): boolean => {
    const field = byKey.get(rule.f);
    if (!field) return false;
    return !isRuleComplete(field.type, toCond(rule, field), opsOf(field, rule.o));
  };

  function go(next: FilterModel) {
    router.push(filterHref(pathname, baseQuery, next, resetKeys));
    close();
  }

  function apply(e?: FormEvent) {
    e?.preventDefault();
    const chosen = groups.map((g) => g.rules.filter((r) => byKey.has(r.f)));
    if (chosen.some((rules) => rules.some(incomplete))) {
      setShowErrors(true);
      return;
    }
    go({
      v: 1,
      groups: chosen.filter((rules) => rules.length > 0).map((rules) => ({ rules: rules.map((r) => toCond(r, byKey.get(r.f)!)) })),
    });
  }

  const anyIncomplete = showErrors && groups.some((g) => g.rules.some(incomplete));

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`filter-more crm-af-open${active ? ' on' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={openPanel}
        data-testid="adv-filters-open"
      >
        {t('filters.advanced')}
        {active > 0 && (
          <span className="filter-count" data-testid="adv-filters-count" aria-label={t('filters.active', { count: active })}>
            {active}
          </span>
        )}
      </button>

      {open && (
        <dialog
          ref={dialogRef}
          className="ui-drawer crm-af"
          aria-labelledby={titleId}
          data-testid="adv-filters-panel"
          onClose={() => {
            setOpen(false);
            buttonRef.current?.focus();
          }}
          onClick={(e) => {
            // El clic en el telón (fuera del panel) llega con el propio <dialog> como target.
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="ui-drawer-head">
            <h2 className="ui-drawer-title" id={titleId}>
              {t('filters.advanced')}
            </h2>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={close} aria-label={t('common.close')} data-testid="adv-filters-close">
              <CrmIcon name="x" size={16} />
            </button>
          </div>

          <form className="crm-af-form" onSubmit={apply} noValidate>
            <div className="ui-drawer-body crm-af-body">
              <p className="crm-af-hint">{t('filters.panelHint')}</p>

              {groups.map((group, gi) => (
                <div key={group.id} className="crm-af-group-wrap">
                  {gi > 0 && (
                    <div className="crm-af-or" aria-hidden="true">
                      <span>{t('filters.or')}</span>
                    </div>
                  )}
                  <section className="crm-af-group" aria-label={t('filters.groupTitle', { n: gi + 1 })} data-testid="adv-filters-group">
                    <header className="crm-af-group-head">
                      <h3 className="crm-af-group-title">{t('filters.groupTitle', { n: gi + 1 })}</h3>
                      {groups.length > 1 && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon btn-sm"
                          onClick={() => removeGroup(group.id)}
                          aria-label={t('filters.removeGroup', { n: gi + 1 })}
                          title={t('filters.removeGroup', { n: gi + 1 })}
                        >
                          <CrmIcon name="x" size={14} />
                        </button>
                      )}
                    </header>

                    {group.rules.map((rule, ri) => {
                      const field = byKey.get(rule.f);
                      return (
                        <div key={rule.id} className="crm-af-rule-wrap">
                          {ri > 0 && <div className="crm-af-and">{t('filters.and')}</div>}
                          <div className="crm-af-rule" data-testid="adv-filters-rule">
                            {rule.picking || !field ? (
                              <PropertyPicker
                                t={t}
                                fields={fields}
                                current={field?.key}
                                onPick={(f) => pickField(group.id, rule.id, f)}
                                onCancel={field ? () => patchRule(group.id, rule.id, { picking: false }) : () => removeRule(group.id, rule.id)}
                              />
                            ) : (
                              <>
                                <div className="crm-af-rule-head">
                                  <button
                                    type="button"
                                    className="crm-af-prop"
                                    onClick={() => patchRule(group.id, rule.id, { picking: true })}
                                    aria-label={t('filters.changeProperty', { name: field.label })}
                                    data-testid="adv-filters-prop"
                                  >
                                    <span className="crm-af-prop-name">{field.label}</span>
                                    <CrmIcon name="chevronDown" size={14} />
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-icon btn-sm"
                                    onClick={() => removeRule(group.id, rule.id)}
                                    aria-label={t('filters.removeRule')}
                                    title={t('filters.removeRule')}
                                    data-testid="adv-filters-remove-rule"
                                  >
                                    <CrmIcon name="x" size={14} />
                                  </button>
                                </div>
                                <OpSelect
                                  label={t('filters.operator')}
                                  value={rule.o}
                                  options={opsOf(field, rule.o).map((op) => ({ value: op, label: t(`filters.opLabel.${op}`) }))}
                                  onChange={(o) => changeOp(group.id, rule, field, o)}
                                  takeFocus={() => justPicked.current.delete(rule.id)}
                                />
                                <ValueEditor t={t} field={field} rule={rule} onChange={(patch) => patchRule(group.id, rule.id, patch)} />
                                {showErrors && incomplete(rule) && (
                                  <p className="crm-af-error" role="alert" data-testid="adv-filters-error">
                                    {t('filters.incomplete')}
                                  </p>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    <button
                      type="button"
                      className="btn btn-ghost btn-sm crm-af-add"
                      onClick={() => addRule(group.id)}
                      disabled={group.rules.length >= MAX_GROUP_RULES}
                      data-testid="adv-filters-add-rule"
                    >
                      + {t('filters.addFilter')}
                    </button>
                  </section>
                </div>
              ))}

              <div className="crm-af-or crm-af-or-add">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={addGroup}
                  disabled={groups.length >= MAX_FILTER_GROUPS}
                  data-testid="adv-filters-add-group"
                >
                  + {t('filters.addGroup')}
                </button>
                {groups.length >= MAX_FILTER_GROUPS && <span className="crm-af-limit">{t('filters.groupLimit', { max: MAX_FILTER_GROUPS })}</span>}
              </div>
            </div>

            <div className="ui-drawer-foot crm-af-foot">
              {anyIncomplete && (
                <p className="crm-af-foot-note" role="status">
                  {t('filters.fixIncomplete')}
                </p>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => go({ v: 1, groups: [] })}
                disabled={active === 0 && !groups.some((g) => g.rules.some((r) => r.f))}
                data-testid="adv-filters-clear"
              >
                {t('filters.clearAll')}
              </button>
              <button type="submit" className="btn btn-primary btn-sm" data-testid="adv-filters-apply">
                {t('filters.apply')}
              </button>
            </div>
          </form>
        </dialog>
      )}
    </>
  );
}

/** El operador de una regla. Recién elegida la propiedad, toma el foco para seguir con el teclado. */
function OpSelect({
  label,
  value,
  options,
  onChange,
  takeFocus,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (op: string) => void;
  takeFocus: () => boolean;
}) {
  const ref = useRef<HTMLSelectElement>(null);
  const takeFocusRef = useRef(takeFocus);
  useEffect(() => {
    if (takeFocusRef.current()) ref.current?.focus();
  }, []);
  return (
    <select ref={ref} className="select crm-af-op" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} data-testid="adv-filters-op">
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Buscador de propiedades: un campo de texto y la lista agrupada debajo. Flechas y Enter eligen. */
function PropertyPicker({
  t,
  fields,
  current,
  onPick,
  onCancel,
}: {
  t: FilterT;
  fields: AdvFilterField[];
  current?: string;
  onPick: (field: AdvFilterField) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState('');
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? fields.filter((f) => f.label.toLowerCase().includes(q) || f.group.toLowerCase().includes(q)) : fields;
  }, [fields, query]);
  const [activeKey, setActiveKey] = useState<string | undefined>(current);
  const activeIndex = Math.max(0, matches.findIndex((f) => f.key === activeKey));
  const activeField = matches[activeIndex];

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!activeField) return;
    listRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(activeField.key)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeField]);

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!matches.length) return;
      const next = (activeIndex + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
      setActiveKey(matches[next].key);
    } else if (e.key === 'Enter') {
      // Enter elige la propiedad; no envía el formulario del panel.
      e.preventDefault();
      if (activeField) onPick(activeField);
    }
  }

  let lastGroup = '';
  return (
    <div className="crm-af-picker">
      <div className="crm-af-picker-head">
        <input
          ref={inputRef}
          className="input crm-af-picker-input"
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={activeField ? `${listId}-${activeIndex}` : undefined}
          aria-label={t('filters.searchProperty')}
          placeholder={t('filters.searchProperty')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          data-testid="adv-filters-prop-search"
          data-initial-focus=""
        />
        <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onCancel} aria-label={t('common.cancel')} title={t('common.cancel')}>
          <CrmIcon name="x" size={14} />
        </button>
      </div>
      <div className="crm-af-picker-list" role="listbox" id={listId} aria-label={t('filters.chooseProperty')} ref={listRef}>
        {matches.length === 0 && <p className="crm-af-empty">{t('filters.noProperty', { query: query.trim() })}</p>}
        {matches.map((f, i) => {
          const heading = f.group !== lastGroup ? f.group : '';
          lastGroup = f.group;
          return (
            <div key={f.key} role="presentation">
              {heading && (
                <div className="crm-af-picker-group" role="presentation">
                  {heading}
                </div>
              )}
              <button
                type="button"
                role="option"
                id={`${listId}-${i}`}
                aria-selected={i === activeIndex}
                className={`crm-af-picker-item${i === activeIndex ? ' is-active' : ''}`}
                data-key={f.key}
                tabIndex={-1}
                onMouseEnter={() => setActiveKey(f.key)}
                onClick={() => onPick(f)}
              >
                {f.label}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** El editor del valor según el tipo de la propiedad y lo que pide el operador. */
export function ValueEditor({
  t,
  field,
  rule,
  onChange,
}: {
  t: FilterT;
  field: AdvFilterField;
  rule: DraftRule;
  onChange: (patch: Partial<DraftRule>) => void;
}) {
  const arity = opArity(field.type, rule.o);
  const first = rule.values[0] ?? '';
  if (arity === 'none') return null;

  if (arity === 'days') {
    return (
      <label className="crm-af-days">
        <input
          className="input"
          type="number"
          inputMode="numeric"
          min={1}
          max={3650}
          step={1}
          value={first}
          onChange={(e) => onChange({ values: [e.target.value] })}
          aria-label={t('filters.days')}
          data-testid="adv-filters-value"
        />
        <span>{t('filters.days').toLowerCase()}</span>
      </label>
    );
  }

  if (arity === 'one' || arity === 'two') {
    if (field.type === 'boolean') {
      return (
        <select className="select" value={first === 'true' ? '1' : first} onChange={(e) => onChange({ values: [e.target.value] })} aria-label={t('filters.value')} data-testid="adv-filters-value">
          <option value="">—</option>
          <option value="1">{t('filters.yes')}</option>
          <option value="0">{t('filters.no')}</option>
        </select>
      );
    }
    const type = field.type === 'date' ? 'date' : 'number';
    const input = (value: string, set: (v: string) => void, label: string, testid: string) => (
      <input
        className="input"
        type={type}
        step={type === 'number' ? 'any' : undefined}
        value={value}
        onChange={(e) => set(e.target.value)}
        aria-label={label}
        data-testid={testid}
      />
    );
    if (arity === 'one') return input(first, (v) => onChange({ values: [v] }), t('filters.value'), 'adv-filters-value');
    return (
      <div className="crm-af-range">
        {input(first, (v) => onChange({ values: [v] }), t('filters.from'), 'adv-filters-value')}
        <span className="crm-af-range-sep" aria-hidden="true">
          –
        </span>
        {input(rule.v2, (v) => onChange({ v2: v }), t('filters.to'), 'adv-filters-value-to')}
      </div>
    );
  }

  // Varios valores: casillas si la propiedad tiene opciones; si no, valores escritos.
  if (field.options) return <OptionList t={t} field={field} values={rule.values} onChange={(values) => onChange({ values })} />;
  return <TokenInput t={t} label={field.label} values={rule.values} text={rule.text} onChange={onChange} />;
}

const OPTION_SEARCH_FROM = 8;

function OptionList({ t, field, values, onChange }: { t: FilterT; field: AdvFilterField; values: string[]; onChange: (values: string[]) => void }) {
  const [query, setQuery] = useState('');
  const options = field.options ?? [];
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  const toggle = (value: string) =>
    onChange(values.includes(value) ? values.filter((v) => v !== value) : values.length >= MAX_RULE_VALUES ? values : [...values, value]);
  return (
    <div className="crm-af-options" role="group" aria-label={field.label} data-testid="adv-filters-options">
      {options.length >= OPTION_SEARCH_FROM && (
        <input
          className="input crm-af-options-search"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
          placeholder={t('filters.searchOptions')}
          aria-label={t('filters.searchOptions')}
          autoComplete="off"
        />
      )}
      <div className="crm-af-options-list">
        {shown.length === 0 && <p className="crm-af-empty">{t('filters.noOptions')}</p>}
        {shown.map((o) => (
          <label key={o.value} className="ui-check crm-af-option">
            <input type="checkbox" value={o.value} checked={values.includes(o.value)} onChange={() => toggle(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function TokenInput({
  t,
  label,
  values,
  text,
  onChange,
}: {
  t: FilterT;
  label: string;
  values: string[];
  text: string;
  onChange: (patch: Partial<DraftRule>) => void;
}) {
  function commit() {
    const v = text.trim();
    if (!v) return false;
    onChange({ values: values.includes(v) || values.length >= MAX_RULE_VALUES ? values : [...values, v], text: '' });
    return true;
  }
  return (
    <div className="crm-af-tokens">
      {values.length > 0 && (
        <ul className="crm-af-token-list" aria-label={label}>
          {values.map((v) => (
            <li key={v} className="crm-af-token">
              <span className="crm-af-token-text">{v}</span>
              <button
                type="button"
                className="crm-af-token-x"
                onClick={() => onChange({ values: values.filter((x) => x !== v) })}
                aria-label={t('filters.removeValue', { value: v })}
              >
                <CrmIcon name="x" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        className="input"
        type="text"
        value={text}
        onChange={(e) => onChange({ text: e.target.value })}
        onKeyDown={(e) => {
          // Enter con texto suma el valor; sin texto, aplica el panel.
          if (e.key === 'Enter' && commit()) e.preventDefault();
        }}
        placeholder={t('filters.valuePlaceholder')}
        aria-label={t('filters.value')}
        maxLength={500}
        autoComplete="off"
        data-testid="adv-filters-value"
      />
    </div>
  );
}

/**
 * Los filtros aplicados, arriba de la tabla: un chip por regla, "O" entre
 * grupos y "Limpiar todo". El texto de un chip abre el panel; su cruz quita esa regla.
 */
export function AdvancedFilterChips({ fields, model, baseQuery, resetKeys }: AdvancedFiltersProps) {
  const t = useTranslations('crm') as unknown as FilterT;
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const byKey = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields]);
  if (countFilterRules(model) === 0) return null;

  const without = (gi: number, ri: number): FilterModel => ({
    v: 1,
    groups: model.groups.map((g, i) => (i !== gi ? g : { rules: g.rules.filter((_, j) => j !== ri) })).filter((g) => g.rules.length > 0),
  });

  return (
    <div className="ui-filter-chips crm-af-chips" role="group" aria-label={t('filters.chips')} data-testid="adv-filters-chips">
      <ul className="ui-filter-chip-list">
        {model.groups.map((group, gi) =>
          group.rules.map((rule, ri) => {
            const field = byKey.get(rule.f);
            if (!field) return null;
            const { op, value } = describeRule(t, field, rule, locale);
            const text = [field.label, op, value].filter(Boolean).join(' ');
            return (
              <li key={`${gi}-${ri}`} className="crm-af-chip-item">
                {gi > 0 && ri === 0 && <span className="crm-af-chip-or">{t('filters.or')}</span>}
                <span className="ui-filter-chip" data-testid="adv-filters-chip">
                  <button
                    type="button"
                    className="ui-filter-chip-text"
                    onClick={() => window.dispatchEvent(new CustomEvent(OPEN_FILTERS_EVENT))}
                    aria-label={t('filters.editChip', { text })}
                    title={text}
                  >
                    <b>{field.label}</b> {op} {value}
                  </button>
                  <button
                    type="button"
                    className="ui-filter-chip-x"
                    onClick={() => router.push(filterHref(pathname, baseQuery, without(gi, ri), resetKeys))}
                    aria-label={t('filters.removeChip', { text })}
                  >
                    <CrmIcon name="x" size={12} />
                  </button>
                </span>
              </li>
            );
          }),
        )}
      </ul>
      <span className="ui-filter-chip-actions">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => router.push(filterHref(pathname, baseQuery, { v: 1, groups: [] }, resetKeys))}
          data-testid="adv-filters-chips-clear"
        >
          {t('filters.clearAll')}
        </button>
      </span>
    </div>
  );
}
