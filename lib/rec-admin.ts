/**
 * Rec: lo que cruza videos. Espacios con miembros, ajustes del workspace (marca,
 * privacidad por defecto, retención), traspaso de contenido, pedidos de acceso,
 * pedido de email para ver, resumen por mail y pasar un video a Docs o Track.
 * Server-only. Las reglas de quién ve qué viven en lib/rec.ts.
 */
import { createHash } from 'crypto';
import { getDb } from './db';
import { escapeHtml } from './email';
import {
  dropRecFiles,
  getManageableVideo,
  inTx,
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
  MAX_REC_ALLOWED,
  MAX_RECAP_RECIPIENTS,
  REC_RECAP_DAILY,
  REC_RECAP_DAILY_NEW,
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

// ---------- Textos de lo que se manda: en el idioma de quien lo recibe ----------

type Lang = 'en' | 'es' | 'pt';
const TEXT = {
  en: {
    accessSubject: 'You can now watch the video you asked for',
    accessBody: 'Your request was approved. Open the video here:',
    sharedSubject: 'A video was shared with you',
    sharedBody: 'A video was shared with you on zerosoft. Open it here:',
    recapIntro: (from: string, title: string) => `${from} shared a recap of "${title}".`,
    recapSubject: (title: string) => `Recap: ${title}`,
    asked: (who: string, title: string) => `${who} asked to watch "${title}"`,
    moved: (who: string, v: number, f: number) => `${who} moved ${v} ${v === 1 ? 'video' : 'videos'} and ${f} ${f === 1 ? 'folder' : 'folders'} of someone who left to your library`,
    retentionStart: (n: number, days: number, date: string) => `${n} of your videos ${n === 1 ? 'is' : 'are'} older than ${days} days and will be deleted from ${date}`,
    retentionDeleted: (n: number) => `Retention deleted ${n} of your videos`,
  },
  es: {
    accessSubject: 'Ya podés ver el video que pediste',
    accessBody: 'Aprobaron tu pedido. Abrí el video acá:',
    sharedSubject: 'Te compartieron un video',
    sharedBody: 'Te compartieron un video en zerosoft. Abrilo acá:',
    recapIntro: (from: string, title: string) => `${from} compartió un resumen de "${title}".`,
    recapSubject: (title: string) => `Resumen: ${title}`,
    asked: (who: string, title: string) => `${who} pidió ver "${title}"`,
    moved: (who: string, v: number, f: number) => `${who} pasó a tu biblioteca ${v} ${v === 1 ? 'video' : 'videos'} y ${f} ${f === 1 ? 'carpeta' : 'carpetas'} de alguien que se fue`,
    retentionStart: (n: number, days: number, date: string) => `${n} de tus videos ${n === 1 ? 'tiene' : 'tienen'} más de ${days} días y se ${n === 1 ? 'va' : 'van'} a borrar desde el ${date}`,
    retentionDeleted: (n: number) => `La retención borró ${n} de tus videos`,
  },
  pt: {
    accessSubject: 'Você já pode assistir ao vídeo que pediu',
    accessBody: 'Seu pedido foi aprovado. Abra o vídeo aqui:',
    sharedSubject: 'Compartilharam um vídeo com você',
    sharedBody: 'Compartilharam um vídeo com você na zerosoft. Abra aqui:',
    recapIntro: (from: string, title: string) => `${from} compartilhou um resumo de "${title}".`,
    recapSubject: (title: string) => `Resumo: ${title}`,
    asked: (who: string, title: string) => `${who} pediu para assistir "${title}"`,
    moved: (who: string, v: number, f: number) => `${who} passou para sua biblioteca ${v} ${v === 1 ? 'vídeo' : 'vídeos'} e ${f} ${f === 1 ? 'pasta' : 'pastas'} de alguém que saiu`,
    retentionStart: (n: number, days: number, date: string) => `${n} dos seus vídeos ${n === 1 ? 'tem' : 'têm'} mais de ${days} dias e ${n === 1 ? 'será apagado' : 'serão apagados'} a partir de ${date}`,
    retentionDeleted: (n: number) => `A retenção apagou ${n} dos seus vídeos`,
  },
};

const lang = (l: unknown): Lang => (l === 'es' || l === 'pt' ? l : 'en');

async function userLang(id: string): Promise<Lang> {
  const r = (await getDb().prepare('SELECT locale FROM users WHERE id = ?').get(id).catch(() => undefined)) as { locale?: string | null } | undefined;
  return lang(r?.locale);
}

async function emailLang(email: string): Promise<Lang> {
  const r = (await getDb().prepare('SELECT locale FROM users WHERE lower(email) = ? LIMIT 1').get(email.toLowerCase()).catch(() => undefined)) as { locale?: string | null } | undefined;
  return lang(r?.locale);
}

/** Registro de lo que hacen los admins y de lo que sale de Rec. */
export async function recAudit(ws: string, actor: string, action: string, detail: Record<string, unknown>, db: Pick<ReturnType<typeof getDb>, 'prepare'> = getDb()): Promise<void> {
  await db.prepare('INSERT INTO rec_audit (id, workspace_id, actor_id, action, detail) VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), ws, actor, action, JSON.stringify(detail));
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
 * Borra el espacio, todo o nada. Sus videos vuelven a "Mis videos" de quien los
 * grabó, sin que nadie gane acceso, y sus carpetas desaparecen.
 */
export async function deleteSpace(a: RecActor, id: string): Promise<void> {
  await manageableSpace(a, id);
  await inTx(async (t) => {
    // "Solo workspace" adentro de un espacio era solo para sus miembros: en un video personal abriría a todo el workspace.
    await t
      .prepare("UPDATE rec_videos SET people_only = CASE WHEN privacy = 'workspace' THEN 1 ELSE people_only END, space = 'personal', space_id = NULL, folder_id = NULL WHERE space_id = ?")
      .run(id);
    await t.prepare('DELETE FROM rec_folders WHERE space_id = ?').run(id);
    await t.prepare('DELETE FROM rec_space_members WHERE space_id = ?').run(id);
    await t.prepare('DELETE FROM rec_spaces WHERE id = ?').run(id);
  });
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
  await inTx(async (t) => {
    await t.prepare('DELETE FROM rec_space_members WHERE space_id = ?').run(id);
    for (const u of next) await t.prepare('INSERT OR IGNORE INTO rec_space_members (space_id, user_id) VALUES (?, ?)').run(id, u);
  });
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
  let startsAt: string | null = null;
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
      if (cur.retention_days === null || days < cur.retention_days) {
        startsAt = dateDb(Date.now() + REC_RETENTION_GRACE_DAYS * 86_400_000);
        set('retention_starts_at', startsAt);
      }
    }
  }
  if (sets.length) await db.prepare(`UPDATE rec_settings SET ${sets.join(', ')}, updated_at = datetime('now') WHERE workspace_id = ?`).run(...args, a.ws);
  if (startsAt && patch.retentionDays) {
    await recAudit(a.ws, a.actor, 'retention_on', { days: patch.retentionDays, startsAt });
    await notifyRetentionStart(a.ws, patch.retentionDays, startsAt).catch(() => undefined);
  }
  return getRecSettings(a.ws);
}

export async function setBrandLogo(a: RecActor, url: string | null): Promise<void> {
  requireAdmin(a);
  const db = getDb();
  await db.prepare('INSERT OR IGNORE INTO rec_settings (workspace_id) VALUES (?)').run(a.ws);
  const cur = await settingsRow(a.ws);
  await db.prepare("UPDATE rec_settings SET brand_logo_url = ?, updated_at = datetime('now') WHERE workspace_id = ?").run(url, a.ws);
  if (cur?.brand_logo_url && cur.brand_logo_url !== url) await dropRecFiles([cur.brand_logo_url]).catch(() => undefined);
}

// ============================================================
// Retención
// ============================================================

/** Corte del primer borrado: lo que para entonces (pasado el aviso) tenga más de `days` días. */
function firstRunCutoff(days: number): string {
  return dateDb(Date.now() - (days - REC_RETENTION_GRACE_DAYS) * 86_400_000);
}

/** Cuántos videos se borrarían en el primer borrado, pasado el aviso (lo que se confirma antes de prenderla). */
export async function retentionPreview(a: RecActor, days: number): Promise<number> {
  requireAdmin(a);
  const row = (await getDb()
    .prepare("SELECT COUNT(*) AS n FROM rec_videos WHERE workspace_id = ? AND status = 'ready' AND created_at < ?")
    .get(a.ws, firstRunCutoff(days))) as { n: number };
  return Number(row.n) || 0;
}

/** Al empezar el plazo de aviso: a cada persona, cuántos de sus videos se van a borrar y desde cuándo. */
async function notifyRetentionStart(ws: string, days: number, startsAt: string): Promise<void> {
  const rows = (await getDb()
    .prepare("SELECT created_by, COUNT(*) AS n FROM rec_videos WHERE workspace_id = ? AND status = 'ready' AND created_at < ? GROUP BY created_by LIMIT 500")
    .all(ws, firstRunCutoff(days))) as Array<{ created_by: string; n: number }>;
  const { createNotification } = await import('./notifications');
  for (const r of rows) {
    const l = await userLang(r.created_by);
    const date = new Intl.DateTimeFormat(l, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${startsAt.replace(' ', 'T')}Z`));
    await createNotification({ userId: r.created_by, type: 'rec_retention', title: TEXT[l].retentionStart(Number(r.n), days, date), href: '/app/rec', sourceType: 'rec_retention', sourceId: ws, meta: {} }).catch(() => undefined);
  }
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
      .prepare("SELECT id, created_by, url, audio_url, thumb_url, gif_url, trimmed_url FROM rec_videos WHERE workspace_id = ? AND status = 'ready' AND created_at < ? LIMIT ?")
      .all(w.workspace_id, cutoff, left)) as Array<Pick<RecVideoRow, 'id' | 'created_by' | 'url' | 'audio_url' | 'thumb_url' | 'gif_url' | 'trimmed_url'>>;
    let here = 0;
    let stopped = false;
    const byAuthor = new Map<string, number>();
    for (const v of videos) {
      if (Date.now() - start > budget) {
        stopped = true;
        break;
      }
      const res = await db.prepare("DELETE FROM rec_videos WHERE id = ? AND status = 'ready' AND created_at < ?").run(v.id, cutoff);
      if (!res.changes) continue;
      here++;
      byAuthor.set(v.created_by, (byAuthor.get(v.created_by) ?? 0) + 1);
      await dropRecFiles([v.url, v.audio_url, v.thumb_url, v.gif_url, v.trimmed_url].filter((u): u is string => !!u)).catch(() => undefined);
    }
    left -= here;
    deleted += here;
    if (here) {
      await db.prepare('UPDATE rec_settings SET retention_deleted = retention_deleted + ? WHERE workspace_id = ?').run(here, w.workspace_id);
      const { createNotification } = await import('./notifications');
      for (const [author, n] of byAuthor) {
        const l = await userLang(author);
        await createNotification({ userId: author, type: 'rec_retention', title: TEXT[l].retentionDeleted(n), href: '/app/rec', sourceType: 'rec_retention', sourceId: w.workspace_id, meta: {} }).catch(() => undefined);
      }
    }
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

/**
 * Quién se fue del workspace y dejó videos o carpetas. Solo admins. `current` son
 * todas las personas que están hoy, también invitadas: a ellas no se les saca nada.
 */
export async function listContentOwners(a: RecActor, current: string[]): Promise<RecContentOwner[]> {
  requireAdmin(a);
  const rows = (await getDb()
    .prepare(
      `SELECT o.created_by AS user_id, COALESCE(u.name, u.email, '') AS name, SUM(o.videos) AS videos, SUM(o.folders) AS folders FROM (
         SELECT created_by, COUNT(*) AS videos, 0 AS folders FROM rec_videos WHERE workspace_id = ? AND status != 'recording' GROUP BY created_by
         UNION ALL
         SELECT created_by, 0, COUNT(*) FROM rec_folders WHERE workspace_id = ? GROUP BY created_by
       ) o LEFT JOIN users u ON u.id = o.created_by GROUP BY o.created_by ORDER BY name LIMIT 500`,
    )
    .all(a.ws, a.ws)) as Array<{ user_id: string; name: string; videos: number; folders: number }>;
  return rows
    .filter((r) => r.user_id !== a.ws && !current.includes(r.user_id))
    .map((r) => ({ userId: r.user_id, name: r.name, videos: Number(r.videos) || 0, folders: Number(r.folders) || 0 }));
}

/**
 * Pasa los videos y carpetas de alguien que se fue a otra persona del workspace,
 * de una sola vez y con registro. Nunca de la dueña ni de quien sigue (aunque sea
 * invitada), y nunca lo que se está grabando. Quien hace el pase solo se lo queda
 * si no hay nadie más. Los videos personales pasan a ser de quien los recibe.
 */
export async function transferContent(a: RecActor, from: string, to: string, targets: string[], current: string[]): Promise<{ videos: number; folders: number }> {
  requireAdmin(a);
  if (from === a.ws) throw new RecError('transfer_owner', 403);
  if (from === to || current.includes(from)) throw new RecError('transfer_not_former', 403);
  if (!targets.includes(to)) throw new RecError('invalid_input');
  if (to === a.actor && targets.some((t) => t !== a.actor)) throw new RecError('transfer_self', 403);
  const { videos, folders } = await inTx(async (t) => {
    const v = await t.prepare("UPDATE rec_videos SET created_by = ?, updated_at = datetime('now') WHERE workspace_id = ? AND created_by = ? AND status != 'recording'").run(to, a.ws, from);
    const f = await t.prepare("UPDATE rec_folders SET created_by = ?, updated_at = datetime('now') WHERE workspace_id = ? AND created_by = ?").run(to, a.ws, from);
    const out = { videos: Number(v.changes) || 0, folders: Number(f.changes) || 0 };
    if (out.videos || out.folders) await recAudit(a.ws, a.actor, 'transfer', { from, to, ...out }, t);
    return out;
  });
  if (videos || folders) {
    try {
      const { createNotification } = await import('./notifications');
      const l = await userLang(to);
      await createNotification({ userId: to, type: 'rec_access', title: TEXT[l].moved(a.name || 'Admin', videos, folders), href: '/app/rec', sourceType: 'rec_transfer', sourceId: from, meta: { actorName: a.name } });
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
  if (existing && existing.status !== 'approved') return existing.status;
  await limited(`rec:access:user:${email}`, 20, 3600);
  await limited(`rec:access:video:${v.id}`, 30, 3600);
  // Lo habían aprobado y le sacaron el acceso: el pedido vuelve a quedar pendiente.
  const res = existing
    ? await db.prepare("UPDATE rec_access_requests SET status = 'pending', decided_at = NULL WHERE video_id = ? AND email = ? AND status = 'approved'").run(v.id, email)
    : await db.prepare('INSERT OR IGNORE INTO rec_access_requests (id, video_id, email, name) VALUES (?, ?, ?, ?)').run(crypto.randomUUID(), v.id, email, person.name.trim().slice(0, 80));
  if (res.changes) {
    try {
      const { createNotification } = await import('./notifications');
      await createNotification({
        userId: v.created_by,
        type: 'rec_access',
        title: TEXT[await userLang(v.created_by)].asked(person.name || email, v.title),
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
  await getManageableVideo(a, videoId);
  const db = getDb();
  const req = (await db.prepare("SELECT email FROM rec_access_requests WHERE id = ? AND video_id = ? AND status = 'pending'").get(requestId, videoId)) as { email: string } | undefined;
  if (!req) throw new RecError('not_found', 404);
  const email = req.email;
  if (approve) {
    // Una sola sentencia: lee y escribe la lista a la vez, dos aprobaciones juntas no se pisan.
    const added = await db
      .prepare(
        `UPDATE rec_videos SET allowed_emails = (SELECT json_group_array(value) FROM (SELECT value FROM json_each(allowed_emails) UNION SELECT ?)), updated_at = datetime('now')
         WHERE id = ? AND (json_array_length(allowed_emails) < ? OR EXISTS (SELECT 1 FROM json_each(allowed_emails) WHERE value = ?))`,
      )
      .run(email, videoId, MAX_REC_ALLOWED, email);
    if (!added.changes) throw new RecError('allowed_full', 409);
  }
  const claim = await db.prepare("UPDATE rec_access_requests SET status = ?, decided_at = datetime('now') WHERE id = ? AND status = 'pending'").run(approve ? 'approved' : 'denied', requestId);
  const after = (await getDb().prepare('SELECT allowed_emails FROM rec_videos WHERE id = ?').get(videoId)) as { allowed_emails: string };
  if (approve && claim.changes) {
    const { sendEmail, appSender } = await import('./email');
    const tx = TEXT[await emailLang(email)];
    // Sin el título ni el nombre: a alguien de afuera no le sale texto libre.
    await sendEmail({
      to: email,
      from: appSender(),
      subject: tx.accessSubject,
      text: `${tx.accessBody}\n\n${shareUrl}`,
      html: `<p>${escapeHtml(tx.accessBody)}</p><p><a href="${escapeHtml(shareUrl)}">${escapeHtml(shareUrl)}</a></p>`,
      idempotencyKey: `rec-access-${requestId}`,
    }).catch(() => undefined);
  }
  return { allowedEmails: parseJson<string[]>(after.allowed_emails, []) };
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
  locale: string = 'en',
): { subject: string; text: string; html: string } {
  const tx = TEXT[lang(locale)];
  const lines = [tx.recapIntro(from, v.title), ''];
  if (content.summary.trim()) lines.push(content.summary.trim(), '');
  if (content.chapters.length) lines.push(...content.chapters.map((c) => `${fmtClock(c.start)} ${c.title}`), '');
  lines.push(shareUrl);
  const html = [
    `<p>${escapeHtml(tx.recapIntro(from, v.title))}</p>`,
    content.summary.trim() ? `<p>${escapeHtml(content.summary.trim())}</p>` : '',
    content.chapters.length ? `<ul>${content.chapters.map((c) => `<li>${fmtClock(c.start)} ${escapeHtml(c.title)}</li>`).join('')}</ul>` : '',
    `<p><a href="${escapeHtml(shareUrl)}">${escapeHtml(shareUrl)}</a></p>`,
  ].join('');
  return { subject: tx.recapSubject(v.title).slice(0, 200), text: lines.join('\n'), html };
}

/** A alguien de afuera del workspace: texto fijo y el link, nada que haya escrito una persona. */
export function outsideRecapEmail(shareUrl: string, locale: string = 'en'): { subject: string; text: string; html: string } {
  const tx = TEXT[lang(locale)];
  return {
    subject: tx.sharedSubject,
    text: `${tx.sharedBody}\n\n${shareUrl}`,
    html: `<p>${escapeHtml(tx.sharedBody)}</p><p><a href="${escapeHtml(shareUrl)}">${escapeHtml(shareUrl)}</a></p>`,
  };
}

/**
 * Manda el resumen solo a miembros del workspace (`memberEmails`) y a quienes ya
 * tienen permiso en este video; a estos últimos, si son de afuera, sin texto libre.
 * Cuenta destinatarios: REC_RECAP_DAILY por día y por workspace, REC_RECAP_DAILY_NEW
 * si la cuenta que manda o la del workspace tienen menos de 7 días. La misma lista
 * con el mismo contenido no sale dos veces, y cada envío lleva clave de idempotencia.
 */
export async function sendRecap(a: RecActor, id: string, rawEmails: string[], shareUrl: string, memberEmails: string[]): Promise<{ sent: number; duplicate: boolean }> {
  const v = await getManageableVideo(a, id);
  if (v.status !== 'ready') throw new RecError('not_ready', 409);
  const emails = cleanEmails(rawEmails).sort();
  if (!emails.length) throw new RecError('invalid_input');
  if (emails.length > MAX_RECAP_RECIPIENTS) throw new RecError('too_many_recipients');
  const members = new Set(memberEmails.map((e) => e.toLowerCase()));
  const allowed = new Set(parseJson<string[]>(v.allowed_emails, []));
  if (emails.some((e) => !members.has(e) && !allowed.has(e))) throw new RecError('recap_outside', 403);
  const content = visibleContent(v, false);
  const base = recapEmail(v, content, shareUrl, a.name || 'Someone');
  const key = createHash('sha256').update(JSON.stringify([id, emails, base.subject, base.text])).digest('hex').slice(0, 40);
  const db = getDb();
  if (await db.prepare('SELECT 1 FROM rec_recaps WHERE key = ?').get(key)) return { sent: 0, duplicate: true };
  const ages = (await db.prepare('SELECT MAX(created_at) AS newest FROM users WHERE id IN (?, ?)').get(a.actor, a.ws)) as { newest: string | null };
  const newest = ages.newest ? new Date(`${ages.newest.replace(' ', 'T').replace(/Z$/, '')}Z`).getTime() : 0;
  const cap = Date.now() - newest < 7 * 86_400_000 ? REC_RECAP_DAILY_NEW : REC_RECAP_DAILY;
  // Se reclama antes de mandar, en una sola sentencia con la cuenta del día: dos envíos a la vez no pasan el tope.
  const claim = await db
    .prepare(
      `INSERT OR IGNORE INTO rec_recaps (key, workspace_id, video_id, recipients, n, sent_by)
       SELECT ?, ?, ?, ?, ?, ? WHERE (SELECT COALESCE(SUM(n), 0) FROM rec_recaps WHERE workspace_id = ? AND created_at >= datetime('now', '-1 day')) + ? <= ?`,
    )
    .run(key, a.ws, id, JSON.stringify(emails), emails.length, a.actor, a.ws, emails.length, cap);
  if (!claim.changes) {
    if (await db.prepare('SELECT 1 FROM rec_recaps WHERE key = ?').get(key)) return { sent: 0, duplicate: true };
    throw new RecError('recap_quota', 429);
  }
  const { sendEmail, appSender } = await import('./email');
  let sent = 0;
  for (const to of emails) {
    const l = await emailLang(to);
    const mail = members.has(to) ? recapEmail(v, content, shareUrl, a.name || 'Someone', l) : outsideRecapEmail(shareUrl, l);
    const r = await sendEmail({ to, from: appSender(), ...mail, idempotencyKey: `rec-recap-${key}-${createHash('sha256').update(to).digest('hex').slice(0, 12)}` }).catch(() => ({ ok: false }));
    if (r.ok) sent++;
  }
  if (!sent) {
    // No salió ninguno: se puede reintentar.
    await db.prepare('DELETE FROM rec_recaps WHERE key = ?').run(key);
    throw new RecError('recap_failed', 502);
  }
  await db.prepare('UPDATE rec_recaps SET sent = ? WHERE key = ?').run(sent, key);
  await recAudit(a.ws, a.actor, 'recap', { video: id, recipients: emails.length, sent });
  return { sent, duplicate: false };
}
