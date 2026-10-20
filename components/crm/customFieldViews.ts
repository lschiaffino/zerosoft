import type { CrmCustomFieldRow } from '@/lib/schema/types';
import {
  customFieldHref,
  fieldOptions,
  filterTypeFor,
  formatCustomFieldValue,
  type CustomFilterType,
} from '@/lib/crm-custom-fields';
import type { FilterBuilderField } from './FilterBuilder';

/**
 * Custom fields en las listas del CRM (contactos, empresas, deals): tipos del
 * filtro avanzado, campos del constructor, columnas opcionales de la tabla y
 * el texto de cada celda. Puro (lo arman las páginas server).
 */

interface Option {
  value: string;
  label: string;
}

/** name → tipo con el que el server arma la condición del filtro. */
export function customFilterTypes(defs: CrmCustomFieldRow[]): Record<string, CustomFilterType> {
  return Object.fromEntries(defs.map((cf) => [cf.name, filterTypeFor(cf.type)]));
}

/** Campos del constructor de filtros para los custom fields (`custom:<name>`). */
export function customBuilderFields(
  defs: CrmCustomFieldRow[],
  labels: { yes: string; no: string },
  owners: Option[],
): FilterBuilderField[] {
  return defs.map((cf): FilterBuilderField => {
    const key = `custom:${cf.name}`;
    if (cf.type === 'boolean') {
      return {
        key,
        label: cf.label,
        type: 'select',
        options: [
          { value: '1', label: labels.yes },
          { value: '0', label: labels.no },
        ],
      };
    }
    if (cf.type === 'select' || cf.type === 'multiselect') {
      return { key, label: cf.label, type: 'select', options: fieldOptions(cf).map((o) => ({ value: o, label: o })) };
    }
    if (cf.type === 'user') return { key, label: cf.label, type: 'select', options: owners };
    const type = filterTypeFor(cf.type);
    return { key, label: cf.label, type: type === 'number' ? 'number' : type === 'date' ? 'date' : 'text' };
  });
}

/** Columnas opcionales de la tabla (ocultas por defecto: se prenden en "Columnas"). */
export interface CustomColumn {
  id: string;
  label: string;
  /** Números y monedas se alinean a la derecha. */
  numeric: boolean;
}

export function customColumns(defs: CrmCustomFieldRow[]): CustomColumn[] {
  return defs.map((cf) => ({
    id: `custom:${cf.name}`,
    label: cf.label,
    numeric: cf.type === 'number' || cf.type === 'currency',
  }));
}

export interface CustomCell {
  text: string;
  href?: string;
}

/** Celdas de una fila: `custom:<name>` → texto (y link para url/teléfono). */
export function customCells(
  defs: CrmCustomFieldRow[],
  custom: Record<string, unknown>,
  ctx: { locale: string; yes: string; no: string; users: ReadonlyMap<string, string> },
): Record<string, CustomCell> {
  const out: Record<string, CustomCell> = {};
  for (const cf of defs) {
    const raw = custom[cf.name];
    const text = formatCustomFieldValue(cf, raw, ctx);
    if (!text) continue;
    const href = customFieldHref(cf, raw);
    out[`custom:${cf.name}`] = href ? { text, href } : { text };
  }
  return out;
}
