import type { CrmCustomFieldRow } from '@/lib/db';
import type { BulkEditField } from './BulkEditControls';

/** Custom fields de la entidad como propiedades de la edición en masa (`custom:<name>`). */
export function customBulkFields(
  defs: CrmCustomFieldRow[],
  labels: { yes: string; no: string },
): BulkEditField[] {
  return defs.map((def): BulkEditField => {
    const key = `custom:${def.name}`;
    if (def.type === 'boolean') {
      return {
        key,
        label: def.label,
        type: 'select',
        nullable: true,
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
      return { key, label: def.label, type: 'select', nullable: true, options: options.map((o) => ({ value: o, label: o })) };
    }
    return { key, label: def.label, type: def.type === 'number' || def.type === 'date' ? def.type : 'text', nullable: true };
  });
}
