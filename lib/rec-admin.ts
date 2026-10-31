/**
 * Rec: lo que cruza videos. Espacios con miembros, ajustes del workspace (marca,
 * privacidad por defecto, retención), traspaso de contenido, pedidos de acceso,
 * pedido de email para ver, resumen por mail y pasar un video a Docs o Track.
 * Server-only. Las reglas de quién ve qué viven en lib/rec.ts.
 */
import { createHash } from 'crypto';
import { getDb } from './db';
import { deleteUploads } from './uploads';
import { escapeHtml } from './email';
import {
  getManageableVideo,
  getVideoRow,
  nowDb,
  RecError,
  summaryFitsTrim,
  type RecActor,
  type RecVideoRow,
} from './rec';
import {
  chaptersInTrim,
  cleanBrandColor,
  cleanEmails,
  fmtClock,
  MAX_RECAP_RECIPIENTS,
  REC_RETENTION_GRACE_DAYS,
  REC_RETENTION_OPTIONS,
  segmentsInTrim,
  type RecChapter,
  type RecSegment,
} from './rec-schema';

function parseJson<T>(text: string | null | undefined, fallback: T): T {
  try {
    return (JSON.parse(text ?? '') ?? fallback) as T;
  } catch {
    return fallback;
  }
}

function requireAdmin(a: RecActor): void {
  if (!a.admin) throw new RecError('forbidden', 403);
}

async function limited(key: string, limit: number, windowSec: number): Promise<void> {
  if (process.env.RATE_LIMIT_DISABLED === 'true') return;
  const { rateLimit } = await import('./rate-limit');
  const r = await rateLimit(key, limit, windowSec);
  if (!r.ok) throw new RecError('rate_limited', 429);
}

// ============================================================
// Espacios
// ============================================================

export interface RecSpaceDto {
  id: string;
  name: string;
  createdBy: string;
  canManage: boolean;
  members: number;
}

interface SpaceRow {
  id: string;
  workspace_id: string;
  name: string;
  created_by: string;
  members?: number;
}

function spaceDto(a: RecActor, s: SpaceRow): RecSpaceDto {
  return { id: s.id, name: s.name, createdBy: s.created_by, canManage: a.admin || s.created_by === a.actor, members: Number(s.members) || 0 };
}

function cleanSpaceName(raw: string): string {
  const name = String(raw ?? '').trim().slice(0, 120);
  if (!name) throw new RecError('invalid_name');
  return name;
}

export async function listSpaces(a: RecActor): Promise<RecSpaceDto[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM rec_space_members m WHERE m.space_id = s.id) AS members FROM rec_spaces s
       WHERE s.workspace_id = ? AND (? = 1 OR s.id IN (SELECT space_id FROM rec_space_members WHERE user_id = ?))
       ORDER BY s.name COLLATE NOCASE LIMIT 200`,
    )
    .all(a.ws, a.admin ? 1 : 0, a.actor)) as SpaceRow[];
  return rows.map((s) => spaceDto(a, s));
}

async function visibleSpace(a: RecActor, id: string): Promise<SpaceRow> {
  const s = (await getDb()
    .prepare(`SELECT s.*, (SELECT COUNT(*) FROM rec_space_members m WHERE m.space_id = s.id) AS members FROM rec_spaces s WHERE s.id = ? AND s.workspace_id = ?`)
    .get(id, a.ws)) as SpaceRow | undefined;
  if (!s) throw new RecError('not_found', 404);
  if (!a.admin && !(await getDb().prepare('SELECT 1 FROM rec_space_members WHERE space_id = ? AND user_id = ?').get(id, a.actor))) throw new RecError('not_found', 404);
  return s;
}

export async function getSpace(a: RecActor, id: string): Promise<RecSpaceDto | null> {
  return visibleSpace(a, id).then((s) => spaceDto(a, s)).catch((e) => {
    if (e instanceof RecError && e.status === 404) return null;
    throw e;
  });
}

async function manageableSpace(a: RecActor, id: string): Promise<SpaceRow> {
  const s = await visibleSpace(a, id);
  if (!a.admin && s.created_by !== a.actor) throw new RecError('forbidden', 403);
  return s;
}

export async function createSpace(a: RecActor, name: string): Promise<RecSpaceDto> {
  const id = crypto.randomUUID();
  await getDb().prepare('INSERT INTO rec_spaces (id, workspace_id, name, created_by) VALUES (?, ?, ?, ?)').run(id, a.ws, cleanSpaceName(name), a.actor);
  await getDb().prepare('INSERT OR IGNORE INTO rec_space_members (space_id, user_id) VALUES (?, ?)').run(id, a.actor);
  return (await getSpace(a, id))!;
}

export async function renameSpace(a: RecActor, id: string, name: string): Promise<RecSpaceDto> {
  await manageableSpace(a, id);
  await getDb().prepare("UPDATE rec_spaces SET name = ?, updated_at = datetime('now') WHERE id = ?").run(cleanSpaceName(name), id);
  return (await getSpace(a, id))!;
}

/**
 * Borra el espacio. Sus videos vuelven a "Mis videos" de quien los grabó (no a
 * todo el workspace: nadie gana acceso por esto) y sus carpetas desaparecen.
 */
export async function deleteSpace(a: RecActor, id: string): Promise<void> {
  await manageableSpace(a, id);
  const db = getDb();
  await db.prepare("UPDATE rec_videos SET space = 'personal', space_id = NULL, folder_id = NULL WHERE space_id = ?").run(id);
  await db.prepare('DELETE FROM rec_folders WHERE space_id = ?').run(id);
  await db.prepare('DELETE FROM rec_space_members WHERE space_id = ?').run(id);
  await db.prepare('DELETE FROM rec_spaces WHERE id = ?').run(id);
}

export async function spaceMemberIds(a: RecActor, id: string): Promise<string[]> {
  await visibleSpace(a, id);
  const rows = (await getDb().prepare('SELECT user_id FROM rec_space_members WHERE space_id = ?').all(id)) as Array<{ user_id: string }>;
  return rows.map((r) => r.user_id);
}

/** Deja exactamente estos miembros. `allowed` son las personas del workspace con acceso a Rec. */
export async function setSpaceMembers(a: RecActor, id: string, userIds: string[], allowed: string[]): Promise<void> {
  const s = await manageableSpace(a, id);
  const ok = new Set(allowed);
  const next = [...new Set(userIds)].filter((u) => ok.has(u)).slice(0, 500);
  // Quien la creó no se queda afuera por error: sigue siendo miembro.
  if (!next.includes(s.created_by) && ok.has(s.created_by)) next.push(s.created_by);
  const db = getDb();
  await db.prepare('DELETE FROM rec_space_members WHERE space_id = ?').run(id);
  for (const u of next) await db.prepare('INSERT OR IGNORE INTO rec_space_members (space_id, user_id) VALUES (?, ?)').run(id, u);
}

// ============================================================
// Ajustes del workspace
// ============================================================

export interface RecSettingsDto {
  defaultPrivacy: 'link' | 'workspace';
  defaultAllowDownload: boolean;
  brandName: string;
  brandColor: string | null;
  hasLogo: boolean;
  retentionDays: number | null;
  retentionStartsAt: string | null;
  retentionDeleted: number;
}

interface SettingsRow {
  workspace_id: string;
  default_privacy: string;
  default_allow_download: number;
  brand_name: string;
  brand_color: string | null;
  brand_logo_url: string | null;
  retention_days: number | null;
  retention_starts_at: string | null;
  retention_deleted: number;
}

async function settingsRow(ws: string): Promise<SettingsRow | null> {
  return ((await getDb().prepare('SELECT * FROM rec_settings WHERE workspace_id = ?').get(ws)) as SettingsRow | undefined) ?? null;
}

export async function getRecSettings(ws: string): Promise<RecSettingsDto> {
  const s = await settingsRow(ws);
  return {
    defaultPrivacy: s?.default_privacy === 'workspace' ? 'workspace' : 'link',
    defaultAllowDownload: s ? !!s.default_allow_download : true,
    brandName: s?.brand_name ?? '',
    brandColor: cleanBrandColor(s?.brand_color),
    hasLogo: !!s?.brand_logo_url,
    retentionDays: s?.retention_days ?? null,
    retentionStartsAt: s?.retention_starts_at ?? null,
    retentionDeleted: s?.retention_deleted ?? 0,
  };
}

/** Lo que muestra la página pública. Solo se le pasa a quien ya puede ver el video. */
export interface RecBrand {
  name: string;
  color: string | null;
  hasLogo: boolean;
}

export async function getRecBrand(ws: string): Promise<RecBrand | null> {
  const s = await settingsRow(ws);
  if (!s || (!s.brand_name && !s.brand_color && !s.brand_logo_url)) return null;
  return { name: s.brand_name, color: cleanBrandColor(s.brand_color), hasLogo: !!s.brand_logo_url };
}

export async function brandLogoUrl(ws: string): Promise<string | null> {
  return (await settingsRow(ws))?.brand_logo_url ?? null;
}

function dateDb(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

export async function updateRecSettings(
  a: RecActor,
  patch: { defaultPrivacy?: 'link' | 'workspace'; defaultAllowDownload?: boolean; brandName?: string; brandColor?: string | null; retentionDays?: number | null },
): Promise<RecSettingsDto> {
  requireAdmin(a);
  const db = getDb();
  await db.prepare('INSERT OR IGNORE INTO rec_settings (workspace_id) VALUES (?)').run(a.ws);
  const cur = (await settingsRow(a.ws))!;
  const sets: string[] = [];
  const args: Array<string | number | null> = [];
  const set = (col: string, val: string | number | null) => {
    sets.push(`${col} = ?`);
    args.push(val);
  };
  if (patch.defaultPrivacy !== undefined) set('default_privacy', patch.defaultPrivacy === 'workspace' ? 'workspace' : 'link');
  if (patch.defaultAllowDownload !== undefined) set('default_allow_download', patch.defaultAllowDownload ? 1 : 0);
  if (patch.brandName !== undefined) set('brand_name', patch.brandName.trim().slice(0, 80));
  if (patch.brandColor !== undefined) {
    if (patch.brandColor === null || patch.brandColor === '') set('brand_color', null);
    else {
      const c = cleanBrandColor(patch.brandColor);
      if (!c) throw new RecError('invalid_color');
      set('brand_color', c);
    }
  }
  if (patch.retentionDays !== undefined) {
    const days = patch.retentionDays;
    if (days === null) {
      set('retention_days', null);
      set('retention_starts_at', null);
    } else {
      if (!(REC_RETENTION_OPTIONS as readonly number[]).includes(days)) throw new RecError('invalid_input');
      set('retention_days', days);
      // Prender o acortar da un plazo antes de borrar; alargar no lo cambia.
      if (cur.retention_days === null || days < cur.retention_days) set('retention_starts_at', dateDb(Date.now() + REC_RETENTION_GRACE_DAYS * 86_400_000));
    }
  }
  if (sets.length) await db.prepare(`UPDATE rec_settings SET ${sets.join(', ')}, updated_at = datetime('now') WHERE workspace_id = ?`).run(...args, a.ws);
  return getRecSettings(a.ws);
}

export async function setBrandLogo(a: RecActor, url: string | null): Promise<void> {
  requireAdmin(a);
  const db = getDb();
  await db.prepare('INSERT OR IGNORE INTO rec_settings (workspace_id) VALUES (?)').run(a.ws);
  const cur = await settingsRow(a.ws);
  await db.prepare("UPDATE rec_settings SET brand_logo_url = ?, updated_at = datetime('now') WHERE workspace_id = ?").run(url, a.ws);
  if (cur?.brand_logo_url && cur.brand_logo_url !== url) await deleteUploads([cur.brand_logo_url]).catch(() => undefined);
}

// ============================================================
// Retención
// ============================================================

/** Cuántos videos listos tienen más de `days` días (lo que se confirma antes de prenderla). */
export async function retentionPreview(a: RecActor, days: number): Promise<number> {
  requireAdmin(a);
  const row = (await getDb()
    .prepare("SELECT COUNT(*) AS n FROM rec_videos WHERE workspace_id = ? AND status = 'ready' AND created_at < ?")
    .get(a.ws, dateDb(Date.now() - days * 86_400_000))) as { n: number };
  return Number(row.n) || 0;
}

/**
 * Borra los videos vencidos de los workspaces que prendieron la retención, pasado
 * el plazo de aviso. Cada workspace se reclama (compare-and-set de
 * retention_checked_at) para que dos corridas no hagan lo mismo; con el lote
 * lleno, queda libre para la corrida siguiente. Tiene tope de tiempo y de filas
 * para no comerse el resto del cron.
 */
export async function applyRetention(opts: { budgetMs?: number; limit?: number } = {}): Promise<{ deleted: number }> {
  const start = Date.now();
  const budget = opts.budgetMs ?? 3000;
  let left = opts.limit ?? 20;
  const db = getDb();
  const now = nowDb();
  const hourAgo = dateDb(Date.now() - 3_600_000);
  const rows = (await db
    .prepare(
      `SELECT workspace_id, retention_days, retention_checked_at FROM rec_settings
       WHERE retention_days IS NOT NULL AND retention_starts_at <= ? AND (retention_checked_at IS NULL OR retention_checked_at < ?)
       ORDER BY retention_checked_at LIMIT 5`,
    )
    .all(now, hourAgo)) as Array<{ workspace_id: string; retention_days: number; retention_checked_at: string | null }>;
  let deleted = 0;
  for (const w of rows) {
    if (left <= 0 || Date.now() - start > budget) break;
    const claim = await db
      .prepare('UPDATE rec_settings SET retention_checked_at = ? WHERE workspace_id = ? AND retention_checked_at IS ?')
      .run(now, w.workspace_id, w.retention_checked_at);
    if (!claim.changes) continue;
    const cutoff = dateDb(Date.now() - w.retention_days * 86_400_000);
    const asked = left;
    const videos = (await db
      .prepare("SELECT id, url, audio_url, thumb_url, gif_url, trimmed_url FROM rec_videos WHERE workspace_id = ? AND status = 'ready' AND created_at < ? LIMIT ?")
      .all(w.workspace_id, cutoff, left)) as Array<Pick<RecVideoRow, 'id' | 'url' | 'audio_url' | 'thumb_url' | 'gif_url' | 'trimmed_url'>>;
    let here = 0;
    let stopped = false;
    for (const v of videos) {
      if (Date.now() - start > budget) {
        stopped = true;
        break;
      }
      const res = await db.prepare("DELETE FROM rec_videos WHERE id = ? AND status = 'ready' AND created_at < ?").run(v.id, cutoff);
      if (!res.changes) continue;
      here++;
      await deleteUploads([v.url, v.audio_url, v.thumb_url, v.gif_url, v.trimmed_url].filter((u): u is string => !!u)).catch(() => undefined);
    }
    left -= here;
    deleted += here;
    if (here) await db.prepare('UPDATE rec_settings SET retention_deleted = retention_deleted + ? WHERE workspace_id = ?').run(here, w.workspace_id);
    // Quedó trabajo: la próxima corrida sigue, sin esperar una hora.
    if (stopped || videos.length >= asked) await db.prepare('UPDATE rec_settings SET retention_checked_at = ? WHERE workspace_id = ?').run(hourAgo, w.workspace_id);
  }
  return { deleted };
}

// ============================================================
// Traspaso de contenido
// ============================================================

export interface RecContentOwner {
  userId: string;
  name: string;
  videos: number;
  folders: number;
}

/** Quién tiene videos o carpetas en el workspace (también gente que ya no está). Solo admins. */
export async function listContentOwners(a: RecActor): Promise<RecContentOwner[]> {
  requireAdmin(a);
  const rows = (await getDb()
    .prepare(
      `SELECT o.created_by AS user_id, COALESCE(u.name, u.email, '') AS name, SUM(o.videos) AS videos, SUM(o.folders) AS folders FROM (
         SELECT created_by, COUNT(*) AS videos, 0 AS folders FROM rec_videos WHERE workspace_id = ? AND status = 'ready' GROUP BY created_by
         UNION ALL
         SELECT created_by, 0, COUNT(*) FROM rec_folders WHERE workspace_id = ? GROUP BY created_by
       ) o LEFT JOIN users u ON u.id = o.created_by GROUP BY o.created_by ORDER BY name LIMIT 500`,
    )
    .all(a.ws, a.ws)) as Array<{ user_id: string; name: string; videos: number; folders: number }>;
  return rows.map((r) => ({ userId: r.user_id, name: r.name, videos: Number(r.videos) || 0, folders: Number(r.folders) || 0 }));
}

/** Pasa todos los videos y carpetas de una persona a otra del workspace (también los personales). */
export async function transferContent(a: RecActor, from: string, to: string, allowedTargets: string[]): Promise<{ videos: number; folders: number }> {
  requireAdmin(a);
  if (from === to || !allowedTargets.includes(to)) throw new RecError('invalid_input');
  const db = getDb();
  const v = await db.prepare("UPDATE rec_videos SET created_by = ?, updated_at = datetime('now') WHERE workspace_id = ? AND created_by = ?").run(to, a.ws, from);
  const f = await db.prepare("UPDATE rec_folders SET created_by = ?, updated_at = datetime('now') WHERE workspace_id = ? AND created_by = ?").run(to, a.ws, from);
  const videos = Number(v.changes) || 0;
  const folders = Number(f.changes) || 0;
  if (videos || folders) {
    try {
      const { createNotification } = await import('./notifications');
      await createNotification({
        userId: to,
        type: 'rec_access',
        title: `${a.name || 'An admin'} moved ${videos} videos to your library`,
        href: '/app/rec',
        sourceType: 'rec_transfer',
        sourceId: from,
        meta: { actorName: a.name },
      });
    } catch {
      /* el aviso no corta el traspaso */
    }
  }
  return { videos, folders };
}

// ============================================================
// Pedir acceso
// ============================================================

export interface RecAccessRequestDto {
  id: string;
  email: string;
  name: string;
  status: 'pending' | 'approved' | 'denied';
  createdAt: string;
}

/**
 * Pedido de acceso de quien entró con su cuenta (el email es el de la sesión, no
 * uno que escribió). Una fila por persona y video: repetir no vuelve a avisar.
 */
export async function requestAccess(v: Pick<RecVideoRow, 'id' | 'created_by' | 'title' | 'notify'>, person: { email: string; name: string }): Promise<RecAccessRequestDto['status']> {
  const email = person.email.trim().toLowerCase();
  if (!email) throw new RecError('signin_required', 403);
  const db = getDb();
  const existing = (await db.prepare('SELECT status FROM rec_access_requests WHERE video_id = ? AND email = ?').get(v.id, email)) as { status: RecAccessRequestDto['status'] } | undefined;
  if (existing) return existing.status;
  await limited(`rec:access:user:${email}`, 20, 3600);
  await limited(`rec:access:video:${v.id}`, 30, 3600);
  const res = await db
    .prepare('INSERT OR IGNORE INTO rec_access_requests (id, video_id, email, name) VALUES (?, ?, ?, ?)')
    .run(crypto.randomUUID(), v.id, email, person.name.trim().slice(0, 80));
  if (res.changes) {
    try {
      const { createNotification } = await import('./notifications');
      await createNotification({
        userId: v.created_by,
        type: 'rec_access',
        title: `${person.name || email} asked to watch "${v.title}"`,
        href: `/app/rec/${v.id}?share=1`,
        sourceType: 'rec_video',
        sourceId: v.id,
        meta: { actorName: person.name || email, title: v.title },
      });
    } catch {
      /* idem */
    }
  }
  return 'pending';
}

export async function listAccessRequests(a: RecActor, videoId: string): Promise<RecAccessRequestDto[]> {
  await getManageableVideo(a, videoId);
  const rows = (await getDb()
    .prepare("SELECT id, email, name, status, created_at FROM rec_access_requests WHERE video_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 200")
    .all(videoId)) as Array<{ id: string; email: string; name: string; status: RecAccessRequestDto['status']; created_at: string }>;
  return rows.map((r) => ({ id: r.id, email: r.email, name: r.name, status: r.status, createdAt: r.created_at }));
}

/** Aprobar suma el email a la lista (quitarlo después corta el acceso al toque) y le avisa una sola vez. */
export async function decideAccessRequest(a: RecActor, videoId: string, requestId: string, approve: boolean, shareUrl: string): Promise<{ allowedEmails: string[] }> {
  const v = await getManageableVideo(a, videoId);
  const db = getDb();
  const req = (await db.prepare("SELECT id, email FROM rec_access_requests WHERE id = ? AND video_id = ? AND status = 'pending'").get(requestId, videoId)) as { id: string; email: string } | undefined;
  if (!req) throw new RecError('not_found', 404);
  const claim = await db
    .prepare("UPDATE rec_access_requests SET status = ?, decided_at = datetime('now') WHERE id = ? AND status = 'pending'")
    .run(approve ? 'approved' : 'denied', requestId);
  const current = parseJson<string[]>(v.allowed_emails, []);
  if (!approve || !claim.changes) return { allowedEmails: current };
  const allowed = cleanEmails([...current, req.email]);
  await db.prepare("UPDATE rec_videos SET allowed_emails = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(allowed), videoId);
  const { sendEmail, appSender } = await import('./email');
  await sendEmail({
    to: req.email,
    from: appSender(),
    subject: `You can now watch "${v.title}"`,
    text: `${a.name || 'The owner'} gave you access to "${v.title}".\n\n${shareUrl}`,
    html: `<p>${escapeHtml(a.name || 'The owner')} gave you access to "${escapeHtml(v.title)}".</p><p><a href="${escapeHtml(shareUrl)}">${escapeHtml(shareUrl)}</a></p>`,
    idempotencyKey: `rec-access-${requestId}`,
  }).catch(() => undefined);
  return { allowedEmails: allowed };
}

// ============================================================
// Pedido de email para ver
// ============================================================

export async function saveViewerEmail(videoId: string, viewerKey: string, name: string, email: string): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO rec_viewer_emails (video_id, viewer_key, name, email) VALUES (?, ?, ?, ?)
       ON CONFLICT(video_id, viewer_key) DO UPDATE SET name = excluded.name, email = excluded.email`,
    )
    .run(videoId, viewerKey, name.trim().slice(0, 80), email);
}

// ============================================================
// Del video a un documento o una tarea
// ============================================================

/** Lo que el video muestra a esta persona: quien no lo administra, solo lo que queda dentro del recorte. */
function visibleContent(v: RecVideoRow, manager: boolean): { segments: RecSegment[]; chapters: RecChapter[]; summary: string } {
  const segs = parseJson<RecSegment[]>(v.transcript, []);
  const chapters = parseJson<RecChapter[]>(v.chapters, []);
  return {
    segments: manager ? segs : segmentsInTrim(segs, v.trim_start, v.trim_end),
    chapters: manager ? chapters : chaptersInTrim(chapters, v.trim_start, v.trim_end),
    summary: manager || summaryFitsTrim(v) ? v.summary : '',
  };
}

/** Bloques de la página de Docs: link, resumen, capítulos y transcripción. Todo el texto va escapado. */
export function videoDocBlocks(
  v: Pick<RecVideoRow, 'title' | 'description'>,
  content: { segments: RecSegment[]; chapters: RecChapter[]; summary: string },
  shareUrl: string,
  labels: { watch: string; summary: string; chapters: string; transcript: string },
): Array<{ id: string; type: 'paragraph' | 'heading' | 'bulleted_list_item'; content: string; level?: 2 }> {
  const id = () => crypto.randomUUID();
  const out: Array<{ id: string; type: 'paragraph' | 'heading' | 'bulleted_list_item'; content: string; level?: 2 }> = [
    { id: id(), type: 'paragraph', content: `<a href="${escapeHtml(shareUrl)}">${escapeHtml(labels.watch)}</a>` },
  ];
  if (v.description.trim()) out.push({ id: id(), type: 'paragraph', content: escapeHtml(v.description.trim()) });
  if (content.summary.trim()) {
    out.push({ id: id(), type: 'heading', level: 2, content: escapeHtml(labels.summary) }, { id: id(), type: 'paragraph', content: escapeHtml(content.summary.trim()) });
  }
  if (content.chapters.length) {
    out.push({ id: id(), type: 'heading', level: 2, content: escapeHtml(labels.chapters) });
    for (const c of content.chapters) out.push({ id: id(), type: 'bulleted_list_item', content: `${fmtClock(c.start)} ${escapeHtml(c.title)}` });
  }
  if (content.segments.length) {
    out.push({ id: id(), type: 'heading', level: 2, content: escapeHtml(labels.transcript) });
    for (const s of content.segments.slice(0, 1500)) out.push({ id: id(), type: 'paragraph', content: `${fmtClock(s.start)} ${escapeHtml(s.text)}` });
  }
  return out;
}

export function videoIssueText(
  v: Pick<RecVideoRow, 'description'>,
  content: { segments: RecSegment[]; chapters: RecChapter[]; summary: string },
  shareUrl: string,
  labels: { watch: string; summary: string; transcript: string },
): string {
  const parts = [`${labels.watch}: ${shareUrl}`];
  if (v.description.trim()) parts.push(v.description.trim());
  if (content.summary.trim()) parts.push(`${labels.summary}:\n${content.summary.trim()}`);
  if (content.segments.length) parts.push(`${labels.transcript}:\n${content.segments.map((s) => `${fmtClock(s.start)} ${s.text}`).join('\n')}`);
  return parts.join('\n\n').slice(0, 19_000);
}

/** Contenido exportable, con el mismo control que la página del video. */
export async function exportableVideo(a: RecActor, id: string, manager: (v: RecVideoRow) => boolean) {
  const v = await getVideoRow(a, id);
  if (!v) throw new RecError('not_found', 404);
  if (v.status !== 'ready') throw new RecError('not_ready', 409);
  return { v, content: visibleContent(v, manager(v)) };
}

// ============================================================
// Resumen por mail
// ============================================================

export function recapEmail(
  v: Pick<RecVideoRow, 'title'>,
  content: { chapters: RecChapter[]; summary: string },
  shareUrl: string,
  from: string,
): { subject: string; text: string; html: string } {
  const lines = [`${from} shared a recap of "${v.title}".`, ''];
  if (content.summary.trim()) lines.push(content.summary.trim(), '');
  if (content.chapters.length) lines.push(...content.chapters.map((c) => `${fmtClock(c.start)} ${c.title}`), '');
  lines.push(shareUrl);
  const html = [
    `<p>${escapeHtml(from)} shared a recap of "${escapeHtml(v.title)}".</p>`,
    content.summary.trim() ? `<p>${escapeHtml(content.summary.trim())}</p>` : '',
    content.chapters.length ? `<ul>${content.chapters.map((c) => `<li>${fmtClock(c.start)} ${escapeHtml(c.title)}</li>`).join('')}</ul>` : '',
    `<p><a href="${escapeHtml(shareUrl)}">${escapeHtml(shareUrl)}</a></p>`,
  ].join('');
  return { subject: `Recap: ${v.title}`.slice(0, 200), text: lines.join('\n'), html };
}

/**
 * Manda el resumen a hasta MAX_RECAP_RECIPIENTS direcciones. La misma lista con
 * el mismo contenido no sale dos veces (clave por video, destinos y texto); hay
 * tope por persona y por workspace, y cada envío lleva su clave de idempotencia.
 */
export async function sendRecap(a: RecActor, id: string, rawEmails: string[], shareUrl: string): Promise<{ sent: number; duplicate: boolean }> {
  const v = await getManageableVideo(a, id);
  if (v.status !== 'ready') throw new RecError('not_ready', 409);
  const emails = cleanEmails(rawEmails).sort();
  if (!emails.length) throw new RecError('invalid_input');
  if (emails.length > MAX_RECAP_RECIPIENTS) throw new RecError('too_many_recipients');
  const content = visibleContent(v, false);
  const { subject, text, html } = recapEmail(v, content, shareUrl, a.name || 'Someone');
  const key = createHash('sha256').update(JSON.stringify([id, emails, subject, text])).digest('hex').slice(0, 40);
  const db = getDb();
  if (await db.prepare('SELECT 1 FROM rec_recaps WHERE key = ?').get(key)) return { sent: 0, duplicate: true };
  await limited(`rec:recap:user:${a.actor}`, 20, 3600);
  await limited(`rec:recap:ws:${a.ws}`, 300, 86_400);
  const claim = await db.prepare('INSERT OR IGNORE INTO rec_recaps (key, video_id, recipients, sent_by) VALUES (?, ?, ?, ?)').run(key, id, JSON.stringify(emails), a.actor);
  if (!claim.changes) return { sent: 0, duplicate: true };
  const { sendEmail, appSender } = await import('./email');
  let sent = 0;
  for (const to of emails) {
    const r = await sendEmail({ to, from: appSender(), subject, text, html, idempotencyKey: `rec-recap-${key}-${createHash('sha256').update(to).digest('hex').slice(0, 12)}` }).catch(() => ({ ok: false }));
    if (r.ok) sent++;
  }
  if (!sent) {
    // No salió ninguno: se puede reintentar.
    await db.prepare('DELETE FROM rec_recaps WHERE key = ?').run(key);
    throw new RecError('recap_failed', 502);
  }
  await db.prepare('UPDATE rec_recaps SET sent = ? WHERE key = ?').run(sent, key);
  return { sent, duplicate: false };
}
