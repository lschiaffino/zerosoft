import type { CrmCustomFieldRow } from '@/lib/schema/types';
import { fieldOptions } from '@/lib/crm-custom-fields';
import type { BulkEditField } from './BulkEditControls';

/** Custom fields de la entidad como propiedades de la edición en masa (`custom:<name>`). */
export function customBulkFields(
  defs: CrmCustomFieldRow[],
  labels: { yes: string; no: string },
  owners: Array<{ value: string; label: string }> = [],
): BulkEditField[] {
  return defs.map((def): BulkEditField => {
    const key = `custom:${def.name}`;
    const base = { key, label: def.label, nullable: true };
    switch (def.type) {
      case 'boolean':
        return {
          ...base,
          type: 'select',
          options: [
            { value: 'true', label: labels.yes },
            { value: 'false', label: labels.no },
          ],
        };
      case 'select':
        return { ...base, type: 'select', options: fieldOptions(def).map((o) => ({ value: o, label: o })) };
      case 'multiselect':
        // Reemplaza la selección por las opciones elegidas (vacío = sin ninguna).
        return { ...base, type: 'multiselect', options: fieldOptions(def).map((o) => ({ value: o, label: o })) };
      case 'user':
        return { ...base, type: 'select', options: owners };
      case 'number':
      case 'currency':
        return { ...base, type: 'number' };
      case 'date':
        return { ...base, type: 'date' };
      default:
        return { ...base, type: 'text' };
    }
  });
}
