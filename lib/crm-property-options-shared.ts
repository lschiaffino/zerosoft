/**
 * CRM: opciones editables de Lifecycle stage, Lead status y Deal type (como
 * HubSpot), la parte pura que usan el servidor y el cliente.
 *
 * Cada opción tiene una clave (`value`) que es lo que guardan los registros y
 * no cambia nunca, y un nombre (`label`). Las de fábrica tienen `label` null
 * mientras nadie las renombre: se muestran traducidas. Una archivada no se
 * ofrece para elegir, pero los registros que la tienen la siguen mostrando
 * con su nombre.
 */
import { DEAL_TYPES, LEAD_STATUSES, LIFECYCLE_STAGES } from './crm-constants';

export const OPTION_PROPERTIES = ['lifecycle', 'leadStatus', 'dealType'] as const;
export type OptionProperty = (typeof OPTION_PROPERTIES)[number];

/** Opciones de fábrica de cada propiedad, en su orden. */
export const BUILTIN_OPTIONS: Record<OptionProperty, readonly string[]> = {
  lifecycle: LIFECYCLE_STAGES,
  leadStatus: LEAD_STATUSES,
  dealType: DEAL_TYPES,
};

/** Clave de una opción: la de fábrica o `opt_` + letras y números. */
export const OPTION_VALUE_RE = /^[a-z0-9_]{1,40}$/;
export const MAX_OPTIONS = 40;
export const MAX_OPTION_LABEL = 60;

export interface PropertyOption {
  value: string;
  /** null = el nombre traducido de fábrica. */
  label: string | null;
  archived: boolean;
  builtin: boolean;
}

export type OptionSets = Record<OptionProperty, PropertyOption[]>;

export function defaultOptions(prop: OptionProperty): PropertyOption[] {
  return BUILTIN_OPTIONS[prop].map((value) => ({ value, label: null, archived: false, builtin: true }));
}

export function defaultOptionSets(): OptionSets {
  return { lifecycle: defaultOptions('lifecycle'), leadStatus: defaultOptions('leadStatus'), dealType: defaultOptions('dealType') };
}

export function isOptionProperty(v: unknown): v is OptionProperty {
  return v === 'lifecycle' || v === 'leadStatus' || v === 'dealType';
}

/** La propiedad de las opciones de un campo de registro (`lifecycleStage`, `lifecycle_stage`, …). */
export function optionPropertyOf(field: string): OptionProperty | null {
  if (field === 'lifecycleStage' || field === 'lifecycle_stage' || field === 'lifecycle') return 'lifecycle';
  if (field === 'leadStatus' || field === 'lead_status') return 'leadStatus';
  if (field === 'dealType' || field === 'deal_type') return 'dealType';
  return null;
}

/** Valor por defecto de un alta: el de siempre si sigue activo; si no, la primera opción activa. */
export function defaultOptionValue(options: PropertyOption[], prop: 'lifecycle' | 'leadStatus'): string {
  const preferred = prop === 'lifecycle' ? 'lead' : 'new';
  const active = options.filter((o) => !o.archived);
  return active.find((o) => o.value === preferred)?.value ?? active[0]?.value ?? preferred;
}

/** ¿Se puede guardar este valor? Activo, o el que el registro ya tenía (una archivada se conserva). */
export function isAllowedOption(options: PropertyOption[], value: string, current?: string | null): boolean {
  if (current !== undefined && current !== null && value === current) return true;
  return options.some((o) => o.value === value && !o.archived);
}

/** Posición de un valor en el orden del workspace (-1 si no está). */
export function optionRank(options: PropertyOption[], value: string): number {
  return options.findIndex((o) => o.value === value);
}

export interface LabeledOption {
  value: string;
  label: string;
  archived: boolean;
}

/**
 * Funciones de nombres y opciones para un workspace. `builtinLabel` traduce
 * las de fábrica; `archivedLabel` arma el nombre de una archivada cuando se
 * ofrece junto a las activas (en filtros o como valor actual).
 */
export function optionHelpers(
  sets: OptionSets,
  builtinLabel: (prop: OptionProperty, value: string) => string,
  archivedLabel: (label: string) => string = (l) => l,
) {
  const labelOf = (prop: OptionProperty, o: PropertyOption): string =>
    o.label || (o.builtin || (BUILTIN_OPTIONS[prop] as readonly string[]).includes(o.value) ? builtinLabel(prop, o.value) : o.value);
  /** Nombre de un valor guardado (el valor crudo si no es una opción). */
  const label = (prop: OptionProperty, value: string | null | undefined): string => {
    if (!value) return '';
    const o = sets[prop].find((x) => x.value === value);
    if (o) return labelOf(prop, o);
    return (BUILTIN_OPTIONS[prop] as readonly string[]).includes(value) ? builtinLabel(prop, value) : value;
  };
  return {
    label,
    /**
     * Para elegir: las activas en orden y, si el registro tiene una archivada
     * (o un valor que ya no es opción), esa al final, para no perderla.
     */
    choices(prop: OptionProperty, current?: string | null): LabeledOption[] {
      const out = sets[prop].filter((o) => !o.archived).map((o) => ({ value: o.value, label: labelOf(prop, o), archived: false }));
      if (current && !out.some((o) => o.value === current)) {
        const o = sets[prop].find((x) => x.value === current);
        const base = o ? labelOf(prop, o) : label(prop, current);
        out.push({ value: current, label: archivedLabel(base), archived: true });
      }
      return out;
    },
    /** Para filtrar y reportar: todas, las archivadas marcadas y al final. */
    all(prop: OptionProperty): LabeledOption[] {
      const active = sets[prop].filter((o) => !o.archived).map((o) => ({ value: o.value, label: labelOf(prop, o), archived: false }));
      const archived = sets[prop].filter((o) => o.archived).map((o) => ({ value: o.value, label: archivedLabel(labelOf(prop, o)), archived: true }));
      return [...active, ...archived];
    },
    /** value → nombre de todas (historial, reportes). */
    labelMap(prop: OptionProperty): Record<string, string> {
      return Object.fromEntries(sets[prop].map((o) => [o.value, labelOf(prop, o)]));
    },
    values(prop: OptionProperty): string[] {
      return sets[prop].map((o) => o.value);
    },
  };
}

export type OptionHelpers = ReturnType<typeof optionHelpers>;

/**
 * Busca la opción de un texto de afuera (importador, HubSpot): por clave o por
 * nombre propio, sin mayúsculas. null si no hay ninguna.
 */
export function matchOption(options: PropertyOption[], raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  const byValue = options.find((o) => o.value === v);
  if (byValue) return byValue.value;
  const byLabel = options.find((o) => o.label && o.label.trim().toLowerCase() === v);
  return byLabel ? byLabel.value : null;
}
