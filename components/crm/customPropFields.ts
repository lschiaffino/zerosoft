import type { CrmCustomFieldRow } from '@/lib/schema/types';
import { customFieldHref, fieldOptions, formatCustomFieldValue, groupCustomFields } from '@/lib/crm-custom-fields';
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
  defs: Array<CrmCustomFieldRow & { access?: 'edit' | 'read' | 'hidden' }>,
  custom: Record<string, unknown>,
  labels: CustomFieldLabels,
): PropField[] {
  // Permisos por campo: los ocultos no llegan; los de solo lectura no se editan.
  const shown = defs.filter((d) => d.access !== 'hidden');
  return customPropFieldsAll(shown, custom, labels).map((f, i) => (shown[i]?.access === 'read' ? { ...f, readOnly: true } : f));
}

function customPropFieldsAll(
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
      ...(def.description?.trim() ? { help: def.description.trim() } : {}),
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

/**
 * Tarjetas de la ficha para las propiedades propias: una por grupo de
 * propiedades (como HubSpot), y las que no tienen grupo bajo `fallbackTitle`.
 * Solo con las claves que llegaron a `fields` (los campos ocultos no).
 */
export function customFieldSections(
  defs: Array<Pick<CrmCustomFieldRow, 'name' | 'group_name'>>,
  fields: PropField[],
  fallbackTitle: string,
): Array<{ id: string; title: string; keys: string[] }> {
  const shown = new Set(fields.map((f) => f.key));
  const used = new Set<string>();
  return groupCustomFields(defs)
    .map(({ group, defs: inGroup }) => {
      const base = group ? `custom.${groupSlug(group)}` : 'custom';
      let id = base;
      // "Billing!" y "Billing?" dan el mismo slug: el segundo lleva sufijo.
      for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
      used.add(id);
      return {
        id,
        title: group || fallbackTitle,
        keys: inGroup.map((d) => `custom.${d.name}`).filter((k) => shown.has(k)),
      };
    })
    .filter((s) => s.keys.length > 0);
}

/** Id estable de un grupo (para recordar si su tarjeta está plegada). */
function groupSlug(group: string): string {
  return (
    group
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'group'
  );
}
