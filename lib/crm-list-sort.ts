/**
 * CRM — orden de las tablas por owner y por custom fields (contactos,
 * empresas y deals). Puro: arma el ORDER BY y valida el valor de `?sort=`.
 *
 * Valores:
 * - `owner` / `owner_desc`: por nombre (o email) del owner; sin owner al final.
 * - `cf:<name>` / `cf:<name>:desc`: por el custom field `<name>`; vacíos al final.
 *   Números y monedas ordenan como número; el resto como texto sin mayúsculas.
 */
import type { CustomFilterType as FilterFieldType } from './crm-custom-fields';

export const OWNER_SORTS = ['owner', 'owner_desc'] as const;
export type OwnerSort = (typeof OWNER_SORTS)[number];
export type CustomSort = `cf:${string}`;
export type ExtraSort = OwnerSort | CustomSort;

const NAME = /^[A-Za-z0-9_\-]{1,100}$/;

/** `cf:<name>[:desc]` → { name, desc }; null si no es un orden por custom field. */
export function parseCustomSort(sort: string | undefined | null): { name: string; desc: boolean } | null {
  if (!sort || !sort.startsWith('cf:')) return null;
  const rest = sort.slice(3);
  const desc = rest.endsWith(':desc');
  const name = desc ? rest.slice(0, -5) : rest;
  return NAME.test(name) ? { name, desc } : null;
}

export function customSortValue(name: string, desc = false): CustomSort {
  return `cf:${name}${desc ? ':desc' : ''}`;
}

/** ¿Es un orden extra válido? Los de custom field tienen que existir en `customTypes`. */
export function isExtraSort(
  sort: string | undefined | null,
  customTypes: Record<string, FilterFieldType> = {},
): sort is ExtraSort {
  if (!sort) return false;
  if ((OWNER_SORTS as readonly string[]).includes(sort)) return true;
  const cs = parseCustomSort(sort);
  return !!cs && Object.prototype.hasOwnProperty.call(customTypes, cs.name);
}

/**
 * ORDER BY para un orden extra sobre la tabla con alias `alias`; null si
 * `sort` no es uno (el llamador usa su orden de siempre).
 */
export function extraSortOrder(
  alias: 'c' | 'co' | 'd',
  sort: string | undefined | null,
  customTypes: Record<string, FilterFieldType> = {},
): string | null {
  if (!isExtraSort(sort, customTypes)) return null;
  if (sort === 'owner' || sort === 'owner_desc') {
    const expr = `(SELECT COALESCE(NULLIF(ou.name, ''), ou.email) FROM users ou WHERE ou.id = ${alias}.owner_id)`;
    const dir = sort === 'owner' ? 'ASC' : 'DESC';
    return `${expr} IS NULL, ${expr} COLLATE NOCASE ${dir}, ${alias}.created_at DESC, ${alias}.id`;
  }
  const cs = parseCustomSort(sort)!;
  const base = `json_extract(${alias}.custom, '$."${cs.name}"')`;
  const type = customTypes[cs.name];
  const dir = cs.desc ? 'DESC' : 'ASC';
  // multiselect se guarda como lista JSON: ordena por su texto (primera opción primero).
  const expr = type === 'number' ? `CAST(${base} AS REAL)` : `${base}`;
  const empty = type === 'number' ? `${base} IS NULL OR ${base} = ''` : `${base} IS NULL OR ${base} = '' OR ${base} = '[]'`;
  const collate = type === 'number' ? '' : ' COLLATE NOCASE';
  return `(${empty}), ${expr}${collate} ${dir}, ${alias}.created_at DESC, ${alias}.id`;
}
