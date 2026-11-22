/**
 * CRM — listas de contactos según quién mira. Server-only salvo las funciones
 * puras de arriba.
 *
 * Una lista dinámica cuyo filtro usa un campo propio de contactos que la
 * persona tiene oculto no se le muestra: ni en el índice, ni su detalle, ni
 * su nombre en los selects, ni se puede editar, borrar o usar en un agente.
 * Si la viera, saber qué contactos entran y cuáles salen (o cuántos son)
 * delataría el valor del campo. Owner y admins ven todas. El resto de las
 * listas se muestran con los contactos que la persona ve (crm-visibility) y
 * sin campos ocultos.
 */
import { getDb, type Db } from './db';
import { getList, listLists, parseListFilter, type ListDetail, type ListFilterJson, type ListWithCount } from './crm';
import { hiddenFieldsFor, isUnrestricted, type FieldViewer } from './crm-field-perms';
import type { OwnerScope } from './crm-visibility';

const CUSTOM_PREFIX = 'custom:';

/** ¿El filtro usa alguno de estos campos propios (por nombre)? Puro. */
export function filterUsesHiddenField(filter: ListFilterJson | undefined, hidden: ReadonlySet<string>): boolean {
  if (!hidden.size || !filter?.filters?.length) return false;
  return filter.filters.some((r) => r.f.startsWith(CUSTOM_PREFIX) && hidden.has(r.f.slice(CUSTOM_PREFIX.length)));
}

/** El filtro sin las reglas sobre campos ocultos (lo que una persona puede guardar). Puro. */
export function withoutHiddenRules(filter: ListFilterJson | undefined, hidden: ReadonlySet<string>): ListFilterJson | undefined {
  if (!filter?.filters?.length || !hidden.size) return filter;
  return { ...filter, filters: filter.filters.filter((r) => !r.f.startsWith(CUSTOM_PREFIX) || !hidden.has(r.f.slice(CUSTOM_PREFIX.length))) };
}

/** ¿La lista (fila de crm_lists) queda fuera para quien tiene estos campos ocultos? Puro. */
export function isListRestricted(list: { kind: string; filter: string }, hidden: ReadonlySet<string>): boolean {
  return list.kind === 'dynamic' && filterUsesHiddenField(parseListFilter(list.filter), hidden);
}

/** Campos propios de contactos que la persona tiene ocultos (vacío para owner y admins). */
export async function hiddenContactFields(viewer: FieldViewer, db: Db = getDb()): Promise<Set<string>> {
  if (isUnrestricted(viewer)) return new Set();
  return hiddenFieldsFor(viewer, 'contacts', db);
}

/** Índice de listas de la persona: sin las que no puede ver y con los conteos de lo que ve. */
export async function listsForViewer(viewer: FieldViewer, scope: OwnerScope | undefined): Promise<ListWithCount[]> {
  const [lists, hidden] = await Promise.all([listLists(viewer.workspaceId, scope), hiddenContactFields(viewer)]);
  return hidden.size ? lists.filter((l) => !isListRestricted(l, hidden)) : lists;
}

/** Detalle de una lista para la persona. null si no existe o no la puede ver. */
export async function listForViewer(viewer: FieldViewer, id: string, scope: OwnerScope | undefined): Promise<ListDetail | null> {
  const hidden = await hiddenContactFields(viewer);
  if (hidden.size && (await isListIdRestricted(viewer.workspaceId, id, hidden))) return null;
  return getList(viewer.workspaceId, id, scope);
}

/** ¿La persona puede ver la lista? false si no existe en el workspace o le queda fuera. */
export async function canSeeList(viewer: FieldViewer, id: string, db: Db = getDb()): Promise<boolean> {
  const row = (await db.prepare('SELECT kind, filter FROM crm_lists WHERE id = ? AND user_id = ?').get(id, viewer.workspaceId)) as
    | { kind: string; filter: string }
    | undefined;
  if (!row) return false;
  const hidden = await hiddenContactFields(viewer, db);
  return !isListRestricted(row, hidden);
}

async function isListIdRestricted(workspaceId: string, id: string, hidden: ReadonlySet<string>, db: Db = getDb()): Promise<boolean> {
  const row = (await db.prepare('SELECT kind, filter FROM crm_lists WHERE id = ? AND user_id = ?').get(id, workspaceId)) as
    | { kind: string; filter: string }
    | undefined;
  return !!row && isListRestricted(row, hidden);
}
