/**
 * Reglas de roles del workspace, sin dependencias (las usa también la
 * pantalla de Miembros y permisos). La entrada para el servidor es
 * lib/permissions.ts, que suma el acceso por app.
 */
export type Role = 'owner' | 'admin' | 'member' | 'guest';
export const ROLES: readonly Role[] = ['owner', 'admin', 'member', 'guest'];
const RANK: Record<Role, number> = { guest: -1, member: 0, admin: 1, owner: 2 };

export interface Actor {
  role: Role | string | null | undefined;
  apps?: unknown;
}

export type Action =
  /** Ver la lista de personas del workspace. */
  | 'members.view'
  /** Invitar, ver y gestionar invitaciones y pedidos de ingreso. */
  | 'members.invite'
  /** Cambiar rol, apps o equipos de otra persona (con `target`). */
  | 'members.manage'
  /** Desactivar/sacar a otra persona y pasar sus cosas (con `target`). */
  | 'members.remove'
  /** Ver qué puede ver otra persona y el registro de cambios. */
  | 'members.inspect'
  /** Crear, renombrar y borrar equipos (subequipos). */
  | 'teams.manage'
  /** Nombre, logo, dominios, modo del workspace. */
  | 'workspace.edit'
  /** Lo que es solo del owner: nombrar y quitar admins, pedir el cierre del workspace. */
  | 'workspace.own'
  /** Ver y revocar las API keys de todos (cada uno crea y ve las suyas). */
  | 'api_keys.all'
  /** Irse del workspace. */
  | 'members.leave';

export interface ActionContext {
  /** Rol actual de la persona sobre la que se actúa. */
  target?: Role | string | null;
  /** Rol que se le quiere dar (cambiar rol o invitar). */
  nextRole?: Role | string | null;
  /** Actúa sobre sí misma. */
  self?: boolean;
}

export function normalizeRole(raw: unknown): Role {
  return raw === 'owner' || raw === 'admin' || raw === 'guest' ? raw : 'member';
}

export function roleAtLeast(role: Role | string | null | undefined, min: Role): boolean {
  return RANK[normalizeRole(role)] >= RANK[min];
}

/**
 * ¿`actor` puede gestionar a alguien con rol `target`? El owner, a cualquiera
 * menos al owner; un admin, a members y guests.
 */
export function canManageRole(actor: Role | string | null | undefined, target: Role | string | null | undefined): boolean {
  const a = normalizeRole(actor);
  const t = normalizeRole(target);
  if (t === 'owner') return false;
  if (a === 'owner') return true;
  return a === 'admin' && (t === 'member' || t === 'guest');
}

/** Roles que `actor` puede dar (al invitar o al cambiar el rol de alguien). */
export function assignableRoles(actor: Role | string | null | undefined): Array<Exclude<Role, 'owner'>> {
  const a = normalizeRole(actor);
  if (a === 'owner') return ['admin', 'member', 'guest'];
  if (a === 'admin') return ['member', 'guest'];
  return [];
}

/** La regla única. Sin contexto, contesta por el caso general de la acción. */
export function can(actor: Actor, action: Action, ctx: ActionContext = {}): boolean {
  const role = normalizeRole(actor.role ?? 'owner');
  const admin = roleAtLeast(role, 'admin');
  switch (action) {
    case 'members.view':
      return role !== 'guest';
    case 'members.invite':
      if (!admin) return false;
      return ctx.nextRole == null || assignableRoles(role).includes(normalizeRole(ctx.nextRole) as Exclude<Role, 'owner'>);
    case 'members.manage':
      if (!admin || ctx.self) return false;
      if (ctx.target !== undefined && !canManageRole(role, ctx.target)) return false;
      return ctx.nextRole == null || assignableRoles(role).includes(normalizeRole(ctx.nextRole) as Exclude<Role, 'owner'>);
    case 'members.remove':
      if (!admin || ctx.self) return false;
      return ctx.target === undefined || canManageRole(role, ctx.target);
    case 'members.inspect':
      return admin;
    case 'teams.manage':
    case 'workspace.edit':
    case 'api_keys.all':
      return admin;
    case 'workspace.own':
      return role === 'owner';
    case 'members.leave':
      return role !== 'owner';
  }
  return false;
}


/**
 * Lo que cada rol puede hacer, en el orden de la leyenda de Ajustes. La
 * pantalla lo muestra como sí/no y los tests comprueban que las rutas
 * respondan lo mismo.
 */
export const ROLE_MATRIX: ReadonlyArray<{ key: string; action: Action }> = [
  { key: 'useApps', action: 'members.view' },
  { key: 'invite', action: 'members.invite' },
  { key: 'manage', action: 'members.manage' },
  { key: 'workspace', action: 'workspace.edit' },
  { key: 'own', action: 'workspace.own' },
];
