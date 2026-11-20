import {
  DATE_DAYS_OPS,
  opArity,
  parseDays,
  ruleValues,
  serializeFilterModel,
  type FilterCond,
  type FilterModel,
} from '@/lib/crm-filter-model';
import type { AdvFilterField } from './advancedFilterFields';

/** `t` de next-intl para el namespace `crm` (con valores para los mensajes con variables). */
export type FilterT = (key: string, values?: Record<string, string | number>) => string;

/** Cuántos valores se nombran en un chip antes de resumir ("y 3 más"). */
const CHIP_VALUES = 2;

function formatDay(day: string, locale: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return day;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(d);
}

/**
 * Una regla en palabras, para su chip: el operador ("es alguno de") y el valor
 * ("Lead, Cliente"). El nombre de la propiedad lo pone quien dibuja.
 */
export function describeRule(t: FilterT, field: AdvFilterField, rule: FilterCond, locale: string): { op: string; value: string } {
  const values = ruleValues(rule);
  const arity = opArity(field.type, rule.o);
  if (arity === 'days' && (DATE_DAYS_OPS as readonly string[]).includes(rule.o)) {
    return { op: t(`filters.daysText.${rule.o}`, { count: parseDays(values[0] ?? '') ?? 0 }), value: '' };
  }
  const op = t(`filters.opLabel.${rule.o}`);
  if (arity === 'none') return { op, value: '' };
  const show = (v: string) => (field.type === 'date' ? formatDay(v, locale) : v);
  if (arity === 'two') {
    return { op, value: t('filters.betweenValues', { from: show(values[0] ?? ''), to: show((rule.v2 ?? '').trim()) }) };
  }
  if (field.type === 'boolean') {
    return { op, value: values[0] === '1' || values[0] === 'true' ? t('filters.yes') : t('filters.no') };
  }
  const labels = values.map((v) => {
    if (!field.options) return show(v);
    return field.options.find((o) => o.value === v)?.label ?? t('filters.missingValue');
  });
  if (labels.length <= CHIP_VALUES + 1) return { op, value: labels.join(', ') };
  return {
    op,
    value: t('filters.moreValues', { shown: labels.slice(0, CHIP_VALUES).join(', '), count: labels.length - CHIP_VALUES }),
  };
}

/** La URL del listado con este filtro: conserva lo demás (búsqueda, orden, pipeline) y vuelve a la página 1. */
export function filterHref(pathname: string, baseQuery: Record<string, string>, model: FilterModel, resetKeys: readonly string[] = []): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(baseQuery)) {
    // resetKeys: una vista guardada trae sus propios filtros; al cambiarlos a mano se sale de la vista.
    if (value && key !== 'filters' && key !== 'page' && !resetKeys.includes(key)) params.set(key, value);
  }
  const filters = serializeFilterModel(model);
  if (filters) params.set('filters', filters);
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/** Evento con el que un chip le pide al panel que se abra. */
export const OPEN_FILTERS_EVENT = 'crm:open-advanced-filters';
