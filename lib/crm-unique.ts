/**
 * CRM — propiedades de valor único (como las "unique value properties" de
 * HubSpot). Server-only.
 *
 * Un custom field de contactos, empresas o deals marcado `is_unique` no admite
 * el mismo valor en dos registros del workspace. Texto (también url y
 * teléfono) se compara sin mayúsculas ni espacios en los bordes; número, por
 * valor. Vacío no cuenta.
 *
 * Privacidad: el error (`value_taken`) no dice qué registro tiene el valor ni
 * de quién es, así que no muestra nada de un registro que la persona no ve.
 * Prender la regla en un campo es de admins (la ruta lo chequea): fallar
 * porque ya hay duplicados también es información de todo el workspace.
 *
 * Solo se chequea el valor que cambia: un duplicado de antes de prender la
 * regla se puede seguir editando (misma idea que el email del contacto).
 * Es un chequeo previo a escribir, no un índice: dos altas simultáneas con el
 * mismo valor pueden pasar las dos.
 */
import { getDb, type Db } from './db';
import { CrmRefError } from './crm-refs';
import { UNIQUE_FIELD_ENTITIES, UNIQUE_FIELD_TYPES } from './crm-custom-fields';

export type UniqueEntity = (typeof UNIQUE_FIELD_ENTITIES)[number];

const TABLE: Record<UniqueEntity, string> = {
  contacts: 'crm_contacts',
  companies: 'crm_companies',
  deals: 'crm_deals',
};

/** El valor ya lo tiene otro registro. `field` = nombre del campo (para el import). */
export class CrmUniqueValueError extends CrmRefError {
  constructor(public readonly field: string) {
    super('value_taken');
    this.name = 'CrmUniqueValueError';
  }
}

export function isUniqueEntity(entity: string): entity is UniqueEntity {
  return (UNIQUE_FIELD_ENTITIES as readonly string[]).includes(entity);
}

/** Clave de comparación: número, texto recortado en minúsculas, o null (vacío o tipo que no compara). */
export function uniqueKey(type: string, value: unknown): number | string | null {
  if (value === null || value === undefined) return null;
  if (type === 'number') {
    const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const s = String(value).trim().toLowerCase();
  return s ? s : null;
}

/** Path JSON del campo dentro de `custom` (los nombres son [a-z][a-z0-9_]*). */
function jsonPath(name: string): string {
  return `$."${name.replace(/"/g, '')}"`;
}

/**
 * Lanza CrmUniqueValueError si algún campo único de `next` (el custom nuevo
 * del registro) ya lo tiene otro registro del workspace. `prev`: el custom
 * actual (en un alta, {}); los valores que no cambian no se chequean.
 */
export async function assertUniqueCustom(
  userId: string,
  entity: UniqueEntity,
  recordId: string | null,
  next: Record<string, unknown> | undefined,
  prev: Record<string, unknown> = {},
  db: Db = getDb(),
): Promise<void> {
  if (!next || Object.keys(next).length === 0) return;
  const defs = (await db
    .prepare('SELECT name, type FROM crm_custom_fields WHERE user_id = ? AND entity = ? AND is_unique = 1')
    .all(userId, entity)) as Array<{ name: string; type: string }>;
  for (const def of defs) {
    if (!UNIQUE_FIELD_TYPES.has(def.type)) continue;
    if (!(def.name in next)) continue;
    const key = uniqueKey(def.type, next[def.name]);
    if (key === null) continue;
    if (uniqueKey(def.type, prev[def.name]) === key) continue;
    const path = jsonPath(def.name);
    const table = TABLE[entity];
    const hit =
      typeof key === 'number'
        ? await db
            .prepare(
              `SELECT 1 FROM ${table} WHERE user_id = ? AND id != ?
                 AND json_type(custom, ?) IN ('integer', 'real') AND json_extract(custom, ?) = ? LIMIT 1`,
            )
            .get(userId, recordId ?? '', path, path, key)
        : await db
            .prepare(
              `SELECT 1 FROM ${table} WHERE user_id = ? AND id != ?
                 AND json_type(custom, ?) IN ('text', 'integer', 'real')
                 AND lower(trim(json_extract(custom, ?))) = lower(trim(?)) LIMIT 1`,
            )
            .get(userId, recordId ?? '', path, path, String(next[def.name]).trim());
    if (hit) throw new CrmUniqueValueError(def.name);
  }
}

/**
 * `next` sin los valores únicos que ya tiene otro registro. Para los
 * formularios públicos: el envío se guarda igual y no dice nada del valor
 * (si fallara, cualquiera podría preguntar si un valor existe en el CRM).
 */
export async function dropTakenUniqueValues(
  userId: string,
  entity: UniqueEntity,
  recordId: string | null,
  next: Record<string, unknown>,
  prev: Record<string, unknown> = {},
  db: Db = getDb(),
): Promise<Record<string, unknown>> {
  const out = { ...next };
  for (;;) {
    try {
      await assertUniqueCustom(userId, entity, recordId, out, prev, db);
      return out;
    } catch (e) {
      if (!(e instanceof CrmUniqueValueError)) throw e;
      delete out[e.field];
    }
  }
}

/** ¿Hay dos registros con el mismo valor en el campo? (para no prender la regla sobre duplicados). */
export async function hasDuplicateValues(
  userId: string,
  entity: UniqueEntity,
  field: { name: string; type: string },
  db: Db = getDb(),
): Promise<boolean> {
  const path = jsonPath(field.name);
  const keyExpr =
    field.type === 'number'
      ? `CASE WHEN json_type(custom, ?) IN ('integer', 'real') THEN json_extract(custom, ?) END`
      : `CASE WHEN json_type(custom, ?) IN ('text', 'integer', 'real') THEN NULLIF(lower(trim(json_extract(custom, ?))), '') END`;
  const row = await db
    .prepare(
      `SELECT k FROM (SELECT ${keyExpr} AS k FROM ${TABLE[entity]} WHERE user_id = ?)
       WHERE k IS NOT NULL GROUP BY k HAVING COUNT(*) > 1 LIMIT 1`,
    )
    .get(path, path, userId);
  return !!row;
}
