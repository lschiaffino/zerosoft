/**
 * Send: lo que pasa del lado de quien abre un link, sin cuenta. Server-only.
 *
 * - Cada pedido vuelve a mirar el link: deshabilitado, vencido o borrado corta en
 *   ese momento, también las imágenes (no hay caché ni URLs firmadas).
 * - GET de la página no escribe nada. La sesión nace con un POST del navegador y
 *   la visita con el primer aviso, tras unos segundos con la pestaña visible:
 *   un previsualizador de links o un escáner de correo no cuentan ni avisan.
 * - Sin copia del archivo en el navegador: páginas como imágenes por sesión.
 */
import { createHash, randomBytes } from 'crypto';
import UAParser from 'ua-parser-js';
import { getDb } from '../db';
import { verifyPassword } from '../links';
import { contextFromHeaders } from '../track';
import { isBotUserAgent } from '../analytics/bots';
import { peekCount, rateLimit } from '../rate-limit';
import { appSender, escapeHtml, renderBrandedHtml, sendEmail } from '../email';
import { createNotification } from '../notifications';
import { localized, renderForRecipient } from '../notification-copy';
import { deleteSendFiles, readSendFile, storeSendFile } from './files';
import { getBranding, pagesOf, readRange, storeRefsOf, type DocumentRow, type LinkRow, type VersionRow } from './core';
import { activeRecipients, creatorAccess, creatorSees, linkProblem } from './access';
import { linkContact } from './crm';
import { sendCopy, type SendLocale } from './i18n';
import {
  acceptedSeconds,
  ALERT_WINDOW_MS,
  ALERTS_PER_HOUR,
  firstClaim,
  isScriptedUserAgent,
  CODE_ATTEMPTS,
  CODE_MINUTES,
  deviceKind,
  hashCode,
  hashToken,
  isForwarded,
  linkNeedsEmail,
  linkNeedsVerify,
  linkState,
  MIN_FIRST_SECONDS,
  newCode,
  newId,
  normalizeEmail,
  nextGate,
  nowIso,
  PART_BYTES,
  scaleDeltas,
  SendError,
  SESSION_DAYS,
  TOKEN_RE,
  VISIT_GAP_MS,
  type GateStep,
  type PageLink,
} from './types';

const PASSCODE_PER_IP = 8;
const PASSCODE_IP_WINDOW = 900;
const PASSCODE_PER_LINK = 600;
const PASSCODE_SLOW_AFTER = 30;

export interface SessionRow {
  id: string;
  link_id: string;
  workspace_id: string;
  visitor_id: string | null;
  token_hash: string;
  epoch: number;
  passcode_ok: number;
  email: string | null;
  email_verified: number;
  nda_envelope_id: string | null;
  nda_signed_at: string | null;
  created_at: string;
  expires_at: string;
}

// ---------- Link y sesión ----------

export async function resolveLink(token: string): Promise<LinkRow | null> {
  if (!TOKEN_RE.test(token)) return null;
  const db = getDb();
  const link = (await db.prepare('SELECT * FROM send_links WHERE token_hash = ? AND deleted_at IS NULL').get(hashToken(token))) as LinkRow | undefined;
  if (!link) return null;
  if (link.document_id) {
    const d = (await db.prepare('SELECT id FROM send_documents WHERE id = ? AND deleted_at IS NULL').get(link.document_id)) as { id: string } | undefined;
    if (!d) return null;
  } else if (link.space_id) {
    const s = (await db.prepare('SELECT id FROM send_spaces WHERE id = ? AND deleted_at IS NULL').get(link.space_id)) as { id: string } | undefined;
    if (!s) return null;
    // Acceso por persona: con lista, el espacio está cerrado para quien no figura.
    const rows = (await db.prepare('SELECT email FROM send_space_access WHERE space_id = ?').all(link.space_id)) as Array<{ email: string }>;
    if (rows.length) link.space_emails = rows.map((r) => r.email);
  } else return null;
  return link;
}

export async function loadSession(link: LinkRow, cookie: string | undefined | null): Promise<SessionRow | null> {
  if (!cookie || cookie.length > 100) return null;
  const db = getDb();
  const s = (await db.prepare('SELECT * FROM send_sessions WHERE token_hash = ? AND link_id = ?').get(hashToken(cookie), link.id)) as SessionRow | undefined;
  if (!s) return null;
  if (new Date(s.expires_at).getTime() <= Date.now()) {
    await db.prepare('DELETE FROM send_sessions WHERE id = ?').run(s.id);
    return null;
  }
  // El dueño cambió las reglas del link: quien ya entró vuelve a pasar los pasos.
  if (Number(s.epoch) !== Number(link.access_epoch)) {
    await db
      .prepare('UPDATE send_sessions SET epoch = ?, passcode_ok = 0, email = NULL, email_verified = 0, nda_envelope_id = NULL, nda_signed_at = NULL, visitor_id = NULL WHERE id = ?')
      .run(link.access_epoch, s.id);
    return { ...s, epoch: link.access_epoch, passcode_ok: 0, email: null, email_verified: 0, nda_envelope_id: null, nda_signed_at: null, visitor_id: null };
  }
  return s;
}

export async function createSession(link: LinkRow): Promise<{ session: SessionRow; cookie: string }> {
  const cookie = randomBytes(24).toString('base64url');
  const id = newId('ss');
  const ts = nowIso();
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  await getDb()
    .prepare('INSERT INTO send_sessions (id, link_id, workspace_id, token_hash, epoch, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, link.id, link.workspace_id, hashToken(cookie), link.access_epoch, ts, expires);
  const session = (await getDb().prepare('SELECT * FROM send_sessions WHERE id = ?').get(id)) as SessionRow;
  return { session, cookie };
}

export const SESSION_MAX_AGE = SESSION_DAYS * 86_400;

async function logEvent(link: LinkRow, type: string, email: string | null, detail = ''): Promise<void> {
  await getDb()
    .prepare('INSERT INTO send_events (id, workspace_id, link_id, document_id, type, email, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(newId('se'), link.workspace_id, link.id, link.document_id, type, email, detail.slice(0, 300), nowIso());
}

// ---------- Lo que ve el navegador ----------

export interface ViewerDoc {
  id: string;
  title: string;
  kind: string;
  versionId: string;
  pages: Array<{ page: number; width: number; height: number; links: PageLink[] }>;
  pageCount: number;
  durationSec: number | null;
  bucketSec: number | null;
  downloadable: boolean;
  folder: string;
}

export interface ViewerBrand {
  name: string;
  logoUrl: string;
  color: string;
  siteUrl: string;
}

export type ViewerState =
  | { state: 'closed'; reason: 'disabled' | 'expired' | 'unavailable'; brand: ViewerBrand }
  // Sin pasos y sin sesión: el navegador la abre con un POST. El HTML no lleva el título ni nada del documento.
  | { state: 'start'; brand: ViewerBrand }
  | {
      state: 'gate';
      step: GateStep;
      brand: ViewerBrand;
      email: string | null;
      needsEmail: boolean;
      needsPasscode: boolean;
      needsVerify: boolean;
    }
  | {
      state: 'open';
      brand: ViewerBrand;
      message: string;
      email: string | null;
      emailVerified: boolean;
      watermark: boolean;
      space: { title: string; description: string } | null;
      documents: ViewerDoc[];
    };

async function brandOf(link: LinkRow): Promise<ViewerBrand> {
  if (!link.use_branding) return { name: '', logoUrl: '', color: '', siteUrl: '' };
  const b = await getBranding(link.workspace_id);
  return { name: b.brandName, logoUrl: b.logoUrl, color: b.brandColor, siteUrl: b.siteUrl };
}

interface LinkDocRow {
  doc: DocumentRow;
  version: VersionRow;
  folder: string;
  downloadable: boolean;
}

/** Documentos que este link muestra, y a esta persona, con su versión actual lista. */
export async function linkDocuments(link: LinkRow, email: string | null): Promise<LinkDocRow[]> {
  const db = getDb();
  const { role } = await creatorAccess(link.workspace_id, link.created_by);
  if (link.document_id) {
    const doc = (await db.prepare('SELECT * FROM send_documents WHERE id = ? AND deleted_at IS NULL').get(link.document_id)) as DocumentRow | undefined;
    if (!doc?.current_version_id || !creatorSees(link, role, doc)) return [];
    const version = (await db.prepare('SELECT * FROM send_versions WHERE id = ?').get(doc.current_version_id)) as VersionRow;
    return [{ doc, version, folder: '', downloadable: !!link.allow_download }];
  }
  const rows = (await db
    .prepare(
      `SELECT d.*, i.folder AS item_folder
       FROM send_space_items i
       JOIN send_documents d ON d.id = i.document_id AND d.deleted_at IS NULL
       WHERE i.space_id = ? ORDER BY i.position, i.added_at`,
    )
    .all(link.space_id)) as Array<DocumentRow & { item_folder: string }>;
  // Acceso por persona: cada email ve solo lo que dice su fila.
  let only: Set<string> | null = null;
  if (link.space_emails) {
    const grant = email ? ((await db.prepare('SELECT document_ids FROM send_space_access WHERE space_id = ? AND email = ?').get(link.space_id, email)) as { document_ids: string } | undefined) : undefined;
    only = new Set();
    if (grant) {
      try {
        const ids = JSON.parse(grant.document_ids);
        if (Array.isArray(ids)) only = new Set(ids.map(String));
      } catch {
        only = new Set();
      }
    }
  }
  const out: LinkDocRow[] = [];
  for (const r of rows) {
    if (!r.current_version_id || !creatorSees(link, role, r)) continue;
    if (only && !only.has(r.id)) continue;
    const version = (await db.prepare('SELECT * FROM send_versions WHERE id = ?').get(r.current_version_id)) as VersionRow;
    out.push({ doc: r, version, folder: r.item_folder, downloadable: !!link.allow_download });
  }
  return out;
}

export async function viewerState(link: LinkRow, session: SessionRow | null): Promise<ViewerState> {
  const brand = await brandOf(link);
  const ls = linkState(link);
  if (ls !== 'active') return { state: 'closed', reason: ls, brand };
  // Quien lo armó ya no puede publicarlo: no hay nada que pedirle a quien lo abre.
  if (await linkProblem(link)) return { state: 'closed', reason: 'unavailable', brand };
  const step = nextGate(link, session);
  if (step) {
    return {
      state: 'gate',
      step,
      brand,
      email: session?.email ?? null,
      needsEmail: linkNeedsEmail(link),
      needsPasscode: !!link.passcode_hash,
      needsVerify: linkNeedsVerify(link),
    };
  }
  if (!session) return { state: 'start', brand };
  const docs = await linkDocuments(link, session.email);
  const documents: ViewerDoc[] = [];
  for (const d of docs) {
    documents.push({
      id: d.doc.id,
      title: d.doc.title,
      kind: d.version.kind,
      versionId: d.version.id,
      pages: d.version.kind === 'video' ? [] : await pagesOf(d.version.id),
      pageCount: Number(d.version.page_count),
      durationSec: d.version.duration_sec === null ? null : Number(d.version.duration_sec),
      bucketSec: d.version.bucket_sec === null ? null : Number(d.version.bucket_sec),
      // Un video no se puede marcar en el servidor: con watermark no se descarga.
      downloadable: d.downloadable && !(link.watermark && d.version.kind === 'video'),
      folder: d.folder,
    });
  }
  let space: { title: string; description: string } | null = null;
  if (link.space_id) {
    const s = (await getDb().prepare('SELECT title, description FROM send_spaces WHERE id = ?').get(link.space_id)) as { title: string; description: string } | undefined;
    if (s) space = s;
  }
  return { state: 'open', brand, message: link.message, email: session.email, emailVerified: !!session.email_verified, watermark: !!link.watermark, space, documents };
}

/** Sesión que puede ver, o el motivo por el que no. Lo usa cada imagen, video y descarga. */
export async function requireViewer(link: LinkRow, cookie: string | undefined | null): Promise<SessionRow> {
  const ls = linkState(link);
  if (ls !== 'active') throw new SendError(`link_${ls}`, 410);
  const session = await loadSession(link, cookie);
  if (nextGate(link, session)) throw new SendError('gate_required', 401);
  if (session) return session;
  throw new SendError('gate_required', 401);
}

/** Texto del watermark: email, y a qué hora se vio. Sale en cada imagen desde el servidor. */
export function watermarkText(session: SessionRow, now = new Date()): string {
  const stamp = now.toISOString().slice(0, 16).replace('T', ' ');
  return `${session.email ?? 'unknown'} · ${stamp} UTC`;
}

// ---------- Pasos ----------

async function upsertVisitor(workspaceId: string, email: string): Promise<string> {
  const db = getDb();
  const id = newId('sr');
  const ts = nowIso();
  await db
    .prepare(
      `INSERT INTO send_visitors (id, workspace_id, email, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (workspace_id, email) WHERE email IS NOT NULL DO UPDATE SET last_seen_at = excluded.last_seen_at`,
    )
    .run(id, workspaceId, email, ts, ts);
  const row = (await db.prepare('SELECT id FROM send_visitors WHERE workspace_id = ? AND email = ?').get(workspaceId, email)) as { id: string };
  return row.id;
}

export async function submitPasscode(link: LinkRow, session: SessionRow, passcode: string, ipKey: string): Promise<void> {
  if (!link.passcode_hash) return;
  // Se cuenta antes de comparar: 50 pedidos a la vez no ganan intentos. Si acierta, el intento se devuelve.
  const ipKeyName = `send:pass:${link.id}:${ipKey}`;
  const linkKey = `send:passlink:${link.id}`;
  const byIp = await rateLimit(ipKeyName, PASSCODE_PER_IP, PASSCODE_IP_WINDOW);
  const byLink = await rateLimit(linkKey, PASSCODE_PER_LINK, 3600);
  // Muchos fallos en el link, desde cualquier IP: se frena con ventanas cortas, sin retener el pedido.
  const slow = PASSCODE_PER_LINK - byLink.remaining > PASSCODE_SLOW_AFTER ? await rateLimit(`send:passslow:${link.id}`, 5, 10) : { ok: true };
  if (!byIp.ok || !byLink.ok || !slow.ok) throw new SendError('too_many_attempts', 429);
  const ok = await verifyPassword(passcode.trim().slice(0, 100), link.passcode_hash);
  if (!ok) {
    await logEvent(link, 'passcode_failed', session.email);
    throw new SendError('bad_passcode', 401);
  }
  await refundAttempt(ipKeyName, PASSCODE_IP_WINDOW);
  await refundAttempt(linkKey, 3600);
  await getDb().prepare('UPDATE send_sessions SET passcode_ok = 1 WHERE id = ?').run(session.id);
}

async function refundAttempt(key: string, windowSec: number): Promise<void> {
  const windowMs = windowSec * 1000;
  await getDb()
    .prepare('UPDATE rate_limits SET count = count - 1 WHERE key = ? AND window_start = ? AND count > 0')
    .run(key, Math.floor(Date.now() / windowMs) * windowMs)
    .catch(() => undefined);
}

/**
 * Cambiar de email es otra persona: se va la verificación y el acuerdo. El mismo
 * email otra vez no cambia nada.
 */
export async function submitEmail(link: LinkRow, session: SessionRow, raw: string): Promise<void> {
  const email = normalizeEmail(raw);
  if (!email) throw new SendError('invalid_email', 400);
  if (email === session.email) return;
  const visitorId = await upsertVisitor(link.workspace_id, email);
  await getDb()
    .prepare('UPDATE send_sessions SET email = ?, email_verified = 0, visitor_id = ?, nda_envelope_id = NULL, nda_signed_at = NULL WHERE id = ?')
    .run(email, visitorId, session.id);
}

export async function clearEmail(session: SessionRow): Promise<void> {
  await getDb().prepare('UPDATE send_sessions SET email = NULL, email_verified = 0, visitor_id = NULL, nda_envelope_id = NULL, nda_signed_at = NULL WHERE id = ?').run(session.id);
}

export async function sendEmailCode(link: LinkRow, session: SessionRow, locale: SendLocale, ipKey: string): Promise<void> {
  if (!session.email) throw new SendError('email_required', 400);
  const byEmail = await rateLimit(`send:code:${link.id}:${session.email}`, 5, 3600);
  const byIp = await rateLimit(`send:codeip:${ipKey}`, 20, 3600);
  if (!byEmail.ok || !byIp.ok) throw new SendError('too_many_attempts', 429);
  const code = newCode();
  const db = getDb();
  await db.prepare('UPDATE send_email_codes SET used_at = ? WHERE session_id = ? AND used_at IS NULL').run(nowIso(), session.id);
  await db
    .prepare('INSERT INTO send_email_codes (id, session_id, email, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(newId('sc'), session.id, session.email, hashCode(session.id, code), new Date(Date.now() + CODE_MINUTES * 60_000).toISOString(), nowIso());
  const brand = await brandOf(link);
  const subject = sendCopy(locale, 'codeSubject', { code });
  const line = sendCopy(locale, 'codeLine', { minutes: String(CODE_MINUTES) });
  const res = await sendEmail({
    to: session.email,
    from: appSender(),
    subject,
    text: `${code}\n\n${line}`,
    html: renderBrandedHtml({ eyebrow: brand.name || 'zerosoft', heading: code, paragraphs: [escapeHtml(line)] }),
  }).catch(() => ({ ok: false }));
  if (!res.ok) throw new SendError('email_failed', 502);
  await logEvent(link, 'code_sent', session.email);
}

export async function verifyEmailCode(link: LinkRow, session: SessionRow, code: string): Promise<void> {
  const db = getDb();
  const row = (await db
    .prepare('SELECT * FROM send_email_codes WHERE session_id = ? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1')
    .get(session.id)) as { id: string; email: string; code_hash: string; attempts: number; expires_at: string } | undefined;
  if (!row || row.email !== session.email || new Date(row.expires_at).getTime() <= Date.now()) throw new SendError('code_expired', 410);
  // Se cuenta el intento antes de comparar: dos pedidos a la vez no ganan intentos extra.
  const claim = await db.prepare('UPDATE send_email_codes SET attempts = attempts + 1 WHERE id = ? AND attempts < ?').run(row.id, CODE_ATTEMPTS);
  if (!claim.changes) throw new SendError('code_expired', 410);
  if (hashCode(session.id, code.trim().slice(0, 12)) !== row.code_hash) throw new SendError('bad_code', 401);
  const used = await db.prepare('UPDATE send_email_codes SET used_at = ? WHERE id = ? AND used_at IS NULL').run(nowIso(), row.id);
  if (!used.changes) throw new SendError('code_expired', 410);
  // Atado al email del código: si la sesión cambió de email en el medio, no verifica al nuevo.
  const verified = await db.prepare('UPDATE send_sessions SET email_verified = 1 WHERE id = ? AND email = ?').run(session.id, row.email);
  if (!verified.changes) throw new SendError('code_expired', 410);
  await logEvent(link, 'email_verified', session.email);
}

/** Paso `denied`: queda registrado una vez por sesión, y al dueño le llega un aviso (con tope por link). */
export async function recordDenied(link: LinkRow, session: SessionRow): Promise<void> {
  const already = await peekCount(`send:denied:${session.id}:${session.email ?? ''}`, 86_400);
  if (already) return;
  await rateLimit(`send:denied:${session.id}:${session.email ?? ''}`, 1000, 86_400);
  await logEvent(link, 'denied', session.email);
  if (!link.notify || !(await claimAlert(link))) return;
  const doc = await targetTitle(link);
  await createNotification({
    userId: link.created_by,
    type: 'send_activity',
    title: localized('sendDenied', { who: session.email, title: doc }),
    href: linkHref(link),
    sourceType: 'send_link',
    sourceId: link.id,
  }).catch(() => undefined);
}

// ---------- Avisos del navegador ----------

export interface PingDelta {
  page: number;
  seconds: number;
}

export interface PingInput {
  documentId: string;
  versionId: string;
  deltas: PingDelta[];
  webdriver?: boolean;
}

export interface RequestMeta {
  headers: Headers;
  ua: string;
}

/** Bots, navegadores automatizados y escáneres: no cuentan como visita. */
export function isAutomated(meta: RequestMeta, webdriver: boolean | undefined): boolean {
  if (!meta.ua.trim() || isBotUserAgent(meta.ua) || isScriptedUserAgent(meta.ua)) return true;
  if (webdriver && process.env.ANALYTICS_ALLOW_HEADLESS !== '1') return true;
  return false;
}

function visitSeq(sessionId: string, email: string | null, documentId: string, versionId: string, seq: number): string {
  const h = createHash('sha256').update(`${sessionId}|${email ?? ''}|${documentId}|${versionId}|${seq}`).digest('base64url').slice(0, 24);
  return `sx_${h}`;
}

/** La sesión pidió de verdad esta página (o el video, página 0): sin eso, no cuenta como vista. */
export async function markPageView(session: SessionRow, versionId: string, page: number): Promise<void> {
  await getDb().prepare('INSERT OR IGNORE INTO send_page_views (session_id, version_id, page) VALUES (?, ?, ?)').run(session.id, versionId, page);
}

/**
 * Suma tiempo a una visita. La primera vez crea la visita y avisa a quien mandó el
 * link. El id de la visita sale de la sesión, el email y el orden: dos pestañas que
 * empiezan a la vez caen en la misma fila, y otro email es otra visita.
 *
 * El tiempo se acota con el reloj del servidor, por visita, por sesión y por página, y
 * solo cuentan páginas que la sesión pidió.
 */
export async function recordPing(link: LinkRow, session: SessionRow, input: PingInput, meta: RequestMeta): Promise<{ visitId: string | null }> {
  if (isAutomated(meta, input.webdriver)) return { visitId: null };
  const docs = await linkDocuments(link, session.email);
  const target = docs.find((d) => d.doc.id === input.documentId);
  if (!target) throw new SendError('not_found', 404);
  // El dueño reemplazó el archivo mientras leían: el navegador recarga la versión nueva.
  if (target.version.id !== input.versionId) throw new SendError('version_changed', 409);
  const db = getDb();
  const isVideo = target.version.kind === 'video';
  const viewedRows = (await db.prepare('SELECT page FROM send_page_views WHERE session_id = ? AND version_id = ?').all(session.id, input.versionId)) as Array<{ page: number }>;
  const viewed = new Set(viewedRows.map((r) => Number(r.page)));
  const total = Number(target.version.page_count);
  const known = input.deltas.filter((d) => d.page <= total && (isVideo ? viewed.has(0) : viewed.has(d.page)));
  const claimed = known.reduce((n, d) => n + (Number.isFinite(d.seconds) ? Math.max(0, d.seconds) : 0), 0);
  const prev = (await db
    .prepare('SELECT id, last_ping_at, started_at, version_id, seconds, base_seconds FROM send_visits WHERE session_id = ? AND document_id = ? AND COALESCE(email, \'\') = ? ORDER BY started_at DESC LIMIT 1')
    .get(session.id, input.documentId, session.email ?? '')) as { id: string; last_ping_at: string; started_at: string; version_id: string; seconds: number; base_seconds: number } | undefined;
  const nowMs = Date.now();
  const same = prev && prev.version_id === input.versionId && nowMs - new Date(prev.last_ping_at).getTime() < VISIT_GAP_MS;
  let visitId: string;
  let created = false;
  let cap: number;
  let visitElapsed: number;
  let visitBase: number;
  if (same) {
    visitId = prev.id;
    visitElapsed = (nowMs - new Date(prev.started_at).getTime()) / 1000;
    visitBase = Number(prev.base_seconds);
    cap = acceptedSeconds(claimed, { elapsedSec: visitElapsed, usedSec: Number(prev.seconds), baseSec: visitBase });
    // Y en toda la sesión: dos documentos a la vez no suman más tiempo que el reloj.
    const all = (await db
      .prepare("SELECT MIN(started_at) AS first_at, COALESCE(SUM(seconds), 0) AS used, COALESCE(SUM(base_seconds), 0) AS base FROM send_visits WHERE session_id = ? AND last_ping_at >= ?")
      .get(session.id, new Date(nowMs - VISIT_GAP_MS).toISOString())) as { first_at: string | null; used: number; base: number };
    if (all.first_at) cap = Math.min(cap, acceptedSeconds(claimed, { elapsedSec: (nowMs - new Date(all.first_at).getTime()) / 1000, usedSec: Number(all.used), baseSec: Number(all.base) }));
  } else {
    // Nada de visita con menos de unos segundos: es lo que se ve de un escáner.
    cap = firstClaim(claimed, (nowMs - new Date(session.created_at).getTime()) / 1000);
    if (cap < MIN_FIRST_SECONDS) return { visitId: null };
    const n = (await db.prepare("SELECT COUNT(*) AS n FROM send_visits WHERE session_id = ? AND document_id = ? AND COALESCE(email, '') = ?").get(session.id, input.documentId, session.email ?? '')) as { n: number };
    visitId = visitSeq(session.id, session.email, input.documentId, input.versionId, Number(n.n));
    visitElapsed = 0;
    visitBase = cap;
    const ctx = contextFromHeaders(meta.headers);
    const ua = new UAParser(meta.ua).getResult();
    const ts = nowIso();
    const res = await db
      .prepare(
        `INSERT OR IGNORE INTO send_visits (id, workspace_id, link_id, session_id, visitor_id, document_id, version_id, email, email_verified, forwarded, started_at, last_ping_at, page_total, base_seconds, device, os, browser, country, city)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        visitId,
        link.workspace_id,
        link.id,
        session.id,
        session.visitor_id,
        input.documentId,
        input.versionId,
        session.email,
        session.email_verified ? 1 : 0,
        isForwarded(link.recipient_email, session.email) ? 1 : 0,
        ts,
        ts,
        total,
        cap,
        deviceKind(ua.device.type),
        (ua.os.name ?? '').slice(0, 40),
        (ua.browser.name ?? '').slice(0, 40),
        ctx.country,
        ctx.city,
      );
    created = res.changes > 0;
  }
  const deltas = scaleDeltas(known, cap).slice(0, 50);
  const pageRows = (await db.prepare('SELECT page, seconds FROM send_page_stats WHERE visit_id = ?').all(visitId)) as Array<{ page: number; seconds: number }>;
  const pageUsed = new Map(pageRows.map((r) => [Number(r.page), Number(r.seconds)]));
  const ts = nowIso();
  for (const d of deltas) {
    // Una página no puede tener más tiempo que la visita.
    const seconds = acceptedSeconds(d.seconds, { elapsedSec: visitElapsed, usedSec: pageUsed.get(d.page) ?? 0, baseSec: visitBase });
    if (seconds <= 0) continue;
    await db
      .prepare(
        `INSERT INTO send_page_stats (visit_id, page, seconds, first_at, last_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (visit_id, page) DO UPDATE SET seconds = seconds + excluded.seconds, last_at = excluded.last_at`,
      )
      .run(visitId, d.page, seconds, ts, ts);
  }
  const agg = (await db
    .prepare('SELECT COALESCE(SUM(seconds), 0) AS seconds, SUM(CASE WHEN seconds >= 1 THEN 1 ELSE 0 END) AS seen FROM send_page_stats WHERE visit_id = ?')
    .get(visitId)) as { seconds: number; seen: number | null };
  await db.prepare('UPDATE send_visits SET seconds = ?, pages_seen = ?, last_ping_at = ? WHERE id = ?').run(Number(agg.seconds), Number(agg.seen ?? 0), ts, visitId);
  await db.prepare('UPDATE send_links SET last_visit_at = ? WHERE id = ?').run(ts, link.id);
  if (session.visitor_id) await db.prepare('UPDATE send_visitors SET last_seen_at = ? WHERE id = ?').run(ts, session.visitor_id);
  if (created) {
    await alertReading(link, session, visitId, target.doc, Number(agg.seen ?? 0), total).catch((err) => console.error('[send:alert]', err instanceof Error ? err.message : 'error'));
    // Solo un email verificado llega al CRM: uno escrito se queda en Send.
    if (session.email && session.email_verified) await linkContact(link.workspace_id, session, target.doc).catch(() => undefined);
  }
  return { visitId };
}

// ---------- Avisos a quien mandó el link ----------

function linkHref(link: LinkRow): string {
  return link.document_id ? `/app/send/documents/${link.document_id}` : `/app/send/spaces/${link.space_id}`;
}

async function targetTitle(link: LinkRow): Promise<string> {
  const db = getDb();
  const r = link.document_id
    ? ((await db.prepare('SELECT title FROM send_documents WHERE id = ?').get(link.document_id)) as { title: string } | undefined)
    : ((await db.prepare('SELECT title FROM send_spaces WHERE id = ?').get(link.space_id)) as { title: string } | undefined);
  return r?.title ?? '';
}

/**
 * ¿Sale este aviso? Hasta ALERTS_PER_HOUR por hora y por link (compare-and-set en una
 * sola sentencia). Los demás se suman a un resumen que sale al cerrar la hora.
 */
async function claimAlert(link: LinkRow): Promise<boolean> {
  const db = getDb();
  const now = Date.now();
  const row = (await db
    .prepare(
      `UPDATE send_links SET
         alert_count = CASE WHEN alert_window_at IS NULL OR alert_window_at < ? THEN 1 ELSE alert_count + 1 END,
         alert_window_at = CASE WHEN alert_window_at IS NULL OR alert_window_at < ? THEN ? ELSE alert_window_at END
       WHERE id = ? RETURNING alert_count`,
    )
    .get(now - ALERT_WINDOW_MS, now - ALERT_WINDOW_MS, now, link.id)) as { alert_count: number } | undefined;
  if (Number(row?.alert_count ?? 1) <= ALERTS_PER_HOUR) return true;
  await db.prepare('UPDATE send_links SET alert_digest = alert_digest + 1 WHERE id = ?').run(link.id);
  return false;
}

/** Cron: el resumen de lo que no se avisó, una vez cerrada la hora. */
export async function flushAlertDigests(): Promise<number> {
  const db = getDb();
  const rows = (await db
    .prepare('SELECT * FROM send_links WHERE alert_digest > 0 AND alert_window_at < ? AND deleted_at IS NULL LIMIT 50')
    .all(Date.now() - ALERT_WINDOW_MS)) as LinkRow[];
  let sent = 0;
  for (const link of rows) {
    const claim = await db.prepare('UPDATE send_links SET alert_digest = 0 WHERE id = ? AND alert_digest = ?').run(link.id, link.alert_digest);
    if (!claim.changes) continue;
    const title = await targetTitle(link);
    const text = localized('sendDigest', { count: link.alert_digest, title, link: link.name || null });
    const owner = link.document_id ? ((await db.prepare('SELECT owner_id FROM send_documents WHERE id = ?').get(link.document_id)) as { owner_id: string } | undefined)?.owner_id : ((await db.prepare('SELECT owner_id FROM send_spaces WHERE id = ?').get(link.space_id)) as { owner_id: string } | undefined)?.owner_id;
    const recipients = await activeRecipients(link.workspace_id, [owner ?? link.created_by, link.created_by]);
    let failed = false;
    for (const userId of recipients) {
      const user = (await db.prepare('SELECT email FROM users WHERE id = ?').get(userId)) as { email: string | null } | undefined;
      if (user?.email) {
        const [subject] = await renderForRecipient(userId, [text]);
        const url = `${appOrigin()}${linkHref(link)}`;
        const res = await sendEmail({ to: user.email, from: appSender(), subject: subject ?? '', text: url, html: renderBrandedHtml({ eyebrow: 'Send', heading: subject ?? '', paragraphs: [`<a href="${escapeHtml(url)}" style="color:#000000;font-weight:500;">${escapeHtml(url)}</a>`] }) }).catch(() => ({ ok: false }));
        if (!res.ok) {
          failed = true;
          continue;
        }
      }
      await createNotification({ userId, type: 'send_activity', title: text, href: linkHref(link), sourceType: 'send_link', sourceId: link.id }).catch(() => undefined);
    }
    // Sin email: el resumen queda para la próxima pasada del cron, con lo que se sumó mientras tanto.
    if (failed) await db.prepare('UPDATE send_links SET alert_digest = alert_digest + ? WHERE id = ?').run(link.alert_digest, link.id);
    else sent++;
  }
  return sent;
}

function appOrigin(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXTAUTH_URL || '').replace(/\/$/, '');
}

/**
 * "Alguien está leyendo": un aviso en la campana y un email, una vez por visita y
 * nunca dos veces en media hora para la misma sesión (compare-and-set por fila).
 */
async function alertReading(link: LinkRow, session: SessionRow, visitId: string, doc: DocumentRow, seen: number, total: number): Promise<void> {
  if (!link.notify) return;
  const db = getDb();
  const since = new Date(Date.now() - VISIT_GAP_MS).toISOString();
  const recent = (await db
    .prepare('SELECT 1 AS x FROM send_visits WHERE session_id = ? AND id <> ? AND alerted_at >= ? LIMIT 1')
    .get(session.id, visitId, since)) as { x: number } | undefined;
  if (recent) return;
  const claim = await db.prepare('UPDATE send_visits SET alerted_at = ? WHERE id = ? AND alerted_at IS NULL').run(nowIso(), visitId);
  if (!claim.changes) return;
  if (!(await claimAlert(link))) return;
  const visit = (await db.prepare('SELECT country, city FROM send_visits WHERE id = ?').get(visitId)) as { country: string | null; city: string | null };
  const place = [visit.city, visit.country].filter(Boolean).join(', ');
  const whoVars = session.email ? { who: session.email } : { who: place || null };
  const titleKey = session.email && !session.email_verified ? 'sendReadingUnverified' : 'sendReading';
  const href = `/app/send/documents/${doc.id}`;
  const recipients = await activeRecipients(link.workspace_id, [doc.owner_id, link.created_by]);
  for (const userId of recipients) {
    await createNotification({
      userId,
      type: 'send_activity',
      title: localized(titleKey, { ...whoVars, title: doc.title }),
      body: localized('sendReadingBody', { link: link.name || null }),
      href,
      sourceType: 'send_visit',
      sourceId: visitId,
      meta: { seen, total },
    }).catch(() => undefined);
    const user = (await db.prepare('SELECT email FROM users WHERE id = ?').get(userId)) as { email: string | null } | undefined;
    if (!user?.email) continue;
    const [subject, body] = await renderForRecipient(userId, [localized(titleKey, { ...whoVars, title: doc.title }), localized('sendReadingBody', { link: link.name || null })]);
    const url = `${appOrigin()}${href}`;
    await sendEmail({
      to: user.email,
      from: appSender(),
      subject: subject ?? '',
      text: `${body ?? ''}\n\n${url}`,
      html: renderBrandedHtml({ eyebrow: 'Send', heading: subject ?? '', paragraphs: [escapeHtml(body ?? ''), `<a href="${escapeHtml(url)}" style="color:#000000;font-weight:500;">${escapeHtml(url)}</a>`] }),
    }).catch(() => undefined);
  }
}

// ---------- Links dentro del documento ----------

/**
 * Un clic en un link de una página. La URL sale de lo guardado, nunca de lo que manda
 * el navegador, y queda atada a la visita en curso de esta persona.
 */
export async function recordLinkClick(link: LinkRow, session: SessionRow, input: { documentId: string; versionId: string; page: number; index: number }, meta: RequestMeta): Promise<boolean> {
  if (isAutomated(meta, false)) return false;
  const docs = await linkDocuments(link, session.email);
  const target = docs.find((d) => d.doc.id === input.documentId);
  if (!target || target.version.id !== input.versionId) throw new SendError('version_changed', 409);
  const db = getDb();
  const row = (await db.prepare('SELECT links FROM send_pages WHERE version_id = ? AND page = ?').get(input.versionId, input.page)) as { links: string | null } | undefined;
  let links: PageLink[] = [];
  try {
    links = JSON.parse(row?.links || '[]') as PageLink[];
  } catch {
    links = [];
  }
  const hit = links[input.index];
  if (!hit) throw new SendError('not_found', 404);
  const visit = (await db
    .prepare("SELECT id FROM send_visits WHERE session_id = ? AND document_id = ? AND COALESCE(email, '') = ? ORDER BY started_at DESC LIMIT 1")
    .get(session.id, input.documentId, session.email ?? '')) as { id: string } | undefined;
  await db
    .prepare('INSERT INTO send_events (id, workspace_id, link_id, document_id, type, email, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(newId('se'), link.workspace_id, link.id, input.documentId, 'link_click', session.email, JSON.stringify({ url: hit.url ?? null, toPage: hit.page ?? null, page: input.page, visitId: visit?.id ?? null, versionId: input.versionId }).slice(0, 2400), nowIso());
  return true;
}

// ---------- Descarga ----------

/** Un pedazo de lo que se baja: las funciones de Vercel cortan la respuesta en 4,5 MB. */
export interface DownloadPiece {
  bytes: Buffer;
  name: string;
  mime: string;
  piece: number;
  pieces: number;
}

/** PDF con el watermark de esta sesión, una sola copia por sesión y versión, guardada cifrada. */
async function stampedRefs(link: LinkRow, session: SessionRow, version: VersionRow): Promise<{ refs: string[]; size: number }> {
  const db = getDb();
  const email = session.email ?? '';
  const cached = (await db.prepare('SELECT refs, size FROM send_download_cache WHERE session_id = ? AND version_id = ? AND email = ?').get(session.id, version.id, email)) as { refs: string; size: number } | undefined;
  if (cached) return { refs: JSON.parse(cached.refs) as string[], size: Number(cached.size) };
  const { stampPdf } = await import('./stamp');
  const bytes = await stampPdf(version, watermarkText(session));
  const refs: string[] = [];
  for (let i = 0; i * PART_BYTES < bytes.length; i++) refs.push(await storeSendFile(Buffer.from(bytes.subarray(i * PART_BYTES, (i + 1) * PART_BYTES)), 'application/pdf'));
  const res = await db
    .prepare('INSERT OR IGNORE INTO send_download_cache (session_id, version_id, email, refs, size, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(session.id, version.id, email, JSON.stringify(refs), bytes.length, new Date(Date.now() + 3600_000).toISOString());
  if (!res.changes) {
    // Otra pestaña la armó primero: se usa la suya.
    await deleteSendFiles(refs).catch(() => undefined);
    return stampedRefs(link, session, version);
  }
  return { refs, size: bytes.length };
}

export async function purgeDownloadCache(): Promise<number> {
  const db = getDb();
  const rows = (await db.prepare('SELECT session_id, version_id, email, refs FROM send_download_cache WHERE expires_at < ? LIMIT 50').all(nowIso())) as Array<{ session_id: string; version_id: string; email: string; refs: string }>;
  for (const r of rows) {
    const res = await db.prepare('DELETE FROM send_download_cache WHERE session_id = ? AND version_id = ? AND email = ?').run(r.session_id, r.version_id, r.email);
    if (res.changes) await deleteSendFiles(storeRefsOf(r.refs)).catch(() => undefined);
  }
  return rows.length;
}

export async function downloadPiece(link: LinkRow, session: SessionRow, documentId: string, piece: number): Promise<DownloadPiece> {
  const docs = await linkDocuments(link, session.email);
  const target = docs.find((d) => d.doc.id === documentId);
  if (!target) throw new SendError('not_found', 404);
  if (!target.downloadable || (link.watermark && target.version.kind === 'video')) throw new SendError('download_blocked', 403);
  const v = target.version;
  if (!Number.isInteger(piece) || piece < 0) throw new SendError('invalid_input', 400);
  const safeTitle = target.doc.title.replace(/[^\p{L}\p{N} ._-]/gu, '_').slice(0, 120) || 'document';
  if (link.watermark) {
    const { refs } = await stampedRefs(link, session, v);
    if (piece >= refs.length) throw new SendError('not_found', 404);
    const bytes = await readSendFile(refs[piece]);
    if (!bytes) throw new SendError('file_unavailable', 404);
    if (piece === 0) await countDownload(link, session, documentId);
    return { bytes, name: `${safeTitle}.pdf`, mime: 'application/pdf', piece, pieces: refs.length };
  }
  const size = Number(v.size);
  const pieces = Math.max(1, Math.ceil(size / PART_BYTES));
  if (piece >= pieces) throw new SendError('not_found', 404);
  const bytes = await readRange(v.id, piece * PART_BYTES, Math.min(size, (piece + 1) * PART_BYTES) - 1);
  if (piece === 0) await countDownload(link, session, documentId);
  return { bytes, name: v.name.replace(/[\r\n"\\]/g, '_'), mime: v.mime || 'application/octet-stream', piece, pieces };
}

async function countDownload(link: LinkRow, session: SessionRow, documentId: string): Promise<void> {
  const db = getDb();
  await logEvent({ ...link, document_id: documentId }, 'download', session.email);
  await db
    .prepare("UPDATE send_visits SET downloads = downloads + 1 WHERE id = (SELECT id FROM send_visits WHERE session_id = ? AND document_id = ? AND COALESCE(email, '') = ? ORDER BY started_at DESC LIMIT 1)")
    .run(session.id, documentId, session.email ?? '');
}

