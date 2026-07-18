import type { CrmCustomFieldRow } from '@/lib/db';
import type { PropField } from './PropertiesPanel';

interface CustomFieldLabels {
  yes: string;
  no: string;
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
    if (def.type === 'select') {
      let options: string[] = [];
      try {
        const parsed: unknown = JSON.parse(def.options);
        if (Array.isArray(parsed)) options = parsed.filter((o): o is string => typeof o === 'string');
      } catch {
        options = [];
      }
      return {
        ...base,
        type: 'select',
        nullOption: true,
        value: raw == null ? '' : String(raw),
        options: options.map((o) => ({ value: o, label: o })),
      };
    }
    if (def.type === 'number' || def.type === 'date') {
      return { ...base, type: def.type, value: raw == null ? '' : String(raw) };
    }
    return { ...base, type: 'text', value: raw == null ? '' : String(raw) };
  });
}
