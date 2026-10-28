/**
 * Workspace: el equipo que funciona en todas las apps.
 *
 * - La clave de los datos sigue siendo el id del owner: crm_*.user_id,
 *   docs_pages.user_id, track_projects.owner_id, chat_widgets.user_id…
 *   Un miembro que entra al workspace opera "como" el owner (lib/session.ts):
 *   ve y edita lo mismo en todas las apps a las que tiene acceso.
 * - `teams` es la ficha del workspace (nombre, logo, slug, modo). La ficha de
 *   un owner es su equipo más viejo; si no tenía, se crea `ws_<owner>`.
 *   `keyed_by`: los equipos de antes de 128 son 'team' (Track y Chat cuelgan
 *   del id del equipo, como siempre); las fichas nuevas son 'owner'.
 * - `team_members`: owner, admin, member o guest, con acceso por app
 *   (`apps`: '*' o JSON ["crm","docs"]). Un guest no entra al workspace: solo
 *   ve lo que le comparten por recurso, con su propia identidad.
 * - Los subequipos viven en lib/workspace-groups.ts.
 */
import { getDb, type Db, type TeamRow, type UserRow } from './db';
import { isProductKey, PRODUCT_CONFIG, type ProductKey } from './products';
import { normalizeWorkspaceMode, WORKSPACE_SIZES_LIST, type WorkspaceMode } from './workspace-mode';
import { slugifyName } from './schema/workspace-migrations';

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'guest';

// ---------- Acceso por app ----------

/** '*' = todas las apps; si no, la lista de apps habilitadas. */
export type AppAccess = '*' | ProductKey[];

export function parseApps(raw: unknown): AppAccess {
  if (raw == null || raw === '' || raw === '*') return '*';
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return '*';
    }
  }
  if (!Array.isArray(value)) return '*';
  if (value.includes('*')) return '*';
  return [...new Set(value.filter((v): v is ProductKey => typeof v === 'string' && isProductKey(v)))];
}

export function serializeApps(apps: AppAccess | readonly string[] | null | undefined): string {
  if (apps == null || apps === '*') return '*';
  const parsed = parseApps([...apps]);
  return parsed === '*' ? '*' : JSON.stringify(parsed);
}

/** ¿La persona puede usar la app en el workspace? Owner siempre; guest nunca; admin y member según `apps`. */
export function canUseApp(access: { role?: string | null; apps?: AppAccess | string | null }, app: ProductKey): boolean {
  const role = access.role ?? 'owner';
  if (role === 'owner') return true;
  if (role === 'guest') return false;
  const apps = typeof access.apps === 'string' || access.apps == null ? parseApps(access.apps) : access.apps;
  return apps === '*' || apps.includes(app);
}

/** ¿La sesión puede usar la app en el workspace activo? (rol y apps de la sesión). */
export function userCanUseApp(user: { role?: string | null; apps?: AppAccess | string | null }, app: ProductKey): boolean {
  return canUseApp({ role: user.role ?? 'owner', apps: user.apps ?? '*' }, app);
}

/** Tiene todas las apps (owner o '*'): lo piden los ajustes que cruzan apps, como los webhooks. */
export function hasAllApps(user: { role?: string | null; apps?: AppAccess | string | null }): boolean {
  return user.role === 'owner' || user.apps == null || user.apps === '*';
}

/** Segmento de ruta (/app/<x> o /api/<x>) → app. */
const PATH_APPS: Record<string, ProductKey> = (() => {
  const out: Record<string, ProductKey> = {};
  for (const key of Object.keys(PRODUCT_CONFIG) as ProductKey[]) out[PRODUCT_CONFIG[key].path] = key;
  // Familias de API con otro nombre que su página.
  out.boards = 'board';
  out.link = 'link';
  return out;
})();

/** App de un path de página (/<locale>/app/<x>/…, /app/<x>/…) o de API (/api/<x>/…). null si no es de una app. */
export function appFromPath(path: string | null | undefined): ProductKey | null {
  if (!path) return null;
  const clean = path.split(/[?#]/)[0];
  const page = /^(?:\/(?:en|es|pt))?\/app\/([^/]+)/.exec(clean);
  const api = /^\/api\/([^/]+)/.exec(clean);
  const seg = page?.[1] ?? api?.[1];
  return seg ? (PATH_APPS[seg] ?? null) : null;
}

// ---------- Ficha ----------

/** Equipo/ficha del workspace activo de una sesión (el que se gestiona en Ajustes › Miembros). */
export function workspaceTeamId(user: { workspace?: { id: string } | null; team?: { id: string } | null }): string | null {
  return user.workspace?.id ?? user.team?.id ?? null;
}

export function fichaId(ownerId: string): string {
  return `ws_${ownerId}`;
}

/** Ficha del workspace del owner: su equipo más viejo (null si todavía no hay). */
export async function getWorkspace(ownerId: string, db: Db = getDb()): Promise<TeamRow | null> {
  const row = (await db
    .prepare('SELECT * FROM teams WHERE owner_id = ? ORDER BY created_at ASC, id ASC LIMIT 1')
    .get(ownerId)) as TeamRow | undefined;
  return row ?? null;
}

function defaultName(user: { name?: string | null; email?: string | null } | undefined): string {
  const name = user?.name?.trim();
  if (name) return name.slice(0, 80);
  const email = user?.email ?? '';
  return (email.includes('@') ? email.slice(0, email.indexOf('@')) : email).slice(0, 80) || 'Workspace';
}

/**
 * Ficha del workspace, creándola si falta (usuarios nuevos). Idempotente y
 * segura en paralelo: el id es determinístico (ws_<owner>).
 */
export async function ensureWorkspace(ownerId: string, db: Db = getDb()): Promise<TeamRow> {
  const existing = await getWorkspace(ownerId, db);
  if (existing) return existing;
  const owner = (await db.prepare('SELECT name, email FROM users WHERE id = ?').get(ownerId)) as
    | { name: string | null; email: string }
    | undefined;
  await db
    .prepare("INSERT OR IGNORE INTO teams (id, name, owner_id, keyed_by) VALUES (?, ?, ?, 'owner')")
    .run(fichaId(ownerId), defaultName(owner), ownerId);
  const row = (await getWorkspace(ownerId, db))!;
  await db.prepare("INSERT OR IGNORE INTO team_members (team_id, user_id, role) VALUES (?, ?, 'owner')").run(row.id, ownerId);
  return row;
}

export function workspaceModeOf(team: Pick<TeamRow, 'use_mode'> | null | undefined): WorkspaceMode {
  return normalizeWorkspaceMode(team?.use_mode);
}

/** ¿Los datos de Track/Chat de este equipo cuelgan del id del equipo (equipos de antes de 128)? */
export function teamKeyed(team: Pick<TeamRow, 'keyed_by'> | null | undefined): boolean {
  return team?.keyed_by === 'team';
}

export function parseDomains(raw: unknown): string[] {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v.filter((d): d is string => typeof d === 'string' && d.length > 0) : [];
  } catch {
    return [];
  }
}

/** Dominios de email públicos: no sirven para "unirse por dominio". */
const PUBLIC_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'yahoo.com.ar',
  'yahoo.com.br',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'yandex.com',
  'zoho.com',
  'mail.com',
  'hotmail.com.ar',
  'outlook.com.br',
  'bol.com.br',
  'uol.com.br',
  'test.local',
]);

export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at > 0 ? email.slice(at + 1).trim().toLowerCase() : '';
}

export function normalizeDomain(raw: string): string | null {
  const d = raw.trim().toLowerCase().replace(/^@/, '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) || d.length > 120) return null;
  return d;
}

export function isPublicDomain(domain: string): boolean {
  return PUBLIC_DOMAINS.has(domain.toLowerCase());
}

/** Slug del workspace: minúsculas, números y guiones. null si no sirve. */
export function normalizeSlug(raw: string): string | null {
  const s = slugifyName(raw, '');
  return s.length >= 2 ? s : null;
}

/** Sin caracteres de control ni saltos de línea (nombres que van a asuntos de email y títulos). */
export function cleanLine(raw: string, max = 80): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Ingreso por dominio: rol member, apps elegidas y, si se pide, aprobación de un admin. */
export interface JoinSettings {
  apps: AppAccess;
  approval: boolean;
}

export function joinSettings(team: Pick<TeamRow, 'settings'> | null | undefined): JoinSettings {
  try {
    const s = JSON.parse(team?.settings ?? '{}') as { joinApps?: unknown; joinApproval?: unknown };
    return { apps: parseApps(s.joinApps ?? '*'), approval: s.joinApproval === true };
  } catch {
    return { apps: '*', approval: false };
  }
}

export interface WorkspacePatch {
  name?: string;
  logoUrl?: string | null;
  slug?: string | null;
  mode?: WorkspaceMode;
  size?: string | null;
  allowedDomains?: string[];
  /** Quien carga los dominios: solo puede habilitar el de su propio email (verificado por Google). */
  editorEmail?: string;
  joinApps?: AppAccess | string[];
  joinApproval?: boolean;
}

export const WORKSPACE_SIZES = WORKSPACE_SIZES_LIST;

/**
 * Cambia la ficha. Devuelve el error de validación ('slug_taken',
 * 'invalid_slug', 'invalid_domain', 'public_domain') o null.
 */
export async function updateWorkspace(teamId: string, patch: WorkspacePatch, db: Db = getDb()): Promise<string | null> {
  const sets: string[] = [];
  const args: Array<string | null> = [];
  if (patch.name !== undefined) {
    const name = cleanLine(patch.name);
    if (!name) return 'invalid_name';
    sets.push('name = ?');
    args.push(name);
  }
  if (patch.logoUrl !== undefined) {
    const url = patch.logoUrl?.trim() || null;
    if (url && !/^(https:\/\/|\/uploads\/workspace\/)/.test(url)) return 'invalid_logo';
    sets.push('logo_url = ?');
    args.push(url ? url.slice(0, 500) : null);
  }
  if (patch.slug !== undefined) {
    if (patch.slug === null || patch.slug === '') {
      sets.push('slug = NULL');
    } else {
      const slug = normalizeSlug(patch.slug);
      if (!slug) return 'invalid_slug';
      const taken = await db.prepare('SELECT 1 AS x FROM teams WHERE slug = ? AND id != ?').get(slug, teamId);
      if (taken) return 'slug_taken';
      sets.push('slug = ?');
      args.push(slug);
    }
  }
  if (patch.mode !== undefined) {
    sets.push('use_mode = ?');
    args.push(normalizeWorkspaceMode(patch.mode));
  }
  if (patch.size !== undefined) {
    sets.push('size = ?');
    args.push(patch.size && (WORKSPACE_SIZES as readonly string[]).includes(patch.size) ? patch.size : null);
  }
  if (patch.allowedDomains !== undefined) {
    // Cada admin habilita el dominio de su propio email; los que ya estaban (de otros admins) se conservan.
    const current = parseDomains(((await db.prepare('SELECT allowed_domains FROM teams WHERE id = ?').get(teamId)) as { allowed_domains?: string } | undefined)?.allowed_domains);
    const out: string[] = [];
    for (const raw of patch.allowedDomains.slice(0, 10)) {
      const d = normalizeDomain(raw);
      if (!d) return 'invalid_domain';
      if (isPublicDomain(d)) return 'public_domain';
      // Solo el dominio del email con el que entra quien lo carga (Google lo verificó).
      if (patch.editorEmail !== undefined && !current.includes(d) && emailDomain(patch.editorEmail) !== d) return 'domain_not_yours';
      if (!out.includes(d)) out.push(d);
    }
    sets.push('allowed_domains = ?');
    args.push(JSON.stringify(out));
  }
  if (patch.joinApps !== undefined || patch.joinApproval !== undefined) {
    const row = (await db.prepare('SELECT settings FROM teams WHERE id = ?').get(teamId)) as { settings?: string } | undefined;
    let cur: Record<string, unknown> = {};
    try {
      cur = JSON.parse(row?.settings ?? '{}') as Record<string, unknown>;
    } catch {
      cur = {};
    }
    if (patch.joinApps !== undefined) cur.joinApps = serializeApps(patch.joinApps as AppAccess);
    if (patch.joinApproval !== undefined) cur.joinApproval = patch.joinApproval === true;
    sets.push('settings = ?');
    args.push(JSON.stringify(cur));
  }
  if (!sets.length) return null;
  sets.push("updated_at = datetime('now')");
  await db.prepare(`UPDATE teams SET ${sets.join(', ')} WHERE id = ?`).run(...args, teamId);
  return null;
}

// ---------- Personas ----------

export interface WorkspaceMember {
  user_id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: WorkspaceRole;
  apps: AppAccess;
  title: string;
  created_at: string;
}

export function normalizeWorkspaceRole(raw: unknown): WorkspaceRole {
  return raw === 'owner' || raw === 'admin' || raw === 'guest' ? raw : 'member';
}

/**
 * Personas de un equipo/ficha: el owner primero y después los miembros por
 * antigüedad. Sin guests salvo `includeGuests`; con `app`, solo quienes
 * pueden usar esa app (pools de Chat, hosts de Cal…).
 */
export async function listTeamPeople(
  team: Pick<TeamRow, 'id' | 'owner_id'>,
  opts: { includeGuests?: boolean; app?: ProductKey } = {},
  db: Db = getDb(),
): Promise<WorkspaceMember[]> {
  const rows = (await db
    .prepare(
      `SELECT u.id AS user_id, u.email, u.name, u.image, m.role, m.apps, m.title, m.created_at
       FROM team_members m JOIN users u ON u.id = m.user_id
       WHERE m.team_id = ?
       ORDER BY m.created_at ASC, u.email ASC`,
    )
    .all(team.id)) as Array<Record<string, unknown>>;
  const out: WorkspaceMember[] = [];
  const owner = (await db.prepare('SELECT id, email, name, image, created_at FROM users WHERE id = ?').get(team.owner_id)) as
    | { id: string; email: string; name: string | null; image: string | null; created_at: string }
    | undefined;
  if (owner) {
    const own = rows.find((r) => r.user_id === owner.id);
    out.push({
      user_id: owner.id,
      email: owner.email,
      name: owner.name,
      image: owner.image,
      role: 'owner',
      apps: '*',
      title: String(own?.title ?? ''),
      created_at: String(own?.created_at ?? owner.created_at ?? ''),
    });
  }
  for (const r of rows) {
    const id = String(r.user_id);
    if (id === team.owner_id) continue;
    const role = normalizeWorkspaceRole(r.role);
    if (role === 'guest' && !opts.includeGuests) continue;
    const member: WorkspaceMember = {
      user_id: id,
      email: String(r.email),
      name: (r.name as string | null) ?? null,
      image: (r.image as string | null) ?? null,
      role: role === 'owner' ? 'admin' : role,
      apps: parseApps(r.apps),
      title: String(r.title ?? ''),
      created_at: String(r.created_at ?? ''),
    };
    if (opts.app && !canUseApp(member, opts.app)) continue;
    out.push(member);
  }
  return out;
}

/** Membresía de la persona en el equipo (null = no es parte). */
export async function getMembership(
  team: Pick<TeamRow, 'id' | 'owner_id'>,
  personId: string,
  db: Db = getDb(),
): Promise<{ role: WorkspaceRole; apps: AppAccess } | null> {
  if (team.owner_id === personId) return { role: 'owner', apps: '*' };
  const row = (await db.prepare('SELECT role, apps FROM team_members WHERE team_id = ? AND user_id = ?').get(team.id, personId)) as
    | { role: string; apps: string }
    | undefined;
  if (!row) return null;
  const role = normalizeWorkspaceRole(row.role);
  return { role: role === 'owner' ? 'admin' : role, apps: parseApps(row.apps) };
}

/**
 * Condición SQL: `personExpr` es persona (no guest) de algún equipo del owner
 * `ownerExpr`. Las expresiones son columnas o `?` (los args van en orden).
 */
export function workspaceMemberSql(ownerExpr: string, personExpr: string): string {
  return `(${personExpr} = ${ownerExpr} OR EXISTS (
    SELECT 1 FROM team_members wm JOIN teams wt ON wt.id = wm.team_id
    WHERE wt.owner_id = ${ownerExpr} AND wm.user_id = ${personExpr} AND wm.role != 'guest'))`;
}

// ---------- Espacio del owner (datos bajo su id) ----------

/**
 * Condición SQL: `personExpr` trabaja con los datos que cuelgan del id del
 * owner `ownerExpr` (no de un equipo de antes de 128): es el owner o un
 * miembro (no guest) de una ficha `keyed_by = 'owner'`. Es lo que Track y
 * Chat llamaban "personal" (team_id NULL), que ahora se comparte con el
 * equipo del workspace.
 */
export function ownerSpaceSql(ownerExpr: string, personExpr: string): string {
  return `(${personExpr} = ${ownerExpr} OR EXISTS (
    SELECT 1 FROM team_members om JOIN teams ot ON ot.id = om.team_id
    WHERE ot.owner_id = ${ownerExpr} AND ot.keyed_by = 'owner' AND om.user_id = ${personExpr} AND om.role != 'guest'))`;
}

export interface SpacePerson {
  id: string;
  email: string;
  name: string | null;
  role: WorkspaceRole;
}

/**
 * Personas del espacio del owner (ver ownerSpaceSql): el owner primero. Con
 * `app`, solo quienes tienen esa app (pools de Chat, hosts de Cal…).
 */
export async function listOwnerSpacePeople(ownerId: string, opts: { app?: ProductKey } = {}, db: Db = getDb()): Promise<SpacePerson[]> {
  const rows = (await db
    .prepare(
      `SELECT u.id, u.email, u.name,
              CASE WHEN u.id = ? THEN 'owner' WHEN EXISTS (
                SELECT 1 FROM team_members om JOIN teams ot ON ot.id = om.team_id
                WHERE ot.owner_id = ? AND ot.keyed_by = 'owner' AND om.user_id = u.id AND om.role = 'admin') THEN 'admin' ELSE 'member' END AS role,
              (SELECT om.apps FROM team_members om JOIN teams ot ON ot.id = om.team_id
               WHERE ot.owner_id = ? AND ot.keyed_by = 'owner' AND om.user_id = u.id AND om.role != 'guest'
               ORDER BY om.apps = '*' DESC LIMIT 1) AS apps
       FROM users u
       WHERE ${ownerSpaceSql('?', 'u.id')}
       ORDER BY u.id = ? DESC, u.name COLLATE NOCASE ASC, u.email ASC`,
    )
    .all(ownerId, ownerId, ownerId, ownerId, ownerId, ownerId)) as Array<{ id: string; email: string; name: string | null; role: string; apps: string | null }>;
  return rows
    .map((r) => ({ id: r.id, email: r.email, name: r.name, role: normalizeWorkspaceRole(r.role), apps: r.id === ownerId ? '*' : r.apps }))
    .filter((r) => !opts.app || canUseApp({ role: r.role, apps: r.apps }, opts.app))
    .map(({ id, email, name, role }) => ({ id, email, name, role }));
}

// ---------- Mis workspaces (switcher) ----------

export interface WorkspaceEntry {
  /** Lo que se manda a /api/teams/switch: null = el propio. */
  teamId: string | null;
  name: string;
  logoUrl: string | null;
  own: boolean;
  role: WorkspaceRole;
  mode: WorkspaceMode;
  /** Sin nombre propio: "Personal" (lo traduce la UI). */
  personal: boolean;
}

/**
 * Workspaces de la persona, en el orden del switcher: el propio primero
 * (y los equipos propios de antes de 128, que siguen aparte como siempre),
 * después los ajenos donde es miembro (no guest).
 */
export async function listMyWorkspaces(real: Pick<UserRow, 'id'>, db: Db = getDb()): Promise<WorkspaceEntry[]> {
  const ficha = await ensureWorkspace(real.id, db);
  const out: WorkspaceEntry[] = [];
  const own = (await db.prepare('SELECT * FROM teams WHERE owner_id = ? ORDER BY created_at ASC, id ASC').all(real.id)) as TeamRow[];
  if (teamKeyed(ficha)) {
    // Owner de antes de 128: su espacio personal y cada equipo, como hasta ahora.
    out.push({ teamId: null, name: '', logoUrl: null, own: true, role: 'owner', mode: 'personal', personal: true });
    for (const t of own) {
      out.push({ teamId: t.id, name: t.name, logoUrl: t.logo_url ?? null, own: true, role: 'owner', mode: workspaceModeOf(t), personal: false });
    }
  } else {
    out.push({
      teamId: null,
      name: ficha.name,
      logoUrl: ficha.logo_url ?? null,
      own: true,
      role: 'owner',
      mode: workspaceModeOf(ficha),
      personal: workspaceModeOf(ficha) === 'personal',
    });
    for (const t of own) {
      if (t.id === ficha.id) continue;
      out.push({ teamId: t.id, name: t.name, logoUrl: t.logo_url ?? null, own: true, role: 'owner', mode: workspaceModeOf(t), personal: false });
    }
  }
  const foreign = (await db
    .prepare(
      `SELECT t.*, m.role AS member_role FROM teams t JOIN team_members m ON m.team_id = t.id
       WHERE m.user_id = ? AND t.owner_id != ? AND m.role != 'guest'
       ORDER BY t.name COLLATE NOCASE ASC`,
    )
    .all(real.id, real.id)) as Array<TeamRow & { member_role: string }>;
  for (const t of foreign) {
    out.push({
      teamId: t.id,
      name: t.name,
      logoUrl: t.logo_url ?? null,
      own: false,
      role: normalizeWorkspaceRole(t.member_role),
      mode: workspaceModeOf(t),
      personal: false,
    });
  }
  return out;
}

/**
 * Workspaces a los que la persona puede sumarse por dominio de email
 * (allowed_domains), sin ser miembro todavía.
 */
export async function domainWorkspaces(real: Pick<UserRow, 'id' | 'email'>, db: Db = getDb()): Promise<TeamRow[]> {
  const domain = emailDomain(real.email);
  if (!domain || isPublicDomain(domain)) return [];
  const rows = (await db
    .prepare(
      `SELECT t.* FROM teams t, json_each(t.allowed_domains) d
       WHERE d.value = ? AND t.owner_id != ?
         AND NOT EXISTS (SELECT 1 FROM team_members m WHERE m.team_id = t.id AND m.user_id = ?)
       ORDER BY t.created_at ASC LIMIT 10`,
    )
    .all(domain, real.id, real.id)) as TeamRow[];
  return rows;
}
