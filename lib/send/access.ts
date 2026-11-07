/**
 * Send: qué puede publicar un link hoy. Un link no sirve más de lo que ve quien lo
 * armó, y deja de servir si esa persona se fue, perdió la app o pasó a guest. Se mira
 * en cada pedido. Server-only.
 */
import { getDb } from '../db';
import { canUseApp } from '../workspace';
import { createNotification } from '../notifications';
import { localized } from '../notification-copy';

export type CreatorRole = 'admin' | 'member' | 'none';
export type LinkProblem = 'creator_left' | 'creator_no_access' | 'document_private' | 'space_nothing_visible';

export interface CreatorAccess {
  role: CreatorRole;
  problem: LinkProblem | null;
}

/** Con varias filas (más de un equipo del mismo owner) vale la de más acceso; sin filas, se fue. */
export async function creatorAccess(workspaceId: string, userId: string): Promise<CreatorAccess> {
  if (userId === workspaceId) return { role: 'admin', problem: null };
  const rows = (await getDb()
    .prepare('SELECT m.role, m.apps FROM team_members m JOIN teams t ON t.id = m.team_id WHERE t.owner_id = ? AND m.user_id = ? ORDER BY t.created_at, t.id')
    .all(workspaceId, userId)) as Array<{ role: string; apps: string | null }>;
  if (!rows.length) return { role: 'none', problem: 'creator_left' };
  let best: CreatorRole = 'none';
  for (const r of rows) {
    if (!canUseApp({ role: r.role, apps: r.apps }, 'send')) continue;
    if (r.role === 'admin' || r.role === 'owner') return { role: 'admin', problem: null };
    best = 'member';
  }
  return best === 'none' ? { role: 'none', problem: 'creator_no_access' } : { role: best, problem: null };
}

interface LinkLike {
  workspace_id: string;
  created_by: string;
  transferred_from?: string | null;
  document_id: string | null;
  space_id: string | null;
}

/**
 * ¿Este autor puede servir este documento? Un link que pasó al owner cuando su autor se
 * fue sigue sirviendo solo lo compartido: pasar de dueño no publica lo privado.
 */
export function creatorSees(link: LinkLike, role: CreatorRole, doc: { owner_id: string; sharing: string }): boolean {
  if (role === 'none') return false;
  if (link.transferred_from) return doc.sharing === 'workspace';
  return role === 'admin' || doc.owner_id === link.created_by || doc.sharing === 'workspace';
}

/** Por qué un link activo no está sirviendo nada; null si está bien (o todavía no hay versión lista). */
export async function linkProblem(link: LinkLike): Promise<LinkProblem | null> {
  const access = await creatorAccess(link.workspace_id, link.created_by);
  if (access.problem) return access.problem;
  const db = getDb();
  if (link.document_id) {
    const doc = (await db.prepare('SELECT owner_id, sharing FROM send_documents WHERE id = ? AND deleted_at IS NULL').get(link.document_id)) as { owner_id: string; sharing: string } | undefined;
    return doc && !creatorSees(link, access.role, doc) ? 'document_private' : null;
  }
  const docs = (await db
    .prepare('SELECT d.owner_id, d.sharing FROM send_space_items i JOIN send_documents d ON d.id = i.document_id AND d.deleted_at IS NULL WHERE i.space_id = ?')
    .all(link.space_id)) as Array<{ owner_id: string; sharing: string }>;
  return docs.length && !docs.some((d) => creatorSees(link, access.role, d)) ? 'space_nothing_visible' : null;
}

/** Quién recibe un aviso: los que siguen en el workspace; por los que se fueron, el owner. */
export async function activeRecipients(workspaceId: string, ids: string[]): Promise<string[]> {
  const out = new Set<string>();
  for (const id of ids) {
    const a = await creatorAccess(workspaceId, id);
    out.add(a.role === 'none' ? workspaceId : id);
  }
  return [...out];
}

/**
 * Alguien se fue (o pasó a guest): sus links pasan al owner. Siguen andando sobre lo
 * compartido; sobre lo privado se frenan y el panel dice por qué. El owner recibe un aviso.
 */
export async function transferLinksOfRemoved(e: { ownerId: string; userId: string }): Promise<{ moved: number; stopped: number }> {
  if (e.userId === e.ownerId) return { moved: 0, stopped: 0 };
  const db = getDb();
  const rows = (await db
    .prepare('SELECT id, workspace_id, created_by, transferred_from, document_id, space_id FROM send_links WHERE workspace_id = ? AND created_by = ? AND deleted_at IS NULL')
    .all(e.ownerId, e.userId)) as Array<LinkLike & { id: string }>;
  if (!rows.length) return { moved: 0, stopped: 0 };
  let stopped = 0;
  for (const r of rows) {
    const res = await db.prepare('UPDATE send_links SET created_by = ?, transferred_from = ?, updated_at = ? WHERE id = ? AND created_by = ?').run(e.ownerId, e.userId, new Date().toISOString(), r.id, e.userId);
    if (!res.changes) continue;
    if (await linkProblem({ ...r, created_by: e.ownerId, transferred_from: e.userId })) stopped++;
  }
  const person = (await db.prepare('SELECT name, email FROM users WHERE id = ?').get(e.userId)) as { name: string | null; email: string | null } | undefined;
  await createNotification({
    userId: e.ownerId,
    type: 'send_activity',
    title: localized('sendLinksTransferred', { who: person?.name || person?.email || null, count: rows.length }),
    body: stopped ? localized('sendLinksStopped', { count: stopped }) : undefined,
    href: '/app/send',
    sourceType: 'send_person',
    sourceId: e.userId,
  }).catch(() => undefined);
  return { moved: rows.length, stopped };
}
