/**
 * CRM — documentos con seguimiento y videos 1:1 (como Documents y Video de
 * HubSpot Sales). Server-only.
 *
 * - Documentos: biblioteca de PDFs (Blob o disco local). Cada link de
 *   seguimiento es para un contacto (o anónimo) y abre /view/<token>; el visor
 *   manda pings con segundos por página. La primera apertura de cada vista
 *   deja una actividad en el timeline del contacto y avisa al dueño; los pings
 *   actualizan esa actividad con el tiempo y las páginas más leídas.
 * - Videos: grabados en el navegador (cámara o pantalla) o subidos, con página
 *   propia /watch/<token>. Cada reproducción guarda cuánto se vio y deja la
 *   actividad en el contacto del video.
 *
 * Los archivos se sirven por URL pública del almacenamiento (como los
 * adjuntos); el seguimiento cuenta las aperturas por la página del token.
 */
import { createHash, randomBytes } from 'crypto';
import { getDb } from './db';
import { deleteUploads } from './uploads';
import { clampSeconds, fmtDuration, mergePages, topPages, watchedPct } from './crm-media-schema';

function nowDb(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function dbTime(d: string): number {
  return new Date(`${d.replace(' ', 'T')}Z`).getTime();
}

function newToken(): string {
  return randomBytes(12).toString('base64url');
}

function hashIp(ip: string): string {
  return ip ? createHash('sha256').update(`${process.env.NEXTAUTH_SECRET ?? ''}:media:${ip}`).digest('hex').slice(0, 32) : '';
}

export class MediaError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}

async function assertContact(userId: string, contactId: string | null | undefined): Promise<string | null> {
  if (!contactId) return null;
  const row = await getDb().prepare('SELECT id FROM crm_contacts WHERE id = ? AND user_id = ?').get(contactId, userId);
  if (!row) throw new MediaError('invalid_contact');
  return contactId;
}

/** URL guardada válida: subida local (/uploads/crm/…) o a nuestro Blob (…blob.vercel-storage.com/crm/…). */
export function isOwnUploadUrl(url: string): boolean {
  if (url.startsWith('/uploads/crm/') && !url.includes('..')) return true;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname.endsWith('.blob.vercel-storage.com') && u.pathname.startsWith('/crm/');
  } catch {
    return false;
  }
}

// ============================================================
// Documentos
// ============================================================

export interface DocumentRow {
  id: string;
  user_id: string;
  name: string;
  filename: string;
  url: string;
  size: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentListItem extends DocumentRow {
  links: number;
  views: number;
  last_viewed_at: string | null;
}

export async function listDocuments(userId: string, q = ''): Promise<DocumentListItem[]> {
  const like = `%${q.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  return (await getDb()
    .prepare(
      `SELECT d.*, COUNT(l.id) AS links, COALESCE(SUM(l.views), 0) AS views, MAX(l.last_viewed_at) AS last_viewed_at
       FROM crm_documents d LEFT JOIN crm_document_links l ON l.document_id = d.id
       WHERE d.user_id = ? AND d.name LIKE ? ESCAPE '\\'
       GROUP BY d.id ORDER BY d.updated_at DESC LIMIT 500`,
    )
    .all(userId, like)) as DocumentListItem[];
}

export async function getDocument(userId: string, id: string): Promise<DocumentRow | null> {
  return ((await getDb().prepare('SELECT * FROM crm_documents WHERE id = ? AND user_id = ?').get(id, userId)) as DocumentRow | undefined) ?? null;
}

export async function createDocument(
  userId: string,
  input: { name: string; filename: string; url: string; size: number; createdBy: string },
): Promise<DocumentRow> {
  if (!isOwnUploadUrl(input.url)) throw new MediaError('invalid_file');
  const id = crypto.randomUUID();
  const name = (input.name.trim() || input.filename.replace(/\.pdf$/i, '') || 'Document').slice(0, 200);
  await getDb()
    .prepare('INSERT INTO crm_documents (id, user_id, name, filename, url, size, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, userId, name, input.filename.slice(0, 255), input.url, Math.max(0, Math.round(input.size)), input.createdBy);
  return (await getDocument(userId, id))!;
}

export async function renameDocument(userId: string, id: string, name: string): Promise<DocumentRow | null> {
  const clean = name.trim().slice(0, 200);
  if (!clean) throw new MediaError('invalid_input');
  const res = await getDb()
    .prepare("UPDATE crm_documents SET name = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
    .run(clean, id, userId);
  return res.changes ? getDocument(userId, id) : null;
}

export async function deleteDocument(userId: string, id: string): Promise<boolean> {
  const doc = await getDocument(userId, id);
  if (!doc) return false;
  await getDb().prepare('DELETE FROM crm_documents WHERE id = ? AND user_id = ?').run(id, userId);
  await deleteUploads([doc.url]);
  return true;
}

export interface DocumentLinkView {
  id: string;
  token: string;
  contact_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  views: number;
  last_viewed_at: string | null;
  seconds: number;
  pages: Record<string, number>;
  created_at: string;
}

export async function listDocumentLinks(userId: string, documentId: string): Promise<DocumentLinkView[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT l.id, l.token, l.contact_id, l.views, l.last_viewed_at, l.created_at,
              TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) AS contact_name, c.email AS contact_email
       FROM crm_document_links l LEFT JOIN crm_contacts c ON c.id = l.contact_id
       WHERE l.user_id = ? AND l.document_id = ? ORDER BY l.created_at DESC`,
    )
    .all(userId, documentId)) as Array<Omit<DocumentLinkView, 'seconds' | 'pages'>>;
  const out: DocumentLinkView[] = [];
  for (const r of rows) {
    const views = (await getDb()
      .prepare('SELECT seconds, pages FROM crm_document_views WHERE link_id = ?')
      .all(r.id)) as Array<{ seconds: number; pages: string }>;
    let seconds = 0;
    const pages: Record<string, number> = {};
    for (const v of views) {
      seconds += v.seconds;
      try {
        for (const [k, n] of Object.entries(JSON.parse(v.pages || '{}') as Record<string, number>)) pages[k] = (pages[k] ?? 0) + n;
      } catch {
        /* vista corrupta: se ignora */
      }
    }
    out.push({ ...r, contact_name: r.contact_name || null, seconds, pages });
  }
  return out;
}

export async function createDocumentLink(
  userId: string,
  documentId: string,
  input: { contactId?: string | null; createdBy: string },
): Promise<{ id: string; token: string }> {
  if (!(await getDocument(userId, documentId))) throw new MediaError('not_found', 404);
  const contactId = await assertContact(userId, input.contactId);
  // Un link por contacto: si ya existe, se reusa (como HubSpot, que identifica al contacto por link).
  if (contactId) {
    const existing = (await getDb()
      .prepare('SELECT id, token FROM crm_document_links WHERE document_id = ? AND contact_id = ?')
      .get(documentId, contactId)) as { id: string; token: string } | undefined;
    if (existing) return existing;
  }
  const id = crypto.randomUUID();
  const token = newToken();
  await getDb()
    .prepare('INSERT INTO crm_document_links (id, user_id, document_id, contact_id, token, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, userId, documentId, contactId, token, input.createdBy);
  return { id, token };
}

export async function deleteDocumentLink(userId: string, documentId: string, linkId: string): Promise<boolean> {
  const res = await getDb()
    .prepare('DELETE FROM crm_document_links WHERE id = ? AND document_id = ? AND user_id = ?')
    .run(linkId, documentId, userId);
  return res.changes > 0;
}

export interface PublicDocument {
  name: string;
  url: string;
}

interface LinkJoin {
  link_id: string;
  user_id: string;
  contact_id: string | null;
  document_id: string;
  name: string;
  url: string;
  created_by: string | null;
}

async function linkByToken(token: string): Promise<LinkJoin | null> {
  if (!/^[\w-]{8,40}$/.test(token)) return null;
  return (
    ((await getDb()
      .prepare(
        `SELECT l.id AS link_id, l.user_id, l.contact_id, l.document_id, d.name, d.url, d.created_by
         FROM crm_document_links l JOIN crm_documents d ON d.id = l.document_id WHERE l.token = ?`,
      )
      .get(token)) as LinkJoin | undefined) ?? null
  );
}

export async function getPublicDocument(token: string): Promise<PublicDocument | null> {
  const link = await linkByToken(token);
  return link ? { name: link.name, url: link.url } : null;
}

/** El archivo del link (para servirlo desde nuestro dominio). */
export async function documentFileUrl(token: string): Promise<{ url: string; name: string } | null> {
  const link = await linkByToken(token);
  return link ? { url: link.url, name: link.name } : null;
}

async function contactLabel(contactId: string | null): Promise<{ label: string; owner: string | null } | null> {
  if (!contactId) return null;
  const c = (await getDb().prepare('SELECT first_name, last_name, email, owner_id FROM crm_contacts WHERE id = ?').get(contactId)) as
    | { first_name: string; last_name: string; email: string; owner_id: string | null }
    | undefined;
  if (!c) return null;
  return { label: `${c.first_name} ${c.last_name}`.trim() || c.email || 'A contact', owner: c.owner_id };
}

function docSummary(seconds: number, pages: Record<string, number>, pageCount: number): string {
  const top = topPages(pages, 5)
    .map(([p, s]) => `p.${p} ${fmtDuration(s)}`)
    .join(', ');
  return [`Time viewing: ${fmtDuration(seconds)}${pageCount ? ` · ${pageCount} pages` : ''}`, top ? `Most read: ${top}` : '']
    .filter(Boolean)
    .join('\n');
}

/**
 * Vista del documento: sin viewId abre una vista nueva (cuenta la apertura,
 * deja la actividad y avisa al dueño); con viewId suma tiempo y páginas.
 */
export async function trackDocumentView(
  token: string,
  input: { viewId?: string; seconds?: number; pages?: Record<string, number>; pageCount?: number; ip?: string; userAgent?: string },
): Promise<{ viewId: string } | null> {
  const link = await linkByToken(token);
  if (!link) return null;
  const db = getDb();
  const pageCount = Math.max(0, Math.min(Math.round(input.pageCount ?? 0), 2000));
  if (input.viewId) {
    const view = (await db.prepare('SELECT * FROM crm_document_views WHERE id = ? AND link_id = ?').get(input.viewId, link.link_id)) as
      | { id: string; seconds: number; pages: string; page_count: number; last_ping_at: string; activity_id: string | null }
      | undefined;
    if (!view) return null;
    let saved: Record<string, number> = {};
    try {
      saved = JSON.parse(view.pages || '{}') as Record<string, number>;
    } catch {
      saved = {};
    }
    const count = Math.max(view.page_count, pageCount);
    const pages = mergePages(saved, input.pages ?? {}, count);
    const seconds = clampSeconds(view.seconds, input.seconds ?? 0, (Date.now() - dbTime(view.last_ping_at)) / 1000);
    await db
      .prepare('UPDATE crm_document_views SET seconds = ?, pages = ?, page_count = ?, last_ping_at = ? WHERE id = ?')
      .run(seconds, JSON.stringify(pages), count, nowDb(), view.id);
    if (view.activity_id) {
      await db
        .prepare("UPDATE crm_activities SET body = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
        .run(docSummary(seconds, pages, count), view.activity_id, link.user_id);
    }
    return { viewId: view.id };
  }
  const id = crypto.randomUUID();
  const ts = nowDb();
  await db
    .prepare(
      'INSERT INTO crm_document_views (id, link_id, user_id, page_count, ip_hash, user_agent, started_at, last_ping_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(id, link.link_id, link.user_id, pageCount, hashIp(input.ip ?? ''), (input.userAgent ?? '').slice(0, 300), ts, ts);
  await db.prepare('UPDATE crm_document_links SET views = views + 1, last_viewed_at = ? WHERE id = ?').run(ts, link.link_id);
  const who = await contactLabel(link.contact_id);
  try {
    if (link.contact_id) {
      const { createActivity } = await import('./crm');
      const act = await createActivity(link.user_id, {
        type: 'note',
        subject: `Viewed document: ${link.name}`,
        body: docSummary(0, {}, pageCount),
        contactId: link.contact_id,
      });
      await db.prepare('UPDATE crm_document_views SET activity_id = ? WHERE id = ?').run(act.id, id);
    }
    const { createNotification } = await import('./notifications');
    await createNotification({
      userId: who?.owner ?? link.created_by ?? link.user_id,
      type: 'crm_document',
      title: `${who?.label ?? 'Someone'} opened "${link.name}"`,
      href: `/app/crm/documents/${link.document_id}`,
      sourceType: 'crm_document',
      sourceId: link.document_id,
    });
  } catch {
    /* el aviso no corta la vista */
  }
  return { viewId: id };
}

// ============================================================
// Videos
// ============================================================

export interface VideoRow {
  id: string;
  user_id: string;
  title: string;
  url: string;
  content_type: string;
  size: number;
  duration_sec: number;
  contact_id: string | null;
  token: string;
  message: string;
  created_by: string | null;
  views: number;
  last_viewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type VideoListItem = VideoRow & { contact_name: string | null };

export async function listVideos(userId: string, q = ''): Promise<VideoListItem[]> {
  const like = `%${q.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const rows = (await getDb()
    .prepare(
      `SELECT v.*, TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) AS contact_name
       FROM crm_videos v LEFT JOIN crm_contacts c ON c.id = v.contact_id
       WHERE v.user_id = ? AND v.title LIKE ? ESCAPE '\\' ORDER BY v.updated_at DESC LIMIT 500`,
    )
    .all(userId, like)) as VideoListItem[];
  return rows.map((r) => ({ ...r, contact_name: r.contact_name || null }));
}

export async function getVideo(userId: string, id: string): Promise<VideoListItem | null> {
  const row = (await getDb()
    .prepare(
      `SELECT v.*, TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) AS contact_name
       FROM crm_videos v LEFT JOIN crm_contacts c ON c.id = v.contact_id WHERE v.id = ? AND v.user_id = ?`,
    )
    .get(id, userId)) as VideoListItem | undefined;
  return row ? { ...row, contact_name: row.contact_name || null } : null;
}

export async function createVideo(
  userId: string,
  input: { title: string; url: string; contentType: string; size: number; durationSec?: number; contactId?: string | null; message?: string; createdBy: string },
): Promise<VideoListItem> {
  if (!isOwnUploadUrl(input.url)) throw new MediaError('invalid_file');
  const contactId = await assertContact(userId, input.contactId);
  const id = crypto.randomUUID();
  await getDb()
    .prepare(
      `INSERT INTO crm_videos (id, user_id, title, url, content_type, size, duration_sec, contact_id, token, message, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      (input.title.trim() || 'Video').slice(0, 200),
      input.url,
      input.contentType.slice(0, 80),
      Math.max(0, Math.round(input.size)),
      Math.max(0, Number(input.durationSec) || 0),
      contactId,
      newToken(),
      (input.message ?? '').trim().slice(0, 2000),
      input.createdBy,
    );
  return (await getVideo(userId, id))!;
}

export async function updateVideo(
  userId: string,
  id: string,
  patch: { title?: string; message?: string; contactId?: string | null },
): Promise<VideoListItem | null> {
  const sets: string[] = [];
  const args: Array<string | null> = [];
  if (patch.title !== undefined) {
    const title = patch.title.trim().slice(0, 200);
    if (!title) throw new MediaError('invalid_input');
    sets.push('title = ?');
    args.push(title);
  }
  if (patch.message !== undefined) {
    sets.push('message = ?');
    args.push(patch.message.trim().slice(0, 2000));
  }
  if (patch.contactId !== undefined) {
    sets.push('contact_id = ?');
    args.push(await assertContact(userId, patch.contactId));
  }
  if (sets.length) {
    const res = await getDb()
      .prepare(`UPDATE crm_videos SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ? AND user_id = ?`)
      .run(...args, id, userId);
    if (!res.changes) return null;
  }
  return getVideo(userId, id);
}

export async function deleteVideo(userId: string, id: string): Promise<boolean> {
  const v = await getVideo(userId, id);
  if (!v) return false;
  await getDb().prepare('DELETE FROM crm_videos WHERE id = ? AND user_id = ?').run(id, userId);
  await deleteUploads([v.url]);
  return true;
}

export interface VideoViewRow {
  id: string;
  started_at: string;
  watched_sec: number;
  max_position: number;
  duration_sec: number;
}

export async function listVideoViews(userId: string, videoId: string): Promise<VideoViewRow[]> {
  return (await getDb()
    .prepare(
      'SELECT id, started_at, watched_sec, max_position, duration_sec FROM crm_video_views WHERE user_id = ? AND video_id = ? ORDER BY started_at DESC LIMIT 100',
    )
    .all(userId, videoId)) as VideoViewRow[];
}

export interface PublicVideo {
  title: string;
  url: string;
  contentType: string;
  message: string;
  senderName: string;
  contactFirstName: string;
}

export async function getPublicVideo(token: string): Promise<PublicVideo | null> {
  if (!/^[\w-]{8,40}$/.test(token)) return null;
  const v = (await getDb()
    .prepare(
      `SELECT v.title, v.url, v.content_type, v.message, COALESCE(u.name, '') AS sender, COALESCE(c.first_name, '') AS first_name
       FROM crm_videos v LEFT JOIN users u ON u.id = v.created_by LEFT JOIN crm_contacts c ON c.id = v.contact_id
       WHERE v.token = ?`,
    )
    .get(token)) as { title: string; url: string; content_type: string; message: string; sender: string; first_name: string } | undefined;
  return v
    ? { title: v.title, url: v.url, contentType: v.content_type, message: v.message, senderName: v.sender, contactFirstName: v.first_name }
    : null;
}

function videoSummary(watched: number, maxPos: number, duration: number): string {
  const pct = watchedPct(maxPos, duration);
  return `Watched ${fmtDuration(watched)}${duration ? ` of ${fmtDuration(duration)} (${pct}%)` : ''}`;
}

/** Reproducción del video: sin viewId abre una vista (actividad + aviso); con viewId suma lo visto. */
export async function trackVideoView(
  token: string,
  input: { viewId?: string; watched?: number; position?: number; duration?: number; ip?: string; userAgent?: string },
): Promise<{ viewId: string } | null> {
  if (!/^[\w-]{8,40}$/.test(token)) return null;
  const db = getDb();
  const v = (await db.prepare('SELECT * FROM crm_videos WHERE token = ?').get(token)) as VideoRow | undefined;
  if (!v) return null;
  const duration = Math.max(0, Math.min(Number(input.duration) || 0, 6 * 3600));
  if (duration && Math.abs(duration - v.duration_sec) > 1) {
    await db.prepare('UPDATE crm_videos SET duration_sec = ? WHERE id = ?').run(duration, v.id);
  }
  if (input.viewId) {
    const view = (await db.prepare('SELECT * FROM crm_video_views WHERE id = ? AND video_id = ?').get(input.viewId, v.id)) as
      | { id: string; watched_sec: number; max_position: number; last_ping_at: string; activity_id: string | null }
      | undefined;
    if (!view) return null;
    const watched = clampSeconds(view.watched_sec, input.watched ?? 0, (Date.now() - dbTime(view.last_ping_at)) / 1000);
    const dur = duration || v.duration_sec;
    const maxPos = Math.max(view.max_position, Math.min(Number(input.position) || 0, dur || Number.MAX_SAFE_INTEGER));
    await db
      .prepare('UPDATE crm_video_views SET watched_sec = ?, max_position = ?, duration_sec = ?, last_ping_at = ? WHERE id = ?')
      .run(watched, maxPos, dur, nowDb(), view.id);
    if (view.activity_id) {
      await db
        .prepare("UPDATE crm_activities SET body = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
        .run(videoSummary(watched, maxPos, dur), view.activity_id, v.user_id);
    }
    return { viewId: view.id };
  }
  const id = crypto.randomUUID();
  const ts = nowDb();
  await db
    .prepare(
      'INSERT INTO crm_video_views (id, video_id, user_id, duration_sec, ip_hash, user_agent, started_at, last_ping_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(id, v.id, v.user_id, duration || v.duration_sec, hashIp(input.ip ?? ''), (input.userAgent ?? '').slice(0, 300), ts, ts);
  await db.prepare('UPDATE crm_videos SET views = views + 1, last_viewed_at = ? WHERE id = ?').run(ts, v.id);
  const who = await contactLabel(v.contact_id);
  try {
    if (v.contact_id) {
      const { createActivity } = await import('./crm');
      const act = await createActivity(v.user_id, {
        type: 'note',
        subject: `Watched video: ${v.title}`,
        body: videoSummary(0, 0, duration || v.duration_sec),
        contactId: v.contact_id,
      });
      await db.prepare('UPDATE crm_video_views SET activity_id = ? WHERE id = ?').run(act.id, id);
    }
    const { createNotification } = await import('./notifications');
    await createNotification({
      userId: who?.owner ?? v.created_by ?? v.user_id,
      type: 'crm_video',
      title: `${who?.label ?? 'Someone'} is watching "${v.title}"`,
      href: `/app/crm/videos/${v.id}`,
      sourceType: 'crm_video',
      sourceId: v.id,
    });
  } catch {
    /* idem */
  }
  return { viewId: id };
}

/** Documentos y videos para la búsqueda global (⌘K). */
export async function searchMedia(userId: string, q: string, limit = 5): Promise<Array<{ id: string; kind: 'document' | 'video'; label: string }>> {
  const needle = q.trim();
  if (!needle) return [];
  const like = `%${needle.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const docs = (await getDb()
    .prepare("SELECT id, name AS label FROM crm_documents WHERE user_id = ? AND name LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT ?")
    .all(userId, like, limit)
    .catch(() => [])) as Array<{ id: string; label: string }>;
  const vids = (await getDb()
    .prepare("SELECT id, title AS label FROM crm_videos WHERE user_id = ? AND title LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT ?")
    .all(userId, like, limit)
    .catch(() => [])) as Array<{ id: string; label: string }>;
  return [...docs.map((d) => ({ ...d, kind: 'document' as const })), ...vids.map((v) => ({ ...v, kind: 'video' as const }))];
}
