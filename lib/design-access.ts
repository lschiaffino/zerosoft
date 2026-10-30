/**
 * Design: quién ve y quién edita un diseño. Puro (lo usan el servidor, la
 * búsqueda, la lista y los tests).
 *
 * - Quien lo creó es dueña: edita, comparte, maneja el link público y lo borra.
 * - Acceso del workspace: nadie (privado, como Canva por defecto), ver o editar.
 * - Personas puntuales (design_members): ver o editar.
 * - Las plantillas del workspace las ve todo el workspace; las editan quien la
 *   creó y owner/admins.
 * - Ver incluye comentar. Editar incluye compartir con el workspace y con
 *   personas, y el link público.
 * Un admin no ve los diseños privados de otros (igual que Canva).
 */

export type DesignLevel = 'view' | 'edit';
export type DesignAccess = 'owner' | 'edit' | 'view';
export type WorkspaceAccess = 'none' | 'view' | 'edit';
export type DesignAction = 'view' | 'comment' | 'edit' | 'share' | 'delete';

export interface DesignActor {
  /** Workspace (id del dueño del workspace, donde viven los datos). */
  ws: string;
  /** La persona real. */
  personId: string;
  /** owner o admin del workspace. */
  admin: boolean;
  name: string;
}

export interface DesignAccessRow {
  created_by: string;
  workspace_access: string;
  is_template: number | boolean;
}

const RANK: Record<DesignAccess, number> = { view: 1, edit: 2, owner: 3 };

export function resolveAccess(
  actor: Pick<DesignActor, 'personId' | 'admin'>,
  row: DesignAccessRow,
  memberRole: DesignLevel | null | undefined,
): DesignAccess | null {
  if (row.created_by === actor.personId) return 'owner';
  const got: DesignAccess[] = [];
  if (memberRole === 'view' || memberRole === 'edit') got.push(memberRole);
  if (row.workspace_access === 'view' || row.workspace_access === 'edit') got.push(row.workspace_access);
  if (row.is_template) got.push(actor.admin ? 'edit' : 'view');
  if (!got.length) return null;
  return got.reduce((a, b) => (RANK[b] > RANK[a] ? b : a));
}

export function can(access: DesignAccess | null, action: DesignAction, opts: { admin?: boolean; isTemplate?: boolean } = {}): boolean {
  if (!access) return false;
  switch (action) {
    case 'view':
    case 'comment':
      return true;
    case 'edit':
    case 'share':
      return RANK[access] >= RANK.edit;
    case 'delete':
      // Borrar: quien lo creó; una plantilla del workspace, también owner/admins.
      return access === 'owner' || Boolean(opts.isTemplate && opts.admin);
  }
}

/** Condición SQL de "lo puede ver" (alias `d` = design_designs). Args: personId, personId. */
export function visibleSql(alias = 'd'): { sql: string; argsFor: (personId: string) => string[] } {
  return {
    sql: `(${alias}.created_by = ? OR ${alias}.workspace_access IN ('view', 'edit') OR ${alias}.is_template = 1 OR EXISTS (SELECT 1 FROM design_members m WHERE m.design_id = ${alias}.id AND m.user_id = ?))`,
    argsFor: (personId) => [personId, personId],
  };
}

export function isWorkspaceAccess(v: unknown): v is WorkspaceAccess {
  return v === 'none' || v === 'view' || v === 'edit';
}
