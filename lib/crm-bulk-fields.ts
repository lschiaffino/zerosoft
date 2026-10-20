/**
 * CRM — propiedades editables en masa (puro-cliente: lo usan la bulk bar y la
 * ruta). Las claves son las del input camelCase de update*; los custom fields
 * van como `custom:<name>`.
 */

export const BULK_ENTITIES = ['contact', 'company', 'deal'] as const;
export type BulkEntity = (typeof BULK_ENTITIES)[number];

export const BULK_FIELDS = {
  contact: ['ownerId', 'lifecycleStage', 'leadStatus', 'source', 'companyId', 'jobTitle', 'city', 'country'],
  company: ['ownerId', 'lifecycleStage', 'industry', 'employees', 'city', 'country'],
  deal: ['ownerId', 'stageId', 'priority', 'source', 'closeDate', 'currency'],
} as const satisfies Record<BulkEntity, readonly string[]>;

export type BulkField<E extends BulkEntity = BulkEntity> = (typeof BULK_FIELDS)[E][number];

/** Propiedades que se pueden dejar vacías (null) en masa. */
export const BULK_NULLABLE: ReadonlySet<string> = new Set(['ownerId', 'companyId', 'closeDate', 'employees']);

export function isBulkField(entity: BulkEntity, field: string): boolean {
  return field.startsWith('custom:') ? field.length > 7 : (BULK_FIELDS[entity] as readonly string[]).includes(field);
}
