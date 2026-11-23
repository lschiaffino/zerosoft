'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
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
  const [rule, setRule] = useState<DraftRule>(() => draftFor(field, filters));
  const [error, setError] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [placed, setPlaced] = useState(false);
  const active = !!fieldRule(filters.model, field.key);
  const ops = opsOf(field, rule.o);

  useDismiss(true, (reason) => onClose(reason === 'escape'), [ref, anchor]);

  // Debajo del botón del encabezado, dentro de la pantalla; en el teléfono, hoja abajo (CSS).
  useLayoutEffect(() => {
    const place = () => {
      const btn = anchor.current;
      if (!btn || window.matchMedia?.(PHONE).matches) {
        setPos(null);
      } else {
        const r = btn.getBoundingClientRect();
        const w = Math.min(ref.current?.offsetWidth ?? WIDTH, window.innerWidth - 16);
        setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.right - w, window.innerWidth - 8 - w)) });
      }
      setPlaced(true);
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor]);

  // Ya ubicado: el foco va al valor (o al operador si no lleva valor).
  useEffect(() => {
    if (!placed) return;
    const el =
      ref.current?.querySelector<HTMLElement>('[data-testid="adv-filters-value"], .crm-af-options input') ??
      ref.current?.querySelector<HTMLElement>('select');
    el?.focus({ preventScroll: true });
  }, [placed]);

  function go(next: Parameters<typeof filterHref>[2]) {
    onClose(false);
    router.push(filterHref(pathname, filters.baseQuery, next));
  }

  function apply(e: FormEvent) {
    e.preventDefault();
    const cond = toCond(rule, field);
    if (!isRuleComplete(field.type, cond, ops)) {
      setError(true);
      return;
    }
    go(setFieldRule(filters.model, field.key, cond));
  }

  function changeOp(o: string) {
    // Si el operador nuevo lleva otro tipo de valor, lo cargado no sirve.
    const same = opArity(field.type, o) === opArity(field.type, rule.o);
    setRule((r) => (same ? { ...r, o } : { ...r, o, values: [], v2: '', text: '' }));
    setError(false);
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-labelledby={titleId}
      className="record-more-menu th-menu th-filter"
      style={pos ? { top: pos.top, left: pos.left } : placed ? undefined : { visibility: 'hidden' }}
      data-testid={`col-filter-${field.key}`}
    >
      <form className="th-filter-form" onSubmit={apply} noValidate>
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
            setError(false);
          }}
        />
        {error && (
          <p className="crm-af-error" role="alert" data-testid="col-filter-error">
            {t('filters.incomplete')}
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
