'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type FormEvent, type KeyboardEvent, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { useDismiss } from '@/components/groups/wa/useDismiss';
import { DEFAULT_FILTER_OP, fieldRule, isRuleComplete, opArity, setFieldRule } from '@/lib/crm-filter-model';
import { ValueEditor, opsOf, toCond, type DraftRule } from './AdvancedFilters';
import type { AdvFilterField } from './advancedFilterFields';
import { filterHref, type FilterT } from './advancedFilterText';
import type { ColumnFilters } from './EditColumns';

/** Ancho de teléfono: el filtro se abre como una hoja abajo, de borde a borde (styles/crm-list-hs.css). */
const PHONE = '(max-width: 640px)';
const WIDTH = 300;

function draftFor(field: AdvFilterField, filters: ColumnFilters): DraftRule {
  const rule = fieldRule(filters.model, field.key);
  if (rule) {
    return {
      id: 0,
      f: field.key,
      o: rule.o,
      values: Array.isArray(rule.v) ? [...rule.v] : rule.v === undefined ? [] : [rule.v],
      v2: rule.v2 ?? '',
      text: '',
      picking: false,
    };
  }
  const ops = opsOf(field);
  const o = ops.includes(DEFAULT_FILTER_OP[field.type]) ? DEFAULT_FILTER_OP[field.type] : ops[0];
  return { id: 0, f: field.key, o, values: [], v2: '', text: '', picking: false };
}

/**
 * "Filtrar por esta columna", desde el menú del encabezado (como en HubSpot):
 * el operador y el valor según el tipo de la propiedad (texto, número, fecha,
 * opciones, owner, sí o no, con valor o sin valor). Aplicar deja la regla en
 * el filtro avanzado del listado (`filters` en la URL), que se ve como chip
 * arriba de la tabla, se guarda con la vista y es el mismo que usan
 * "Seleccionar todos los que coinciden" y "Exportar la vista". Quitar saca la
 * regla de la columna. Esc y un clic afuera cierran sin aplicar.
 */
export default function ColumnFilter({
  field,
  label,
  filters,
  anchor,
  onClose,
}: {
  field: AdvFilterField;
  label: string;
  filters: ColumnFilters;
  /** El botón del menú de la columna: el filtro se abre debajo y el foco vuelve ahí con Esc. */
  anchor: RefObject<HTMLButtonElement | null>;
  onClose: (refocus: boolean) => void;
}) {
  const t = useTranslations('crm') as unknown as FilterT;
  const tc = useTranslations('crm.columnMenu');
  const router = useRouter();
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const errorId = useId();
  const [rule, setRule] = useState<DraftRule>(() => draftFor(field, filters));
  const [error, setError] = useState<'incomplete' | 'full' | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [placed, setPlaced] = useState(false);
  const active = !!fieldRule(filters.model, field.key);
  const ops = opsOf(field, rule.o);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useDismiss(true, (reason) => onClose(reason === 'escape'), [ref, anchor]);

  // Debajo del botón del encabezado (o arriba si abajo no entra), dentro de la pantalla; en el
  // teléfono, hoja abajo (CSS). Si la página o la tabla se desplazan, se cierra (como el menú).
  useLayoutEffect(() => {
    const place = () => {
      const btn = anchor.current;
      if (!btn || window.matchMedia?.(PHONE).matches) {
        setPos(null);
      } else {
        const r = btn.getBoundingClientRect();
        const w = Math.min(ref.current?.offsetWidth ?? WIDTH, window.innerWidth - 16);
        const h = ref.current?.offsetHeight ?? 0;
        const below = r.bottom + 4;
        const top = below + h > window.innerHeight - 8 && r.top - 4 - h >= 8 ? r.top - 4 - h : below;
        setPos({ top, left: Math.max(8, Math.min(r.right - w, window.innerWidth - 8 - w)) });
      }
      setPlaced(true);
    };
    place();
    const onScroll = (e: Event) => {
      // En el teléfono es una hoja fija (y abrir el teclado desplaza la página): no se cierra.
      if (window.matchMedia?.(PHONE).matches) return;
      if (e.target instanceof Node && ref.current?.contains(e.target)) return;
      closeRef.current(false);
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [anchor]);

  // Ya ubicado: el foco va al valor (o al operador si no lleva valor).
  useEffect(() => {
    if (!placed) return;
    const el =
      ref.current?.querySelector<HTMLElement>('[data-testid="adv-filters-value"], .crm-af-options input') ??
      ref.current?.querySelector<HTMLElement>('select');
    el?.focus({ preventScroll: true });
  }, [placed]);

  function go(next: Parameters<typeof filterHref>[2] | null) {
    if (!next) {
      setError('full');
      return;
    }
    // El foco vuelve al botón de la columna (la tabla se vuelve a dibujar con el filtro).
    onClose(true);
    router.push(filterHref(pathname, filters.baseQuery, next));
  }

  function apply(e: FormEvent) {
    e.preventDefault();
    const cond = toCond(rule, field);
    if (!isRuleComplete(field.type, cond, ops)) {
      setError('incomplete');
      return;
    }
    go(setFieldRule(filters.model, field.key, cond));
  }

  // Enter en el texto aplica de una (en Filtros avanzados, el primer Enter suma el valor a la lista).
  function onKeyDownCapture(e: KeyboardEvent<HTMLFormElement>) {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    const target = e.target as HTMLElement;
    if (target instanceof HTMLInputElement && target.type === 'text' && target.dataset.testid === 'adv-filters-value') {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.requestSubmit();
    }
  }

  // El foco sale del filtro (Tab): se cierra, sin aplicar. Un selector nativo abierto no cuenta.
  function onBlur(e: FocusEvent<HTMLDivElement>) {
    const next = e.relatedTarget;
    if (next instanceof Node && !e.currentTarget.contains(next) && next !== anchor.current) onClose(false);
  }

  function changeOp(o: string) {
    // Si el operador nuevo lleva otro tipo de valor, lo cargado no sirve.
    const same = opArity(field.type, o) === opArity(field.type, rule.o);
    setRule((r) => (same ? { ...r, o } : { ...r, o, values: [], v2: '', text: '' }));
    setError(null);
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={error ? errorId : undefined}
      className="record-more-menu th-menu th-filter"
      style={pos ? { top: pos.top, left: pos.left } : placed ? undefined : { visibility: 'hidden' }}
      onBlur={onBlur}
      data-testid={`col-filter-${field.key}`}
    >
      <form className="th-filter-form" onSubmit={apply} onKeyDownCapture={onKeyDownCapture} noValidate>
        <p className="th-filter-title" id={titleId}>
          {tc('filterTitle', { name: label })}
        </p>
        <select className="select th-filter-op" value={rule.o} onChange={(e) => changeOp(e.target.value)} aria-label={t('filters.operator')} data-testid="col-filter-op">
          {ops.map((op) => (
            <option key={op} value={op}>
              {t(`filters.opLabel.${op}`)}
            </option>
          ))}
        </select>
        <ValueEditor
          t={t}
          field={field}
          rule={rule}
          onChange={(patch) => {
            setRule((r) => ({ ...r, ...patch }));
            setError(null);
          }}
        />
        {error && (
          <p className="crm-af-error" role="alert" id={errorId} data-testid="col-filter-error">
            {error === 'full' ? tc('groupFull') : t('filters.incomplete')}
          </p>
        )}
        <div className="th-filter-foot">
          {active && (
            <button type="button" className="btn btn-ghost btn-sm th-filter-clear" onClick={() => go(setFieldRule(filters.model, field.key, null))} data-testid="col-filter-clear">
              {tc('clearFilter')}
            </button>
          )}
          <button type="button" className="btn btn-sm" onClick={() => onClose(true)}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary btn-sm" data-testid="col-filter-apply">
            {tc('applyFilter')}
          </button>
        </div>
      </form>
    </div>
  );
}
