/**
 * Track — proyectos privados e invitados (como los teams privados y los guests
 * de Linear). No hay un modelo de rol "guest" de la plataforma (lib/workspace.ts
 * no existe en main): vive acá, local a Track.
 *
 * - Un proyecto `visibility = 'private'` solo lo ven las personas de
 *   track_project_access. Los admins lo ven en Ajustes › Acceso y pueden
 *   sumarse, pero no ven sus issues hasta hacerlo.
 * - Un invitado (track_guests, por email, así se puede marcar antes de que
 *   acepte la invitación al workspace) solo ve los proyectos de su lista,
 *   privados o no. Todo lo demás de Track queda fuera de su alcance.
 *
 * Quién mira: dentro de `runAsTrackViewer` (API v1, MCP) manda esa persona;
 * si no, la sesión. Sin ninguna de las dos (cron, webhooks entrantes) es el
 * sistema y no se filtra: esos caminos ya validan el workspace.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { getDb } from './db';

/** Por dónde llega un cambio: queda en el audit log y evita ecos (Slack). */
export type TrackVia = 'app' | 'api' | 'mcp' | 'github' | 'slack' | 'sentry' | 'import' | 'system' | 'triage' | 'agent';

const viewerStore = new AsyncLocalStorage<{ personId: string; via: TrackVia }>();

/** Corre `fn` mirando Track como `personId` (la persona dueña de la API key, la de Slack…). */
export function runAsTrackViewer<T>(personId: string, fn: () => Promise<T>, via: TrackVia = 'api'): Promise<T> {
  return viewerStore.run({ personId, via }, fn);
}

/** Camino del request en curso ('app' si es la sesión). */
export function currentTrackVia(): TrackVia {
  return viewerStore.getStore()?.via ?? 'app';
}

/** Persona que mira Track en este request, o null si es el sistema. */
export async function currentTrackViewer(): Promise<string | null> {
  const stored = viewerStore.getStore();
  if (stored) return stored.personId;
  try {
    const { getCurrentUser, realUserId } = await import('./session');
    const user = await getCurrentUser();
    return user ? realUserId(user) : null;
  } catch {
    // Fuera de un request (cron): no hay cookies ni sesión.
    return null;
  }
}

/**
 * Condición SQL "el proyecto `alias` es visible para la persona". Usa 3
 * argumentos (el id de la persona tres veces). El alias es obligatorio: las
 * subconsultas usan json_each, que también tiene una columna `id`.
 */
export function trackVisibleSql(alias: string, personId: string): { sql: string; args: string[] } {
  return { sql: trackVisibleExpr(alias, '?'), args: [personId, personId, personId] };
}

/** Igual que trackVisibleSql pero con la persona como expresión SQL (p. ej. `u.id`). */
export function trackVisibleExpr(alias: string, person: string): string {
  const ws = `COALESCE(${alias}.team_id, ${alias}.owner_id)`;
  const email = `(SELECT lower(u0.email) FROM users u0 WHERE u0.id = ${person})`;
  return `(CASE WHEN EXISTS (SELECT 1 FROM track_guests g WHERE g.workspace_id = ${ws} AND g.email = ${email})
      THEN EXISTS (SELECT 1 FROM track_guests g2, json_each(g2.project_ids) j WHERE g2.workspace_id = ${ws} AND g2.email = ${email} AND j.value = ${alias}.id)
      ELSE (COALESCE(${alias}.visibility, 'workspace') <> 'private' OR EXISTS (SELECT 1 FROM track_project_access x WHERE x.project_id = ${alias}.id AND x.user_id = ${person}))
    END)`;
}

/**
 * Condición "proyecto visible" para quien mira ahora (sesión, API key, MCP).
 * Sin persona (cron) no filtra: el resto del where ya acota al workspace.
 */
export async function currentVisibleSql(alias: string): Promise<{ sql: string; args: string[] }> {
  const viewer = await currentTrackViewer();
  return viewer ? trackVisibleSql(alias, viewer) : { sql: '1 = 1', args: [] };
}

/** ¿La persona ve este proyecto? (ya se sabe que es de su workspace). */
export async function projectVisibleTo(projectId: string, personId: string): Promise<boolean> {
  const v = trackVisibleSql('p', personId);
  const row = await getDb()
    .prepare(`SELECT 1 AS ok FROM track_projects p WHERE p.id = ? AND ${v.sql}`)
    .get(projectId, ...v.args);
  return Boolean(row);
}

// ---------- Invitados ----------

export interface TrackGuest {
  email: string;
  userId: string | null;
  name: string | null;
  projectIds: string[];
  createdAt: string;
}

function parseIds(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function listGuests(workspaceId: string): Promise<TrackGuest[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT g.email, g.project_ids, g.created_at, u.id AS user_id, u.name
       FROM track_guests g LEFT JOIN users u ON lower(u.email) = g.email
       WHERE g.workspace_id = ? ORDER BY g.email`,
    )
    .all(workspaceId)) as Array<{ email: string; project_ids: string; created_at: string; user_id: string | null; name: string | null }>;
  return rows.map((r) => ({ email: r.email, userId: r.user_id, name: r.name, projectIds: parseIds(r.project_ids), createdAt: r.created_at }));
}

export async function isGuest(workspaceId: string, personId: string): Promise<boolean> {
  const row = await getDb()
    .prepare('SELECT 1 AS ok FROM track_guests g JOIN users u ON lower(u.email) = g.email WHERE g.workspace_id = ? AND u.id = ?')
    .get(workspaceId, personId);
  return Boolean(row);
}

/** Crea o reemplaza el invitado con esa lista de proyectos (solo del workspace). */
export async function setGuest(workspaceId: string, email: string, projectIds: string[], addedBy: string): Promise<TrackGuest> {
  const clean = email.trim().toLowerCase();
  const valid = projectIds.length
    ? ((await getDb()
        .prepare(
          `SELECT id FROM track_projects WHERE COALESCE(team_id, owner_id) = ? AND id IN (${projectIds.map(() => '?').join(',')})`,
        )
        .all(workspaceId, ...projectIds)) as Array<{ id: string }>).map((r) => r.id)
    : [];
  await getDb()
    .prepare(
      `INSERT INTO track_guests (workspace_id, email, project_ids, added_by) VALUES (?, ?, ?, ?)
       ON CONFLICT (workspace_id, email) DO UPDATE SET project_ids = excluded.project_ids`,
    )
    .run(workspaceId, clean, JSON.stringify(valid), addedBy);
  return (await listGuests(workspaceId)).find((g) => g.email === clean) as TrackGuest;
}

export async function removeGuest(workspaceId: string, email: string): Promise<boolean> {
  const res = await getDb()
    .prepare('DELETE FROM track_guests WHERE workspace_id = ? AND email = ?')
    .run(workspaceId, email.trim().toLowerCase());
  return res.changes > 0;
}

// ---------- Proyectos privados ----------

export interface ProjectAccessMember {
  userId: string;
  email: string;
  name: string | null;
}

export async function listProjectAccess(projectId: string): Promise<ProjectAccessMember[]> {
  return (await getDb()
    .prepare(
      `SELECT u.id AS userId, u.email, u.name FROM track_project_access a JOIN users u ON u.id = a.user_id
       WHERE a.project_id = ? ORDER BY u.name, u.email`,
    )
    .all(projectId)) as ProjectAccessMember[];
}

export async function addProjectAccess(projectId: string, userId: string, addedBy: string): Promise<void> {
  await getDb()
    .prepare('INSERT OR IGNORE INTO track_project_access (project_id, user_id, added_by) VALUES (?, ?, ?)')
    .run(projectId, userId, addedBy);
}

export async function removeProjectAccess(projectId: string, userId: string): Promise<boolean> {
  const res = await getDb()
    .prepare('DELETE FROM track_project_access WHERE project_id = ? AND user_id = ?')
    .run(projectId, userId);
  return res.changes > 0;
}

/**
 * Cambia la visibilidad. Al pasar a privado quien lo hace queda como miembro
 * y, como en Linear, los que no son miembros dejan de estar suscriptos a sus
 * issues (y de recibir sus avisos).
 */
export async function setProjectVisibility(
  projectId: string,
  visibility: 'workspace' | 'private',
  actorId: string,
): Promise<void> {
  const db = getDb();
  await db.prepare("UPDATE track_projects SET visibility = ?, updated_at = datetime('now') WHERE id = ?").run(visibility, projectId);
  if (visibility === 'private') {
    await addProjectAccess(projectId, actorId, actorId);
    await db
      .prepare(
        `DELETE FROM track_issue_subscriptions
         WHERE issue_id IN (SELECT id FROM track_issues WHERE project_id = ?)
           AND user_id NOT IN (SELECT user_id FROM track_project_access WHERE project_id = ?)`,
      )
      .run(projectId, projectId)
      .catch(() => undefined);
  }
}
