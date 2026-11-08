/**
 * Permisos del workspace en un solo lugar: lo que dice Ajustes › Miembros y
 * permisos es lo que chequean las rutas, las acciones y el MCP.
 *
 * Cuatro roles:
 * - owner: todo; el único que nombra y quita admins y pide cerrar el workspace.
 * - admin: invita y gestiona personas (members y guests), equipos y la
 *   configuración del workspace. No toca al owner ni a otros admins.
 * - member: usa las apps que tiene habilitadas. No gestiona personas.
 * - guest: no entra al workspace; solo ve lo que le comparten por recurso.
 *
 * Además del rol, cada persona tiene apps habilitadas (`apps`: '*' o lista):
 * `canUseApp`. Nadie da apps que no tiene (`canGrantApps`).
 */
import type { ProductKey } from './products';
import { canGrantApps, canUseApp, parseApps, type AppAccess } from './workspace';
import { normalizeRole, type Actor } from './roles';

export * from './roles';

/** ¿Puede usar la app? (rol + apps habilitadas). */
export function canUse(actor: Actor, app: ProductKey): boolean {
  return canUseApp({ role: normalizeRole(actor.role ?? 'owner'), apps: (actor.apps ?? '*') as AppAccess | string }, app);
}

/** ¿Puede dejarle `requested` a alguien que hoy tiene `current`? (nadie da apps que no tiene). */
export function canGiveApps(actor: Actor, requested: AppAccess | readonly string[], current: AppAccess = []): boolean {
  const mine = normalizeRole(actor.role ?? 'owner') === 'owner' ? '*' : parseApps(actor.apps ?? '*');
  const req = requested === '*' ? '*' : parseApps([...requested]);
  return canGrantApps(mine, req, current);
}

