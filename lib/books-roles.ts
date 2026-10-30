/**
 * Books: roles dentro de la app (puro). Van encima del acceso por app
 * (team_members.apps): primero hay que tener Books en el workspace y después
 * el rol dice qué partes se ven.
 *
 * - accountant: todo (contabilidad, bancos, compras, informes, ajustes).
 * - sales: facturas, notas de crédito y presupuestos a factura, clientes e
 *   ítems (lectura). Nada de compras, bancos, asientos ni informes.
 * - viewer: solo lectura de todo, informes incluidos.
 *
 * El owner y los admins del workspace son siempre accountant. Un miembro sin
 * rol asignado es accountant (el acceso a la app ya lo dio un admin); el
 * admin lo puede bajar a sales o viewer en Ajustes › Roles.
 */

export type BooksRole = 'accountant' | 'sales' | 'viewer';
export const BOOKS_ROLES: readonly BooksRole[] = ['accountant', 'sales', 'viewer'];

export type BooksArea = 'invoices' | 'contacts' | 'items' | 'bills' | 'expenses' | 'purchasing' | 'banking' | 'accounting' | 'reports' | 'settings';
export const BOOKS_AREAS: readonly BooksArea[] = ['invoices', 'contacts', 'items', 'bills', 'expenses', 'purchasing', 'banking', 'accounting', 'reports', 'settings'];

export type BooksPermission = `${BooksArea}.${'read' | 'write'}`;

const SALES: ReadonlySet<BooksPermission> = new Set<BooksPermission>(['invoices.read', 'invoices.write', 'contacts.read', 'contacts.write', 'items.read']);

export function isBooksRole(v: unknown): v is BooksRole {
  return typeof v === 'string' && (BOOKS_ROLES as readonly string[]).includes(v);
}

export function can(role: BooksRole, perm: BooksPermission): boolean {
  if (role === 'accountant') return true;
  if (role === 'viewer') return perm.endsWith('.read');
  return SALES.has(perm);
}

/** Áreas que el rol ve (para el sidebar y los atajos). */
export function visibleAreas(role: BooksRole): BooksArea[] {
  return BOOKS_AREAS.filter((a) => can(role, `${a}.read`));
}

/** Rol efectivo: owner/admin siempre accountant; si no, el guardado (o accountant por defecto). */
export function effectiveRole(workspaceRole: string | null | undefined, stored: string | null | undefined): BooksRole {
  const r = workspaceRole ?? 'owner';
  if (r === 'owner' || r === 'admin') return 'accountant';
  return isBooksRole(stored) ? stored : 'accountant';
}
