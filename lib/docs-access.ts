/**
 * Docs: roles, ajustes de seguridad del workspace y teamspaces (tanda D3).
 *
 * Roles de una página, de menor a mayor (como Notion): ver, comentar,
 * editar y acceso total. "Acceso total" de un miembro del workspace es el
 * acceso de siempre (compartir, publicar, mover, papelera); el de un invitado
 * (share por persona) suma compartir esa página a la edición.
 *
 * Teamspaces: abiertos (todo el workspace los ve y se puede unir), cerrados
 * (se ven en la lista, las páginas solo para miembros) y privados (solo los
 * ven sus miembros). Cada página guarda el teamspace de su subárbol.
 *
 * No importa lib/docs.ts (lo usa getDocAccess).
 */
import { getDb } from './db';

export type DocsRole = 'view' | 'comment' | 'edit' | 'full';
export const DOCS_ROLES: DocsRole[] = ['view', 'comment', 'edit', 'full'];
const RANK: Record<string, number> = { view: 1, comment: 2, edit: 3, full: 4, owner: 5 };

export function isDocsRole(v: unknown): v is DocsRole {
  return v === 'view' || v === 'comment' || v === 'edit' || v === 'full';
}

export function normalizeDocsRole(v: unknown, fallback: DocsRole = 'view'): DocsRole {
  return isDocsRole(v) ? v : fallback;
}

export function roleRank(v: string | null | undefined): number {
  return v ? RANK[v] ?? 0 : 0;
}

/** El rol más alto de dos (null = sin rol). */
export function maxRole<T extends string>(a: T | null, b: T | null): T | null {
  if (!a) return b;
  if (!b) return a;
  return roleRank(a) >= roleRank(b) ? a : b;
}

/** Acceso que permite cambiar el contenido. */
export function canWriteAccess(a: string | null | undefined): boolean {
  return a === 'owner' || a === 'full' || a === 'edit';
}

/** Acceso que permite comentar (y sugerir). */
export function canCommentAccess(a: string | null | undefined): boolean {
  return roleRank(a) >= RANK.comment;
}

/** Acceso que permite administrar quién entra a la página. */
export function canShareAccess(a: string | null | undefined): boolean {
  return a === 'owner' || a === 'full';
}

// ---------- Ajustes del workspace ----------

export interface DocsSettings {
  /** Rol de los miembros (no admins) en las páginas del workspace. */
  member_role: DocsRole;
  /** Exportar a Markdown/PDF: si no, solo admins. */
  allow_export: boolean;
  /** Publicar en el centro de ayuda: si no, solo admins. */
  allow_publish: boolean;
  /** Invitar personas de afuera por email. */
  allow_guests: boolean;
}

export const DEFAULT_DOCS_SETTINGS: DocsSettings = {
  member_role: 'full',
  allow_export: true,
  allow_publish: true,
  allow_guests: true,
};

export async function getDocsSettings(workspaceId: string): Promise<DocsSettings> {
  const row = (await getDb().prepare('SELECT * FROM docs_settings WHERE workspace_id = ?').get(workspaceId)) as
    | { member_role: string; allow_export: number; allow_publish: number; allow_guests: number }
    | undefined;
  if (!row) return { ...DEFAULT_DOCS_SETTINGS };
  return {
    member_role: normalizeDocsRole(row.member_role, 'full'),
    allow_export: row.allow_export !== 0,
    allow_publish: row.allow_publish !== 0,
    allow_guests: row.allow_guests !== 0,
  };
}

export async function updateDocsSettings(workspaceId: string, patch: Partial<DocsSettings>): Promise<DocsSettings> {
  const next = { ...(await getDocsSettings(workspaceId)), ...patch };
  await getDb()
    .prepare(
      `INSERT INTO docs_settings (workspace_id, member_role, allow_export, allow_publish, allow_guests, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET member_role = excluded.member_role, allow_export = excluded.allow_export,
         allow_publish = excluded.allow_publish, allow_guests = excluded.allow_guests, updated_at = excluded.updated_at`,
    )
    .run(
      workspaceId,
      next.member_role,
      next.allow_export ? 1 : 0,
      next.allow_publish ? 1 : 0,
      next.allow_guests ? 1 : 0,
      new Date().toISOString(),
    );
  return next;
}

// ---------- Teamspaces ----------

export type TeamspaceAccess = 'open' | 'closed' | 'private';

export interface DocsTeamspace {
  id: string;
  workspace_id: string;
  name: string;
  icon: string | null;
  description: string;
  access: TeamspaceAccess;
  /** Rol de los miembros del teamspace en sus páginas. */
  member_role: DocsRole;
  /**
   * La IA (bot de Chat y Agents) puede usar sus páginas como conocimiento.
   * Los abiertos siguen la regla del workspace; en cerrados y privados hay que
   * prenderlo a propósito.
   */
  ai_knowledge: boolean;
  /** Teamspace por defecto: todos los miembros del workspace son miembros (como "General" de Notion). */
  is_default: boolean;
  /** Borrado (cerrado o privado): sus páginas siguen en la papelera solo para sus miembros y los admins. */
  deleted_at?: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocsTeamspaceWithMe extends DocsTeamspace {
  /** Rol de quien mira (null = no es miembro). */
  my_role: 'owner' | 'member' | null;
  member_count: number;
}

export interface TeamspaceMember {
  user_id: string;
  role: 'owner' | 'member';
  name: string | null;
  email: string;
}

type TeamspaceRow = Omit<DocsTeamspace, 'access' | 'member_role' | 'ai_knowledge' | 'is_default'> & {
  access: string;
  member_role: string;
  ai_knowledge?: number;
  is_default?: number;
};

function toTeamspace(r: TeamspaceRow): DocsTeamspace {
  const access: TeamspaceAccess = r.access === 'closed' || r.access === 'private' ? r.access : 'open';
  return { ...r, access, member_role: normalizeDocsRole(r.member_role, 'edit'), ai_knowledge: r.ai_knowledge === 1, is_default: r.is_default === 1 };
}

export async function getTeamspace(id: string): Promise<DocsTeamspace | null> {
  const row = (await getDb().prepare('SELECT * FROM docs_teamspaces WHERE id = ?').get(id)) as TeamspaceRow | undefined;
  return row ? toTeamspace(row) : null;
}

/**
 * Rol de la persona en el teamspace. En el teamspace por defecto todos los
 * miembros del workspace son miembros (quien llama ya sabe que la persona
 * actúa en ese workspace).
 */
export async function teamspaceRoleOf(teamspaceId: string, userId: string): Promise<'owner' | 'member' | null> {
  const row = (await getDb()
    .prepare('SELECT role FROM docs_teamspace_members WHERE teamspace_id = ? AND user_id = ?')
    .get(teamspaceId, userId)) as { role: string } | undefined;
  if (row) return row.role === 'owner' ? 'owner' : 'member';
  const ts = (await getDb().prepare('SELECT is_default FROM docs_teamspaces WHERE id = ?').get(teamspaceId)) as
    | { is_default: number }
    | undefined;
  return ts?.is_default === 1 ? 'member' : null;
}

/**
 * Teamspaces del workspace que la persona puede ver en la lista: abiertos y
 * cerrados siempre; privados solo si es miembro.
 */
export async function listTeamspaces(workspaceId: string, userId: string): Promise<DocsTeamspaceWithMe[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT t.*, m.role AS my_role, (SELECT COUNT(*) FROM docs_teamspace_members x WHERE x.teamspace_id = t.id) AS member_count
       FROM docs_teamspaces t
       LEFT JOIN docs_teamspace_members m ON m.teamspace_id = t.id AND m.user_id = ?
       WHERE t.workspace_id = ? AND t.deleted_at IS NULL
       ORDER BY t.name COLLATE NOCASE, t.created_at`,
    )
    .all(userId, workspaceId)) as Array<TeamspaceRow & { my_role: string | null; member_count: number }>;
  return rows
    .map((r) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { my_role, member_count, ...rest } = r;
      const ts = toTeamspace(rest);
      return {
        ...ts,
        my_role: my_role === 'owner' ? ('owner' as const) : my_role || ts.is_default ? ('member' as const) : null,
        member_count: Number(member_count ?? 0),
      };
    })
    .filter((t) => t.access !== 'private' || t.my_role !== null);
}

/** Teamspaces cuyas páginas la persona no puede ver (cerrados o privados sin ser miembro). */
export async function hiddenTeamspaceIds(workspaceId: string, userId: string): Promise<string[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT t.id FROM docs_teamspaces t
       WHERE t.workspace_id = ? AND t.access IN ('closed', 'private') AND t.is_default = 0
         AND NOT EXISTS (SELECT 1 FROM docs_teamspace_members m WHERE m.teamspace_id = t.id AND m.user_id = ?)`,
    )
    .all(workspaceId, userId)) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

/**
 * Conocimiento de la IA (bot de Chat, Agents): las páginas de teamspaces
 * cerrados o privados no entran salvo que el teamspace lo habilite
 * (ai_knowledge). Fragmento SQL sobre la columna teamspace_id de docs_pages.
 */
export function aiKnowledgeFilterSql(column = 'teamspace_id'): string {
  return ` AND (${column} IS NULL OR ${column} IN (SELECT id FROM docs_teamspaces WHERE access = 'open' OR ai_knowledge = 1))`;
}

/** Fragmento SQL que deja afuera las páginas de esos teamspaces. */
export function teamspaceFilterSql(hidden: string[] | undefined, column = 'teamspace_id'): { sql: string; args: string[] } {
  if (!hidden || hidden.length === 0) return { sql: '', args: [] };
  return { sql: ` AND (${column} IS NULL OR ${column} NOT IN (${hidden.map(() => '?').join(',')}))`, args: hidden };
}

export class TeamspaceLimitError extends Error {
  constructor() {
    super('teamspace_limit');
  }
}

export const TEAMSPACES_MAX = 50;

export async function createTeamspace(
  workspaceId: string,
  createdBy: string,
  input: {
    name: string;
    icon?: string | null;
    description?: string;
    access?: TeamspaceAccess;
    member_role?: DocsRole;
    ai_knowledge?: boolean;
    is_default?: boolean;
  },
): Promise<DocsTeamspace> {
  const count = (await getDb()
    .prepare('SELECT COUNT(*) AS n FROM docs_teamspaces WHERE workspace_id = ? AND deleted_at IS NULL')
    .get(workspaceId)) as { n: number };
  if (Number(count.n) >= TEAMSPACES_MAX) throw new TeamspaceLimitError();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await getDb()
    .prepare(
      `INSERT INTO docs_teamspaces (id, workspace_id, name, icon, description, access, member_role, ai_knowledge, is_default, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    )
    .run(
      id,
      workspaceId,
      input.name.trim().slice(0, 120),
      input.icon ?? null,
      (input.description ?? '').trim().slice(0, 500),
      input.access ?? 'open',
      input.member_role ?? 'edit',
      input.ai_knowledge ? 1 : 0,
      createdBy,
      now,
      now,
    );
  if (input.is_default) await updateTeamspace(id, { is_default: true });
  await getDb()
    .prepare("INSERT OR IGNORE INTO docs_teamspace_members (teamspace_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)")
    .run(id, createdBy, now);
  return (await getTeamspace(id))!;
}

export async function updateTeamspace(
  id: string,
  patch: Partial<Pick<DocsTeamspace, 'name' | 'icon' | 'description' | 'access' | 'member_role' | 'ai_knowledge' | 'is_default'>>,
): Promise<DocsTeamspace | null> {
  const sets: string[] = [];
  const args: Array<string | number | null> = [];
  if (patch.ai_knowledge !== undefined) {
    sets.push('ai_knowledge = ?');
    args.push(patch.ai_knowledge ? 1 : 0);
  }
  if (patch.is_default !== undefined) {
    // Uno solo por workspace.
    if (patch.is_default) {
      const ts = await getTeamspace(id);
      if (ts) await getDb().prepare('UPDATE docs_teamspaces SET is_default = 0 WHERE workspace_id = ? AND id != ?').run(ts.workspace_id, id);
    }
    sets.push('is_default = ?');
    args.push(patch.is_default ? 1 : 0);
  }
  if (patch.name !== undefined) {
    sets.push('name = ?');
    args.push(patch.name.trim().slice(0, 120));
  }
  if (patch.icon !== undefined) {
    sets.push('icon = ?');
    args.push(patch.icon);
  }
  if (patch.description !== undefined) {
    sets.push('description = ?');
    args.push(patch.description.trim().slice(0, 500));
  }
  if (patch.access !== undefined) {
    sets.push('access = ?');
    args.push(patch.access);
  }
  if (patch.member_role !== undefined) {
    sets.push('member_role = ?');
    args.push(patch.member_role);
  }
  if (sets.length) {
    sets.push('updated_at = ?');
    args.push(new Date().toISOString());
    await getDb().prepare(`UPDATE docs_teamspaces SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
  }
  return getTeamspace(id);
}

/**
 * Borra el teamspace. Abierto: sus páginas quedan en el workspace (ya las veía
 * todo el workspace). Cerrado o privado: sus páginas van a la papelera y siguen
 * siendo del teamspace (borrado), así solo las ven y restauran sus miembros y
 * los admins: nunca quedan expuestas a todo el workspace.
 */
export async function deleteTeamspace(id: string): Promise<'workspace' | 'trash' | null> {
  const ts = await getTeamspace(id);
  if (!ts || ts.deleted_at) return null;
  const db = getDb();
  if (ts.access === 'open' || ts.is_default) {
    await db.prepare('UPDATE docs_pages SET teamspace_id = NULL WHERE teamspace_id = ?').run(id);
    await db.prepare('DELETE FROM docs_teamspaces WHERE id = ?').run(id);
    return 'workspace';
  }
  const now = new Date().toISOString();
  await db.prepare('UPDATE docs_pages SET archived = 1, archived_by_parent = 0 WHERE teamspace_id = ? AND archived = 0').run(id);
  await db.prepare('UPDATE docs_teamspaces SET deleted_at = ?, is_default = 0, updated_at = ? WHERE id = ?').run(now, now, id);
  return 'trash';
}

export async function listTeamspaceMembers(id: string): Promise<TeamspaceMember[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT m.user_id, m.role, u.name, u.email FROM docs_teamspace_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.teamspace_id = ? ORDER BY m.role = 'owner' DESC, u.name COLLATE NOCASE`,
    )
    .all(id)) as Array<{ user_id: string; role: string; name: string | null; email: string }>;
  return rows.map((r) => ({ ...r, role: r.role === 'owner' ? 'owner' : 'member' }));
}

export async function setTeamspaceMember(id: string, userId: string, role: 'owner' | 'member'): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO docs_teamspace_members (teamspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(teamspace_id, user_id) DO UPDATE SET role = excluded.role`,
    )
    .run(id, userId, role, new Date().toISOString());
}

/** Saca a alguien del teamspace (el último owner no se puede ir). */
export async function removeTeamspaceMember(id: string, userId: string): Promise<'ok' | 'last_owner' | 'not_found'> {
  const role = await teamspaceRoleOf(id, userId);
  if (!role) return 'not_found';
  if (role === 'owner') {
    const owners = (await getDb()
      .prepare("SELECT COUNT(*) AS n FROM docs_teamspace_members WHERE teamspace_id = ? AND role = 'owner'")
      .get(id)) as { n: number };
    if (Number(owners.n) <= 1) return 'last_owner';
  }
  await getDb().prepare('DELETE FROM docs_teamspace_members WHERE teamspace_id = ? AND user_id = ?').run(id, userId);
  return 'ok';
}

/** Mueve una página (y todo su subárbol) a un teamspace o a "Workspace" (null). */
export async function setSubtreeTeamspace(workspaceId: string, ids: string[], teamspaceId: string | null): Promise<void> {
  if (ids.length === 0) return;
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    await getDb()
      .prepare(`UPDATE docs_pages SET teamspace_id = ? WHERE user_id = ? AND id IN (${chunk.map(() => '?').join(',')})`)
      .run(teamspaceId, workspaceId, ...chunk);
  }
}
