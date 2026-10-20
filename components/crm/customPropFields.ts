import type { CrmCustomFieldRow } from '@/lib/schema/types';
import { customFieldHref, fieldOptions, formatCustomFieldValue } from '@/lib/crm-custom-fields';
import type { PropField } from './PropertiesPanel';

interface CustomFieldLabels {
  yes: string;
  no: string;
  /** Para formatear números y monedas (sin el campo: en). */
  locale?: string;
  /** Personas del workspace (tipo user). */
  owners?: Array<{ value: string; label: string }>;
}

/**
 * Mapea las definiciones de custom fields de una entidad a PropFields
 * editables inline en PropertiesPanel (clave `custom.<name>`).
 */
export function customPropFields(
  defs: CrmCustomFieldRow[],
  custom: Record<string, unknown>,
  labels: CustomFieldLabels,
): PropField[] {
  const owners = labels.owners ?? [];
  const ctx = {
    locale: labels.locale ?? 'en',
    yes: labels.yes,
    no: labels.no,
    users: new Map(owners.map((o) => [o.value, o.label])),
  };
  return defs.map((def) => {
    const raw = custom[def.name];
    const base = {
      key: `custom.${def.name}`,
      label: def.label,
    };
    if (def.type === 'boolean') {
      return {
        ...base,
        type: 'select',
        boolean: true,
        nullOption: true,
        value: raw === true || raw === 'true' ? 'true' : raw === false || raw === 'false' ? 'false' : '',
        options: [
          { value: 'true', label: labels.yes },
          { value: 'false', label: labels.no },
        ],
      };
    }
    if (def.type === 'select' || def.type === 'user') {
      const options =
        def.type === 'user' ? owners : fieldOptions(def).map((o) => ({ value: o, label: o }));
      return {
        ...base,
        type: 'select',
        nullOption: true,
        value: raw == null ? '' : String(raw),
        options,
      };
    }
    if (def.type === 'multiselect') {
      const list = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
      return {
        ...base,
        type: 'multiselect',
        value: JSON.stringify(list),
        display: list.join(', '),
        options: fieldOptions(def).map((o) => ({ value: o, label: o })),
      };
    }
    if (def.type === 'number' || def.type === 'currency') {
      return {
        ...base,
        type: 'number',
        value: raw == null ? '' : String(raw),
        display: def.type === 'currency' ? formatCustomFieldValue(def, raw, ctx) || undefined : undefined,
      };
    }
    if (def.type === 'date') {
      return { ...base, type: 'date', value: raw == null ? '' : String(raw) };
    }
    return {
      ...base,
      type: 'text',
      value: raw == null ? '' : String(raw),
      href: customFieldHref(def, raw) ?? undefined,
      inputType: def.type === 'url' ? 'url' : def.type === 'phone' ? 'tel' : undefined,
    };
  });
}
