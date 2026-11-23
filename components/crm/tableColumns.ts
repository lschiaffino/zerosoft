/**
 * Columnas de los tres índices del CRM (contactos, empresas y deals): id,
 * clave del nombre (crm.*) y si se ven por defecto. Puro, sin 'use client':
 * lo leen las tablas y el proveedor de columnas (TableColumnsProvider en
 * EditColumns.tsx), que vive por encima de la barra de filtros y de la tabla
 * para que "Editar columnas" salga con la página.
 */

export type IndexEntity = 'contacts' | 'companies' | 'deals';

export interface ColumnSpec {
  id: string;
  labelKey: string;
  defaultVisible: boolean;
}

export const CONTACT_COLUMNS: readonly ColumnSpec[] = [
  { id: 'name', labelKey: 'contacts.table.name', defaultVisible: true },
  { id: 'email', labelKey: 'contacts.table.email', defaultVisible: true },
  { id: 'phone', labelKey: 'contacts.table.phone', defaultVisible: true },
  { id: 'company', labelKey: 'contacts.table.company', defaultVisible: true },
  { id: 'lifecycle', labelKey: 'contacts.table.lifecycle', defaultVisible: true },
  { id: 'leadStatus', labelKey: 'contacts.table.leadStatus', defaultVisible: false },
  { id: 'source', labelKey: 'contacts.table.source', defaultVisible: false },
  { id: 'score', labelKey: 'scoring.column', defaultVisible: false },
  { id: 'tags', labelKey: 'tags.column', defaultVisible: true },
  { id: 'owner', labelKey: 'filters.field.owner', defaultVisible: true },
  { id: 'created', labelKey: 'contacts.table.created', defaultVisible: true },
  { id: 'lastActivity', labelKey: 'activityDates.lastActivity', defaultVisible: false },
  { id: 'lastContacted', labelKey: 'activityDates.lastContacted', defaultVisible: false },
  { id: 'nextActivity', labelKey: 'activityDates.nextActivity', defaultVisible: false },
];

export const COMPANY_COLUMNS: readonly ColumnSpec[] = [
  { id: 'name', labelKey: 'companies.table.name', defaultVisible: true },
  { id: 'domain', labelKey: 'companies.table.domain', defaultVisible: true },
  { id: 'industry', labelKey: 'companies.table.industry', defaultVisible: true },
  { id: 'phone', labelKey: 'companies.table.phone', defaultVisible: false },
  { id: 'location', labelKey: 'companies.table.location', defaultVisible: true },
  { id: 'contacts', labelKey: 'companies.table.contacts', defaultVisible: true },
  { id: 'deals', labelKey: 'deals.title', defaultVisible: true },
  { id: 'lifecycle', labelKey: 'companies.table.lifecycle', defaultVisible: true },
  { id: 'tags', labelKey: 'tags.column', defaultVisible: true },
  { id: 'owner', labelKey: 'filters.field.owner', defaultVisible: true },
  { id: 'parent', labelKey: 'companies.detail.parent', defaultVisible: false },
  { id: 'created', labelKey: 'companies.table.created', defaultVisible: false },
  { id: 'lastActivity', labelKey: 'activityDates.lastActivity', defaultVisible: false },
  { id: 'lastContacted', labelKey: 'activityDates.lastContacted', defaultVisible: false },
  { id: 'nextActivity', labelKey: 'activityDates.nextActivity', defaultVisible: false },
];

export const DEAL_COLUMNS: readonly ColumnSpec[] = [
  { id: 'name', labelKey: 'deals.table.name', defaultVisible: true },
  { id: 'amount', labelKey: 'deals.table.amount', defaultVisible: true },
  { id: 'stage', labelKey: 'deals.table.stage', defaultVisible: true },
  { id: 'priority', labelKey: 'deals.table.priority', defaultVisible: true },
  { id: 'source', labelKey: 'deals.table.source', defaultVisible: false },
  { id: 'closeDate', labelKey: 'deals.table.closeDate', defaultVisible: true },
  { id: 'age', labelKey: 'deals.table.age', defaultVisible: false },
  { id: 'contacts', labelKey: 'deals.table.contacts', defaultVisible: false },
  { id: 'company', labelKey: 'deals.detail.company', defaultVisible: true },
  { id: 'tags', labelKey: 'tags.column', defaultVisible: true },
  { id: 'owner', labelKey: 'filters.field.owner', defaultVisible: true },
  { id: 'created', labelKey: 'deals.table.created', defaultVisible: true },
  { id: 'lastActivity', labelKey: 'activityDates.lastActivity', defaultVisible: false },
  { id: 'lastContacted', labelKey: 'activityDates.lastContacted', defaultVisible: false },
  { id: 'nextActivity', labelKey: 'activityDates.nextActivity', defaultVisible: false },
];

/** Columnas, clave de este navegador y si la primera va fija sin que nadie elija (contactos y empresas, como HubSpot). */
export const INDEX_TABLES: Record<IndexEntity, { columns: readonly ColumnSpec[]; storageKey: string; defaultFreeze: boolean }> = {
  contacts: { columns: CONTACT_COLUMNS, storageKey: 'zs-contacts-columns', defaultFreeze: true },
  companies: { columns: COMPANY_COLUMNS, storageKey: 'zs-companies-columns', defaultFreeze: true },
  deals: { columns: DEAL_COLUMNS, storageKey: 'zs-deals-columns', defaultFreeze: false },
};

/** Ancho de la columna de selección (styles/crm.css, la misma medida que la fija). */
export const CHECK_COLUMN_WIDTH = 46;
/** Ancho de una columna sin ancho guardado cuando la tabla ya tiene anchos (una que se agregó después). */
export const DEFAULT_COLUMN_WIDTH = 160;

/**
 * Propiedad del filtro avanzado (advancedFilterFields.ts) que filtra cada
 * columna desde su encabezado ("Filtrar por esta columna"). Las columnas de
 * propiedades propias usan su id (`custom:<name>`). Sin entrada, la columna
 * no se filtra (un recuento, la ubicación armada con ciudad y país).
 */
const FILTER_KEYS: Record<IndexEntity, Record<string, string>> = {
  contacts: {
    name: 'name',
    email: 'email',
    phone: 'phone',
    company: 'companyName',
    lifecycle: 'lifecycle',
    leadStatus: 'leadStatus',
    source: 'source',
    score: 'score',
    tags: 'tag',
    owner: 'owner',
    created: 'created',
    lastActivity: 'lastActivity',
    lastContacted: 'lastContacted',
    nextActivity: 'nextActivity',
  },
  companies: {
    name: 'name',
    domain: 'domain',
    industry: 'industry',
    phone: 'phone',
    contacts: 'contactCount',
    lifecycle: 'lifecycle',
    tags: 'tag',
    owner: 'owner',
    created: 'created',
    lastActivity: 'lastActivity',
    lastContacted: 'lastContacted',
    nextActivity: 'nextActivity',
  },
  deals: {
    name: 'name',
    amount: 'amount',
    stage: 'stage',
    priority: 'priority',
    source: 'source',
    closeDate: 'closeDate',
    company: 'companyName',
    tags: 'tag',
    owner: 'owner',
    created: 'created',
    lastActivity: 'lastActivity',
    lastContacted: 'lastContacted',
    nextActivity: 'nextActivity',
  },
};

export function columnFilterKey(entity: IndexEntity, columnId: string): string | null {
  if (columnId.startsWith('custom:')) return columnId;
  return FILTER_KEYS[entity][columnId] ?? null;
}
