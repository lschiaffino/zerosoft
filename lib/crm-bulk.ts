/**
 * CRM — edición en masa de una propiedad (incluido el owner y los custom
 * fields) en contactos, empresas y deals. Server-only.
 *
 * Cada registro pasa por su update* de siempre: misma validación de
 * referencias, historial de propiedades y eventos de workflows que editar a
 * mano. El cambio de etapa de deals va por moveDeal (semántica de cierre).
 */
import { BULK_FIELDS, isBulkField, type BulkEntity } from './crm-bulk-fields';
import { companyUpdateSchema, contactUpdateSchema, dealUpdateSchema } from './crm-schema';
import { CrmRefError } from './crm-refs';
import {
  listCustomFields,
  moveDeal,
  parseCustom,
  updateCompany,
  updateContact,
  updateDeal,
} from './crm';
import { getDb, type CrmCustomFieldRow } from './db';

const TABLE: Record<BulkEntity, string> = { contact: 'crm_contacts', company: 'crm_companies', deal: 'crm_deals' };
const FIELD_ENTITY: Record<BulkEntity, string> = { contact: 'contacts', company: 'companies', deal: 'deals' };

export type BulkPatch =
  | { kind: 'field'; patch: Record<string, unknown> }
  | { kind: 'stage'; stageId: string }
  | { kind: 'custom'; name: string; value: unknown };

/** Valor de un custom field normalizado a su tipo (undefined = inválido). */
export function coerceCustomValue(def: Pick<CrmCustomFieldRow, 'type' | 'options'>, value: unknown): unknown {
  if (value === null || value === '') return null;
  switch (def.type) {
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) ? n : undefined;
    }
    case 'boolean':
      if (value === true || value === 'true') return true;
      if (value === false || value === 'false') return false;
      return undefined;
    case 'date':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
    case 'select': {
      let options: unknown = [];
      try {
        options = JSON.parse(def.options);
      } catch {
        options = [];
      }
      return Array.isArray(options) && options.includes(value) ? value : undefined;
    }
    default:
      return typeof value === 'string' ? value.trim().slice(0, 500) : typeof value === 'number' ? String(value) : undefined;
  }
}

/**
 * Valida `field` = `value` para la entidad y arma el patch. null si la
 * propiedad no es editable en masa o el valor no es válido.
 */
export function buildBulkPatch(
  entity: BulkEntity,
  field: string,
  value: unknown,
  customDefs: Array<Pick<CrmCustomFieldRow, 'name' | 'type' | 'options'>> = [],
): BulkPatch | null {
  if (!isBulkField(entity, field)) return null;
  if (field.startsWith('custom:')) {
    const name = field.slice(7);
    const def = customDefs.find((d) => d.name === name);
    if (!def) return null;
    const v = coerceCustomValue(def, value);
    return v === undefined ? null : { kind: 'custom', name, value: v };
  }
  if (entity === 'deal' && field === 'stageId') {
    return typeof value === 'string' && value.length > 0 && value.length <= 64 ? { kind: 'stage', stageId: value } : null;
  }
  const schema = entity === 'contact' ? contactUpdateSchema : entity === 'company' ? companyUpdateSchema : dealUpdateSchema;
  const parsed = schema.safeParse({ [field]: value });
  if (!parsed.success) return null;
  const data = parsed.data as Record<string, unknown>;
  if (!(field in data)) return null;
  return { kind: 'field', patch: { [field]: data[field] } };
}

export type BulkSetResult = { ok: true; count: number; failed: number } | { ok: false; code: string };

/** Aplica una propiedad a `ids` (ya filtrados por visibilidad en la ruta). */
export async function bulkSetProperty(
  userId: string,
  entity: BulkEntity,
  ids: string[],
  field: string,
  value: unknown,
  actorEmail = '',
): Promise<BulkSetResult> {
  const defs = field.startsWith('custom:') ? await listCustomFields(userId, FIELD_ENTITY[entity]) : [];
  const patch = buildBulkPatch(entity, field, value, defs);
  if (!patch) return { ok: false, code: 'invalid_input' };
  let count = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      let done: unknown = null;
      if (patch.kind === 'stage') {
        done = (await moveDeal(userId, id, patch.stageId, null, undefined, actorEmail)).ok ? true : null;
      } else {
        let data = patch.kind === 'field' ? patch.patch : null;
        if (patch.kind === 'custom') {
          const row = (await getDb()
            .prepare(`SELECT custom FROM ${TABLE[entity]} WHERE id = ? AND user_id = ?`)
            .get(id, userId)) as { custom: string } | undefined;
          if (!row) {
            failed++;
            continue;
          }
          data = { custom: { ...parseCustom(row.custom), [patch.name]: patch.value } };
        }
        if (entity === 'contact') done = await updateContact(userId, id, data!, undefined, actorEmail);
        else if (entity === 'company') done = await updateCompany(userId, id, data!, undefined, actorEmail);
        else done = await updateDeal(userId, id, data!, actorEmail);
      }
      if (done) count++;
      else failed++;
    } catch (err) {
      // Una referencia inválida (owner o empresa de otro workspace) invalida todo el lote.
      if (err instanceof CrmRefError) return { ok: false, code: err.code };
      failed++;
    }
  }
  return { ok: true, count, failed };
}

export { BULK_FIELDS };
