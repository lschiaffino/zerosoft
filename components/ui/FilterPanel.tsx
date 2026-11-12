'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import {
  DATE_PRESETS,
  bestField,
  cleanDateValue,
  cleanValues,
  countActive,
  fieldCount,
  matchFields,
  matchOptions,
  type DateValue,
  type FilterCategory,
  type FilterChip,
  type FilterField,
  type FilterOption,
  type FilterValue,
  type FilterValues,
  type TextValue,
} from '@/lib/filter-panel';

/**
 * Panel de filtros: una caja flotante de dos paneles, anclada debajo de la
 * barra desde la que se abre. A la izquierda, los campos agrupados por
 * categoría (con buscador); a la derecha, el editor del campo elegido según su
 * tipo (varias opciones, fecha, sí o no, texto, o uno propio de la app).
 *
 * - Lo que se toca es un borrador: vale al tocar "Aplicar". Cerrar, Esc o un
 *   clic afuera lo descartan.
 * - Teclado: flechas en la lista de campos, Tab recorre el panel sin salir,
 *   Enter en un campo de texto o una casilla aplica, Esc cierra y el foco
 *   vuelve al botón que lo abrió.
 * - En el teléfono es una hoja a pantalla completa en dos pasos: la lista de
 *   campos y, al elegir uno, su editor con "Volver".
 * - Es un <dialog> modal: queda arriba de todo y lo de atrás no recibe foco ni clics.
 *
 * No sabe nada de la app que lo usa: recibe los campos (lib/filter-panel.ts)
 * y devuelve los valores.
 */

const SHEET_QUERY = '(max-width: 640px)';
const PANEL_WIDTH = 900;
const MARGIN = 16;
/** Con más opciones que estas, el editor ofrece un buscador de opciones. */
const OPTION_SEARCH_FROM = 7;

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

function placePanel(anchor: DOMRect, vw: number, vh: number): Box {
  const left = Math.max(MARGIN, Math.min(anchor.left, vw - MARGIN - 560));
  const width = Math.min(PANEL_WIDTH, vw - left - MARGIN);
  let top = anchor.bottom + 6;
  const want = Math.round(vh * 0.7);
  let height = Math.min(want, vh - top - MARGIN);
  // Poco lugar debajo de la barra: sube lo necesario para que entre un panel usable.
  if (height < 380) {
    height = Math.min(Math.max(380, height), vh - 2 * MARGIN);
    top = Math.max(MARGIN, vh - MARGIN - height);
  }
  return { left, top, width, height };
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '')).toUpperCase() || '?';
}

export interface FilterPanelProps {
  open: boolean;
  /** Nombre del panel para lectores de pantalla ("Filtros"). */
  title: string;
  /** Debajo de qué se ancla (la barra de búsqueda). */
  anchorRef: RefObject<HTMLElement | null>;
  /** A dónde vuelve el foco al cerrar (el botón que lo abre). */
  returnFocusRef?: RefObject<HTMLElement | null>;
  categories: FilterCategory[];
  fields: FilterField[];
  values: FilterValues;
  /** El campo que se muestra al abrir (por defecto, el primero con algo puesto). */
  initialField?: string | null;
  onApply: (values: FilterValues) => void;
  onClose: () => void;
  /** El editor de un campo `custom`. */
  renderCustom?: (field: FilterField, value: unknown, onChange: (next: unknown) => void) => ReactNode;
  /** Una acción más en el pie, sobre lo que hay en el panel ("Guardar como lista"). */
  extraAction?: { label: string; onClick: (values: FilterValues) => void };
}

export default function FilterPanel(props: FilterPanelProps) {
  // Montado solo abierto: cada apertura arranca del valor aplicado (el borrador anterior se descarta).
  if (!props.open) return null;
  return <OpenPanel {...props} />;
}

function OpenPanel({ title, anchorRef, returnFocusRef, categories, fields, values, initialField, onApply, onClose, renderCustom, extraAction }: FilterPanelProps) {
  const t = useTranslations('common.ui.filter');
  const [draft, setDraft] = useState<FilterValues>(() => ({ ...values }));
  const [fieldQuery, setFieldQuery] = useState('');
  const firstActive = fields.find((f) => fieldCount(f, values[f.id]) > 0)?.id;
  const [selected, setSelected] = useState<string>((initialField && fields.some((f) => f.id === initialField) ? initialField : null) ?? firstActive ?? fields[0]?.id ?? '');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // En el teléfono, abrir desde un chip va directo al editor de ese campo.
  const [step, setStep] = useState<'fields' | 'editor'>(initialField ? 'editor' : 'fields');
  const [sheet, setSheet] = useState(false);
  const [box, setBox] = useState<Box | null>(null);
  const panelRef = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const editorTitleId = useId();

  const visible = useMemo(() => matchFields(fields, categories, fieldQuery), [fields, categories, fieldQuery]);
  const searching = fieldQuery.trim() !== '';
  const groups = useMemo(
    () => categories.map((c) => ({ category: c, fields: visible.filter((f) => f.category === c.id) })).filter((g) => g.fields.length > 0),
    [categories, visible],
  );
  // Los campos por los que pasan las flechas: los de categorías abiertas (al buscar, todas).
  const reachable = useMemo(() => groups.flatMap((g) => (searching || !collapsed.has(g.category.id) ? g.fields : [])), [groups, collapsed, searching]);
  const field = fields.find((f) => f.id === selected) ?? null;
  const fieldCategory = field ? (categories.find((c) => c.id === field.category)?.label ?? '') : '';
  const active = countActive(fields, draft);

  // Dónde va: debajo del ancla en escritorio; a pantalla completa en el teléfono.
  useLayoutEffect(() => {
    const mq = window.matchMedia(SHEET_QUERY);
    const place = () => {
      setSheet(mq.matches);
      const el = anchorRef.current;
      if (el) setBox(placePanel(el.getBoundingClientRect(), window.innerWidth, window.innerHeight));
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchorRef]);

  // Se abre como modal. El foco entra al buscador (en el teléfono al panel: el buscador abriría el teclado) y, al cerrar, vuelve al botón.
  useLayoutEffect(() => {
    const d = panelRef.current;
    if (!d) return;
    const back = returnFocusRef?.current ?? (document.activeElement as HTMLElement | null);
    if (!d.open) d.showModal();
    if (window.matchMedia(SHEET_QUERY).matches) d.focus();
    else searchRef.current?.focus();
    return () => {
      if (d.open) d.close();
      back?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setValue = useCallback((id: string, value: FilterValue | undefined) => {
    setDraft((d) => {
      const next = { ...d };
      if (value === undefined) delete next[id];
      else next[id] = value;
      return next;
    });
  }, []);

  const apply = useCallback(() => onApply(cleanValues(fields, draft)), [onApply, fields, draft]);

  function pick(id: string, viaClick: boolean) {
    setSelected(id);
    if (viaClick && sheet) {
      setStep('editor');
      requestAnimationFrame(() => backRef.current?.focus());
    }
  }

  function focusField(id: string) {
    panelRef.current?.querySelector<HTMLButtonElement>(`[data-field="${CSS.escape(id)}"]`)?.focus();
  }

  function onListKey(e: ReactKeyboardEvent) {
    const i = reachable.findIndex((f) => f.id === selected);
    let next: FilterField | undefined;
    if (e.key === 'ArrowDown') next = reachable[Math.min(reachable.length - 1, i + 1)] ?? reachable[0];
    else if (e.key === 'ArrowUp') {
      if (i <= 0) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      next = reachable[i - 1];
    } else if (e.key === 'Home') next = reachable[0];
    else if (e.key === 'End') next = reachable[reachable.length - 1];
    else if (e.key === 'ArrowRight' && !sheet) {
      e.preventDefault();
      editorRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
      return;
    } else return;
    e.preventDefault();
    if (next) {
      pick(next.id, false);
      focusField(next.id);
    }
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLDialogElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === 'Enter') {
      const el = e.target as HTMLElement;
      const isText = el instanceof HTMLInputElement && el.type !== 'button' && el.type !== 'submit';
      // Enter en una caja de texto o una casilla aplica; en un botón hace lo del botón. Ctrl o Cmd + Enter aplica desde cualquier lado.
      if (e.metaKey || e.ctrlKey || (isText && !el.hasAttribute('data-no-apply'))) {
        e.preventDefault();
        apply();
      }
      return;
    }
    if (e.key !== 'Tab') return;
    // El foco no sale del panel.
    const items = [...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((el) => el.offsetParent !== null);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const at = document.activeElement;
    if (e.shiftKey && (at === first || at === panelRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && at === last) {
      e.preventDefault();
      first.focus();
    }
  }

  const style = sheet || !box ? undefined : { left: box.left, top: box.top, width: box.width, height: box.height };

  return (
    <dialog
      ref={panelRef}
      className={`ui-filter-panel${sheet ? ' is-sheet' : ''}`}
      aria-labelledby={titleId}
      data-step={step}
      data-voice-off
      data-testid="filter-panel"
      tabIndex={-1}
      style={style}
      onKeyDown={onKeyDown}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onPointerDown={(e) => {
        // Un clic afuera (en el telón del diálogo) descarta el borrador.
        if (e.target !== e.currentTarget) return;
        const r = e.currentTarget.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose();
      }}
    >
      <header className="ui-filter-head">
        {sheet && step === 'editor' ? (
          <button
            ref={backRef}
            type="button"
            className="btn btn-ghost btn-sm ui-filter-back"
            onClick={() => {
              setStep('fields');
              requestAnimationFrame(() => focusField(selected));
            }}
          >
            <span aria-hidden="true">←</span> {t('back')}
          </button>
        ) : null}
        <h2 className="ui-filter-title" id={titleId}>
          {title}
        </h2>
        {active > 0 && <span className="ui-filter-total">{t('active', { n: active })}</span>}
      </header>
      <div className="ui-filter-body">
        <div className="ui-filter-fields">
          <input
            ref={searchRef}
            className="input ui-filter-search"
            type="search"
            value={fieldQuery}
            onChange={(e) => setFieldQuery(e.target.value)}
            placeholder={t('searchFields')}
            aria-label={t('searchFields')}
            data-no-apply
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' && reachable.length > 0) {
                e.preventDefault();
                const to = reachable.find((f) => f.id === selected) ?? reachable[0];
                pick(to.id, false);
                focusField(to.id);
              } else if (e.key === 'Enter') {
                // Con algo buscado, Enter abre el primer campo que coincide; sin nada, aplica.
                e.preventDefault();
                const best = searching ? bestField(visible, fieldQuery) : undefined;
                if (best) {
                  pick(best.id, true);
                  if (!sheet) requestAnimationFrame(() => editorRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus());
                } else if (!searching) apply();
              }
            }}
          />
          <nav className="ui-filter-list" aria-label={t('fields')} onKeyDown={onListKey}>
            {groups.length === 0 && <p className="ui-filter-empty">{t('noFields')}</p>}
            {groups.map((g) => {
              const openCat = searching || !collapsed.has(g.category.id);
              const groupId = `${titleId}-${g.category.id}`;
              const inGroup = g.fields.reduce((n, f) => n + (fieldCount(f, draft[f.id]) > 0 ? 1 : 0), 0);
              return (
                <div key={g.category.id} className="ui-filter-group">
                  <button
                    type="button"
                    className="ui-filter-cat"
                    aria-expanded={openCat}
                    aria-controls={groupId}
                    disabled={searching}
                    onClick={() =>
                      setCollapsed((prev) => {
                        const next = new Set(prev);
                        if (next.has(g.category.id)) next.delete(g.category.id);
                        else next.add(g.category.id);
                        return next;
                      })
                    }
                  >
                    <svg className="ui-filter-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m9 6 6 6-6 6" />
                    </svg>
                    <span className="ui-filter-cat-name">{g.category.label}</span>
                    {!openCat && inGroup > 0 && (
                      <span className="ui-filter-mark" aria-label={t('active', { n: inGroup })}>
                        {inGroup}
                      </span>
                    )}
                  </button>
                  {openCat && (
                    <ul id={groupId} className="ui-filter-items" role="list">
                      {g.fields.map((f) => {
                        const n = fieldCount(f, draft[f.id]);
                        const on = f.id === selected;
                        return (
                          <li key={f.id}>
                            <button
                              type="button"
                              className={`ui-filter-item${on ? ' is-on' : ''}`}
                              data-field={f.id}
                              aria-current={on ? 'true' : undefined}
                              tabIndex={on || (!reachable.some((r) => r.id === selected) && reachable[0]?.id === f.id) ? 0 : -1}
                              onClick={() => pick(f.id, true)}
                            >
                              <span className="ui-filter-item-name">{f.label}</span>
                              {n > 0 && (
                                <span className="ui-filter-mark">
                                  <span aria-hidden="true">{f.type === 'multi' ? n : '•'}</span>
                                  <span className="sr-only">{f.type === 'multi' ? t('selected', { n }) : t('set')}</span>
                                </span>
                              )}
                              <svg className="ui-filter-go" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="m9 6 6 6-6 6" />
                              </svg>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </nav>
        </div>
        <section ref={editorRef} className="ui-filter-editor" aria-labelledby={field ? editorTitleId : undefined}>
          {field ? (
            <>
              <div className="ui-filter-editor-head">
                <div className="ui-filter-editor-names">
                  <p className="ui-filter-crumb">{fieldCategory}</p>
                  <h3 className="ui-filter-field-title" id={editorTitleId}>
                    {field.label}
                  </h3>
                </div>
                {fieldCount(field, draft[field.id]) > 0 && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setValue(field.id, undefined)}>
                    {t('clearField')}
                  </button>
                )}
              </div>
              {field.help && <p className="ui-help ui-filter-help">{field.help}</p>}
              {field.type === 'multi' && <MultiEditor key={field.id} field={field} value={draft[field.id]} onChange={(v) => setValue(field.id, v)} />}
              {field.type === 'date' && <DateEditor key={field.id} label={field.label} value={draft[field.id]} onChange={(v) => setValue(field.id, v)} />}
              {field.type === 'bool' && <BoolEditor field={field} value={draft[field.id]} onChange={(v) => setValue(field.id, v)} />}
              {field.type === 'text' && <TextEditor key={field.id} label={field.label} value={draft[field.id]} onChange={(v) => setValue(field.id, v)} />}
              {field.type === 'custom' && <div className="ui-filter-custom">{renderCustom?.(field, draft[field.id], (v) => setValue(field.id, v))}</div>}
            </>
          ) : (
            <p className="ui-filter-empty">{t('noFields')}</p>
          )}
        </section>
      </div>
      <footer className="ui-filter-foot">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          {t('close')}
        </button>
        {extraAction && (
          <button type="button" className="btn btn-ghost btn-sm ui-filter-extra" onClick={() => extraAction.onClick(cleanValues(fields, draft))}>
            {extraAction.label}
          </button>
        )}
        <span className="ui-filter-foot-gap" />
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDraft({})} disabled={active === 0}>
          {t('reset')}
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={apply}>
          {t('apply')}
        </button>
      </footer>
    </dialog>
  );
}

function OptionRow({ option, checked, onToggle }: { option: FilterOption; checked: boolean; onToggle: () => void }) {
  return (
    <label className={`ui-check ui-filter-option${option.special ? ' is-special' : ''}`}>
      <input type="checkbox" checked={checked} onChange={onToggle} />
      {option.avatar && (
        <span className="ui-filter-avatar" aria-hidden="true">
          {initialsOf(typeof option.avatar === 'string' ? option.avatar : option.label)}
        </span>
      )}
      {option.color && <i className="ui-filter-dot" style={{ background: option.color }} aria-hidden="true" />}
      <span className="ui-filter-option-name">{option.label}</span>
      {option.hint && <span className="ui-filter-option-hint">{option.hint}</span>}
    </label>
  );
}

function MultiEditor({ field, value, onChange }: { field: Extract<FilterField, { type: 'multi' }>; value: FilterValue | undefined; onChange: (v: string[] | undefined) => void }) {
  const t = useTranslations('common.ui.filter');
  const [query, setQuery] = useState('');
  const picked = useMemo(() => new Set(Array.isArray(value) ? (value as string[]) : []), [value]);
  const shown = useMemo(() => matchOptions(field.options, query), [field.options, query]);
  const allRef = useRef<HTMLInputElement>(null);
  const shownOn = shown.filter((o) => picked.has(o.id)).length;
  const all = shown.length > 0 && shownOn === shown.length;
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = shownOn > 0 && !all;
  }, [shownOn, all]);
  // Lo elegido que no está entre las opciones (algo borrado, o que esta persona no ve): se puede sacar, sin mostrar qué es.
  const known = new Set(field.options.map((o) => o.id));
  const missing = [...picked].filter((id) => !known.has(id));

  const commit = (next: Set<string>) => onChange(next.size ? field.options.map((o) => o.id).filter((id) => next.has(id)).concat([...next].filter((id) => !known.has(id))) : undefined);
  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    commit(next);
  };
  const toggleAll = () => {
    const next = new Set(picked);
    for (const o of shown) {
      if (all) next.delete(o.id);
      else next.add(o.id);
    }
    commit(next);
  };

  if (field.options.length === 0 && missing.length === 0) return <p className="ui-filter-empty">{t('noOptions')}</p>;
  return (
    <div className="ui-filter-multi">
      {field.options.length >= OPTION_SEARCH_FROM && (
        <input className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('searchOptions')} aria-label={t('searchOptionsOf', { field: field.label })} />
      )}
      <div className="ui-filter-all">
        <label className="ui-check">
          <input ref={allRef} type="checkbox" checked={all} onChange={toggleAll} disabled={shown.length === 0} />
          <span>{t('selectAll', { n: shown.length })}</span>
        </label>
        <span className="ui-filter-count" aria-live="polite">
          {t('selected', { n: picked.size })}
        </span>
      </div>
      <div className="ui-filter-options" role="group" aria-label={field.label}>
        {shown.length === 0 && <p className="ui-filter-empty">{t('noOptionsMatch')}</p>}
        {shown.map((o) => (
          <OptionRow key={o.id} option={o} checked={picked.has(o.id)} onToggle={() => toggle(o.id)} />
        ))}
        {missing.length > 0 && !query && (
          <label className="ui-check ui-filter-option is-special">
            <input type="checkbox" checked onChange={() => commit(new Set([...picked].filter((id) => known.has(id))))} />
            <span className="ui-filter-option-name">{t('unavailable', { n: missing.length })}</span>
          </label>
        )}
      </div>
    </div>
  );
}

function DateEditor({ label, value, onChange }: { label: string; value: FilterValue | undefined; onChange: (v: DateValue | undefined) => void }) {
  const t = useTranslations('common.ui.filter');
  const v = cleanDateValue(value);
  const preset = v && 'preset' in v ? v.preset : null;
  const range = v && !('preset' in v) ? v : {};
  const setRange = (patch: { from?: string; to?: string }) => {
    const next = { ...range, ...patch };
    onChange(cleanDateValue(next));
  };
  return (
    <div className="ui-filter-date">
      <div className="ui-filter-presets" role="group" aria-label={label}>
        {DATE_PRESETS.map((p) => (
          <button key={p} type="button" className="btn btn-secondary btn-sm" aria-pressed={preset === p} onClick={() => onChange({ preset: p })}>
            {t(`presets.${p}`)}
          </button>
        ))}
        <button type="button" className="btn btn-secondary btn-sm" aria-pressed={!v} onClick={() => onChange(undefined)}>
          {t('presets.all')}
        </button>
      </div>
      <div className="ui-filter-range">
        <label className="ui-field">
          <span className="label">{t('startDate')}</span>
          <input className="input" type="date" value={range.from ?? ''} max={range.to} onChange={(e) => setRange({ from: e.target.value || undefined })} />
        </label>
        <label className="ui-field">
          <span className="label">{t('endDate')}</span>
          <input className="input" type="date" value={range.to ?? ''} min={range.from} onChange={(e) => setRange({ to: e.target.value || undefined })} />
        </label>
      </div>
    </div>
  );
}

function BoolEditor({ field, value, onChange }: { field: Extract<FilterField, { type: 'bool' }>; value: FilterValue | undefined; onChange: (v: 'yes' | 'no' | undefined) => void }) {
  const t = useTranslations('common.ui.filter');
  const current = value === 'yes' || value === 'no' ? value : undefined;
  const choices: Array<{ id: 'yes' | 'no' | undefined; label: string }> = [
    { id: undefined, label: t('any') },
    { id: 'yes', label: field.yes ?? t('yes') },
    { id: 'no', label: field.no ?? t('no') },
  ];
  return (
    <div className="btn-group ui-filter-tri" role="group" aria-label={field.label}>
      {choices.map((c) => (
        <button key={c.id ?? 'any'} type="button" className="btn btn-secondary btn-sm" aria-pressed={current === c.id} onClick={() => onChange(c.id)}>
          {c.label}
        </button>
      ))}
    </div>
  );
}

function TextEditor({ label, value, onChange }: { label: string; value: FilterValue | undefined; onChange: (v: TextValue | undefined) => void }) {
  const t = useTranslations('common.ui.filter');
  const raw = value && typeof value === 'object' ? (value as { mode?: string; value?: string }) : {};
  const mode = raw.mode === 'is' || raw.mode === 'set' || raw.mode === 'unset' ? raw.mode : 'any';
  const inputRef = useRef<HTMLInputElement>(null);
  const choices: Array<{ id: 'any' | 'is' | 'set' | 'unset'; label: string }> = [
    { id: 'any', label: t('any') },
    { id: 'is', label: t('isExactly') },
    { id: 'set', label: t('hasValue') },
    { id: 'unset', label: t('noValue') },
  ];
  return (
    <div className="ui-filter-text">
      <div className="btn-group ui-filter-tri" role="group" aria-label={label}>
        {choices.map((c) => (
          <button
            key={c.id}
            type="button"
            className="btn btn-secondary btn-sm"
            aria-pressed={mode === c.id}
            onClick={() => {
              if (c.id === 'any') onChange(undefined);
              else if (c.id === 'is') {
                // El texto vacío todavía no filtra: queda elegido el modo y se escribe el valor.
                onChange({ mode: 'is', value: raw.value ?? '' });
                requestAnimationFrame(() => inputRef.current?.focus());
              } else onChange({ mode: c.id });
            }}
          >
            {c.label}
          </button>
        ))}
      </div>
      {mode === 'is' && (
        <label className="ui-field">
          <span className="label">{t('value')}</span>
          <input ref={inputRef} className="input" value={raw.value ?? ''} maxLength={200} onChange={(e) => onChange({ mode: 'is', value: e.target.value })} />
        </label>
      )}
    </div>
  );
}

/**
 * Los filtros aplicados, a la vista sin abrir el panel: un chip por campo
 * ("Asignado a: Ana, Luis") que se saca con su ×, y "Limpiar" para todos.
 */
export function FilterChips({ chips, onRemove, onClear, onOpen, children }: { chips: FilterChip[]; onRemove: (id: string) => void; onClear: () => void; onOpen?: (id: string) => void; children?: ReactNode }) {
  const t = useTranslations('common.ui.filter');
  if (chips.length === 0) return null;
  return (
    <div className="ui-filter-chips" role="group" aria-label={t('applied')} data-testid="filter-chips">
      <ul className="ui-filter-chip-list" role="list">
        {chips.map((c) => (
          <li key={c.id} className="ui-filter-chip" data-chip={c.id}>
            {onOpen ? (
              <button type="button" className="ui-filter-chip-text" onClick={() => onOpen(c.id)} title={`${c.label}: ${c.text}`}>
                <b>{c.label}:</b> {c.text}
              </button>
            ) : (
              <span className="ui-filter-chip-text" title={`${c.label}: ${c.text}`}>
                <b>{c.label}:</b> {c.text}
              </span>
            )}
            <button type="button" className="ui-filter-chip-x" onClick={() => onRemove(c.id)} aria-label={t('removeChip', { label: c.label })}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </li>
        ))}
      </ul>
      <div className="ui-filter-chip-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>
          {t('clear')}
        </button>
        {children}
      </div>
    </div>
  );
}
