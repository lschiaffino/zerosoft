/**
 * Send: espacios (salas de datos). Varios documentos detrás de un link, con
 * números por documento y acceso por persona. Server-only.
 *
 * Acceso por persona (send_space_access): sin fila, el visitante ve lo que muestra
 * el link; con fila, solo esos documentos. Para que sirva de verdad, una fila se
 * aplica por el email de la sesión: un link con este acceso tiene que pedir email,
 * y verificado si lo que se oculta importa.
 */
import { getDb } from '../db';
import { normalizeEmail, newId, nowIso, LIVE_WINDOW_MS, SendError, completionPct, type SendActor } from './types';
import { csvLine } from '../form-engine';
import { canEditDocument, getDocument } from './core';

export interface SpaceRow {
  id: string;
  workspace_id: string;
  owner_id: string;
  title: string;
  description: string;
  sharing: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface SpaceItemDto {
  documentId: string;
  title: string;
  folder: string;
  kind: string | null;
  pageCount: number;
  ready: boolean;
}

const visibleSql = `(? = 1 OR s.owner_id = ? OR s.sharing = 'workspace')`;

export function canEditSpace(actor: SendActor, s: Pick<SpaceRow, 'owner_id'>): boolean {
  return actor.admin || s.owner_id === actor.person;
}

export async function getSpace(actor: SendActor, id: string): Promise<SpaceRow> {
  const row = (await getDb()
    .prepare(`SELECT s.* FROM send_spaces s WHERE s.id = ? AND s.workspace_id = ? AND s.deleted_at IS NULL AND ${visibleSql}`)
    .get(id, actor.ws, actor.admin ? 1 : 0, actor.person)) as SpaceRow | undefined;
  if (!row) throw new SendError('not_found', 404);
  return row;
}

async function requireEdit(actor: SendActor, id: string): Promise<SpaceRow> {
  const s = await getSpace(actor, id);
  if (!canEditSpace(actor, s)) throw new SendError('forbidden', 403);
  return s;
}

export interface SpaceListItem {
  id: string;
  title: string;
  documents: number;
  links: number;
  visits: number;
  updatedAt: string;
}

export async function listSpaces(actor: SendActor, q = ''): Promise<SpaceListItem[]> {
  const term = q.trim().slice(0, 100);
  const rows = (await getDb()
    .prepare(
      `SELECT s.id, s.title, s.updated_at,
         (SELECT COUNT(*) FROM send_space_items i WHERE i.space_id = s.id) AS documents,
         (SELECT COUNT(*) FROM send_links l WHERE l.space_id = s.id AND l.deleted_at IS NULL) AS links,
         (SELECT COUNT(*) FROM send_visits v JOIN send_links l ON l.id = v.link_id WHERE l.space_id = s.id) AS visits
       FROM send_spaces s
       WHERE s.workspace_id = ? AND s.deleted_at IS NULL AND ${visibleSql} AND (? = '' OR s.title LIKE ? ESCAPE '\\')
       ORDER BY s.updated_at DESC LIMIT 200`,
    )
    .all(actor.ws, actor.admin ? 1 : 0, actor.person, term, `%${term.replace(/[\\%_]/g, '\\$&')}%`)) as Array<{ id: string; title: string; updated_at: string; documents: number; links: number; visits: number }>;
  return rows.map((r) => ({ id: r.id, title: r.title, documents: Number(r.documents), links: Number(r.links), visits: Number(r.visits), updatedAt: r.updated_at }));
}

export async function createSpace(actor: SendActor, title: string): Promise<SpaceRow> {
  const id = newId('sp');
  const ts = nowIso();
  await getDb()
    .prepare('INSERT INTO send_spaces (id, workspace_id, owner_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, actor.ws, actor.person, title.trim().slice(0, 200) || 'Untitled', ts, ts);
  return (await getDb().prepare('SELECT * FROM send_spaces WHERE id = ?').get(id)) as SpaceRow;
}

export async function updateSpace(actor: SendActor, id: string, patch: { title?: string; description?: string; sharing?: 'private' | 'workspace' }): Promise<SpaceRow> {
  const s = await requireEdit(actor, id);
  const next = { title: patch.title?.trim().slice(0, 200) || s.title, description: patch.description !== undefined ? patch.description.slice(0, 2000) : s.description, sharing: patch.sharing ?? s.sharing };
  await getDb().prepare('UPDATE send_spaces SET title = ?, description = ?, sharing = ?, updated_at = ? WHERE id = ?').run(next.title, next.description, next.sharing, nowIso(), id);
  return { ...s, ...next };
}

/** Borra el espacio y sus links; los documentos siguen en Send. */
export async function deleteSpace(actor: SendActor, id: string): Promise<void> {
  await requireEdit(actor, id);
  const db = getDb();
  const ts = nowIso();
  await db.prepare('UPDATE send_spaces SET deleted_at = ? WHERE id = ?').run(ts, id);
  await db.prepare('UPDATE send_links SET deleted_at = ?, disabled_at = COALESCE(disabled_at, ?) WHERE space_id = ?').run(ts, ts, id);
  await db.prepare('DELETE FROM send_sessions WHERE link_id IN (SELECT id FROM send_links WHERE space_id = ?)').run(id);
  await db.prepare('DELETE FROM send_space_items WHERE space_id = ?').run(id);
  await db.prepare('DELETE FROM send_space_access WHERE space_id = ?').run(id);
}

export async function spaceItems(spaceId: string): Promise<SpaceItemDto[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT i.document_id, i.folder, d.title, v.kind, v.page_count, v.status FROM send_space_items i
       JOIN send_documents d ON d.id = i.document_id AND d.deleted_at IS NULL
       LEFT JOIN send_versions v ON v.id = d.current_version_id
       WHERE i.space_id = ? ORDER BY i.position, i.added_at`,
    )
    .all(spaceId)) as Array<{ document_id: string; folder: string; title: string; kind: string | null; page_count: number | null; status: string | null }>;
  return rows.map((r) => ({ documentId: r.document_id, title: r.title, folder: r.folder, kind: r.kind, pageCount: Number(r.page_count ?? 0), ready: r.status === 'ready' }));
}

/** Reemplaza los documentos del espacio (orden y carpeta). Solo entran documentos que la persona ve. */
export async function setSpaceItems(actor: SendActor, spaceId: string, items: Array<{ documentId: string; folder?: string }>): Promise<SpaceItemDto[]> {
  await requireEdit(actor, spaceId);
  const db = getDb();
  const seen = new Set<string>();
  const clean: Array<{ documentId: string; folder: string }> = [];
  for (const it of items) {
    if (seen.has(it.documentId)) continue;
    seen.add(it.documentId);
    await getDocument(actor, it.documentId);
    clean.push({ documentId: it.documentId, folder: (it.folder ?? '').trim().slice(0, 80) });
  }
  const ts = nowIso();
  await db.prepare('DELETE FROM send_space_items WHERE space_id = ?').run(spaceId);
  let pos = 0;
  for (const it of clean) {
    await db.prepare('INSERT INTO send_space_items (space_id, document_id, position, folder, added_at) VALUES (?, ?, ?, ?, ?)').run(spaceId, it.documentId, pos++, it.folder, ts);
  }
  await db.prepare('UPDATE send_spaces SET updated_at = ? WHERE id = ?').run(ts, spaceId);
  return spaceItems(spaceId);
}

export interface SpaceAccessDto {
  email: string;
  documentIds: string[];
}

export async function listSpaceAccess(spaceId: string): Promise<SpaceAccessDto[]> {
  const rows = (await getDb().prepare('SELECT email, document_ids FROM send_space_access WHERE space_id = ? ORDER BY email').all(spaceId)) as Array<{ email: string; document_ids: string }>;
  return rows.map((r) => ({ email: r.email, documentIds: JSON.parse(r.document_ids || '[]') as string[] }));
}

export async function setSpaceAccess(actor: SendActor, spaceId: string, rawEmail: string, documentIds: string[]): Promise<void> {
  await requireEdit(actor, spaceId);
  const email = normalizeEmail(rawEmail);
  if (!email) throw new SendError('invalid_email', 400);
  await getDb()
    .prepare('INSERT INTO send_space_access (space_id, email, document_ids, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (space_id, email) DO UPDATE SET document_ids = excluded.document_ids')
    .run(spaceId, email, JSON.stringify([...new Set(documentIds)].slice(0, 2000)), nowIso());
}

export async function removeSpaceAccess(actor: SendActor, spaceId: string, rawEmail: string): Promise<void> {
  await requireEdit(actor, spaceId);
  await getDb().prepare('DELETE FROM send_space_access WHERE space_id = ? AND email = ?').run(spaceId, rawEmail.trim().toLowerCase());
}

export interface SpaceAnalytics {
  totals: { visits: number; visitors: number; seconds: number; live: number; downloads: number };
  documents: Array<{ documentId: string; title: string; visits: number; visitors: number; seconds: number; avgCompletion: number; downloads: number }>;
  visitors: Array<{ key: string; email: string | null; verified: boolean; visits: number; seconds: number; documents: number; downloads: number; lastSeenAt: string }>;
  recent: Array<{ id: string; email: string | null; emailVerified: boolean; documentId: string; title: string; linkName: string; startedAt: string; seconds: number; completion: number }>;
}

export async function spaceAnalytics(spaceId: string): Promise<SpaceAnalytics> {
  const rows = (await getDb()
    .prepare(
      `SELECT v.id, v.document_id, v.session_id, v.visitor_id, v.email, v.email_verified, v.seconds, v.pages_seen, v.page_total, v.downloads, v.started_at, v.last_ping_at, l.name AS link_name, d.title
       FROM send_visits v JOIN send_links l ON l.id = v.link_id JOIN send_documents d ON d.id = v.document_id
       WHERE l.space_id = ? ORDER BY v.started_at DESC LIMIT 2000`,
    )
    .all(spaceId)) as Array<{ id: string; document_id: string; session_id: string; visitor_id: string | null; email: string | null; email_verified: number; seconds: number; pages_seen: number; page_total: number; downloads: number; started_at: string; last_ping_at: string; link_name: string | null; title: string }>;
  const docs = new Map<string, SpaceAnalytics['documents'][number] & { people: Set<string>; pct: number }>();
  const people = new Map<string, SpaceAnalytics['visitors'][number] & { docs: Set<string> }>();
  const liveSince = Date.now() - LIVE_WINDOW_MS;
  let seconds = 0;
  let downloads = 0;
  const live = new Set<string>();
  for (const r of rows) {
    const key = r.visitor_id ?? r.session_id;
    const sec = Number(r.seconds);
    const pct = completionPct(Number(r.pages_seen), Number(r.page_total));
    seconds += sec;
    downloads += Number(r.downloads);
    if (new Date(r.last_ping_at).getTime() >= liveSince) live.add(key);
    const d = docs.get(r.document_id) ?? { documentId: r.document_id, title: r.title, visits: 0, visitors: 0, seconds: 0, avgCompletion: 0, downloads: 0, people: new Set<string>(), pct: 0 };
    d.visits++;
    d.seconds += sec;
    d.pct += pct;
    d.downloads += Number(r.downloads);
    d.people.add(key);
    docs.set(r.document_id, d);
    const p = people.get(key) ?? { key, email: r.email, verified: false, visits: 0, seconds: 0, documents: 0, downloads: 0, lastSeenAt: r.last_ping_at, docs: new Set<string>() };
    p.visits++;
    p.seconds += sec;
    p.verified ||= !!r.email_verified;
    p.downloads += Number(r.downloads);
    p.docs.add(r.document_id);
    if (r.last_ping_at > p.lastSeenAt) p.lastSeenAt = r.last_ping_at;
    people.set(key, p);
  }
  return {
    totals: { visits: rows.length, visitors: people.size, seconds: Math.round(seconds * 10) / 10, live: live.size, downloads },
    documents: [...docs.values()].map(({ people: ps, pct, ...d }) => ({ ...d, visitors: ps.size, seconds: Math.round(d.seconds * 10) / 10, avgCompletion: d.visits ? Math.round(pct / d.visits) : 0 })),
    visitors: [...people.values()].map(({ docs: ds, ...p }) => ({ ...p, documents: ds.size, seconds: Math.round(p.seconds * 10) / 10 })),
    recent: rows.slice(0, 100).map((r) => ({ id: r.id, email: r.email, emailVerified: !!r.email_verified, documentId: r.document_id, title: r.title, linkName: r.link_name ?? '', startedAt: r.started_at, seconds: Math.round(Number(r.seconds) * 10) / 10, completion: completionPct(Number(r.pages_seen), Number(r.page_total)) })),
  };
}

export function spaceCsv(a: SpaceAnalytics): string {
  const lines = [csvLine(['visit_id', 'started_at', 'document', 'link', 'email', 'email_status', 'seconds', 'completion_pct'])];
  for (const r of a.recent) lines.push(csvLine([r.id, r.startedAt, r.title, r.linkName, r.email ?? '', r.email ? (r.emailVerified ? 'verified' : 'unverified') : '', r.seconds, r.completion]));
  return `${lines.join('\r\n')}\r\n`;
}

export { canEditDocument };
