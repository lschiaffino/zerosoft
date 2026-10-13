/**
 * CRM — email de ventas: templates/snippets con variables, tracking de
 * aperturas y clicks (pixel + redirect firmado), envío como el usuario vía
 * Gmail (fallback al envío del sistema) y threads para el timeline.
 * Todas las funciones reciben primero el workspace (userId del owner).
 * Server-only.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import sanitizeHtml from 'sanitize-html';
import { getDb, type CrmEmailRow, type CrmEmailTemplateRow, type UserRow } from './db';
import { createActivity, parseCustom } from './crm';
import { sendEmail } from './email';
import { emitEvent } from './events';
import { createNotification } from './notifications';
import { getIntegration, getValidAccessToken } from './integrations';
import { buildMime, gmailMessageIdHeader, gmailSend, scopeAllowsSend } from './gmail';

// ---------- Utilidades ----------

export function dbNow(d = new Date()): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export function parseDbDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function appBase(): string {
  return (process.env.NEXTAUTH_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

export const BODY_TEXT_MAX = 100_000;
export const BODY_HTML_MAX = 200_000;

// ---------- Templates: variables ----------

export const TEMPLATE_VARIABLES = [
  'contact.first_name',
  'contact.last_name',
  'contact.full_name',
  'contact.email',
  'contact.company',
  'contact.job_title',
  'deal.name',
  'owner.first_name',
  'owner.name',
  'owner.email',
] as const;

export interface TemplateContext {
  contact?: {
    first_name: string;
    last_name: string;
    email: string;
    job_title?: string;
    custom?: string | Record<string, unknown>;
  } | null;
  company?: { name: string } | null;
  deal?: { name: string } | null;
  owner?: { name: string | null; email: string } | null;
}

function contextValue(ctx: TemplateContext, key: string): string | undefined {
  const c = ctx.contact;
  const ownerName = ctx.owner?.name?.trim() || '';
  switch (key) {
    case 'contact.first_name':
      return c?.first_name ?? '';
    case 'contact.last_name':
      return c?.last_name ?? '';
    case 'contact.full_name':
      return `${c?.first_name ?? ''} ${c?.last_name ?? ''}`.trim();
    case 'contact.email':
      return c?.email ?? '';
    case 'contact.company':
      return ctx.company?.name ?? '';
    case 'contact.job_title':
      return c?.job_title ?? '';
    case 'deal.name':
      return ctx.deal?.name ?? '';
    case 'owner.first_name':
      return ownerName.split(/\s+/)[0] ?? '';
    case 'owner.name':
      return ownerName;
    case 'owner.email':
      return ctx.owner?.email ?? '';
    default: {
      const m = /^contact\.custom\.([\w-]+)$/.exec(key);
      if (!m) return undefined; // variable desconocida
      const custom = typeof c?.custom === 'string' ? parseCustom(c.custom) : (c?.custom ?? {});
      const v = custom[m[1]];
      return v === undefined || v === null ? '' : String(v);
    }
  }
}

/**
 * Reemplaza {{var}} y {{var | fallback}}. `missing` lista las variables que
 * quedaron vacías sin fallback o que no existen (para avisar antes de enviar).
 */
export function renderEmailTemplate(template: string, ctx: TemplateContext): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const text = template.replace(/\{\{\s*([\w.-]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g, (_m, rawKey: string, fallback?: string) => {
    const key = rawKey.trim();
    const value = contextValue(ctx, key);
    if (value === undefined) {
      missing.add(key);
      return fallback ?? '';
    }
    if (!value.trim()) {
      if (fallback !== undefined) return fallback;
      missing.add(key);
      return '';
    }
    return value;
  });
  return { text, missing: [...missing] };
}

/** Contexto de variables: contacto, su company, deal (dado o el primero asociado) y owner. */
export async function loadTemplateContext(
  userId: string,
  opts: { contactId?: string | null; dealId?: string | null; senderId?: string | null },
): Promise<TemplateContext> {
  const db = getDb();
  const ctx: TemplateContext = {};
  let ownerId: string | null = opts.senderId ?? null;
  if (opts.contactId) {
    const contact = (await db
      .prepare('SELECT first_name, last_name, email, job_title, custom, company_id, owner_id FROM crm_contacts WHERE id = ? AND user_id = ?')
      .get(opts.contactId, userId)) as
      | { first_name: string; last_name: string; email: string; job_title: string; custom: string; company_id: string | null; owner_id: string | null }
      | undefined;
    if (contact) {
      ctx.contact = contact;
      if (contact.owner_id) ownerId = contact.owner_id;
      if (contact.company_id) {
        ctx.company = ((await db
          .prepare('SELECT name FROM crm_companies WHERE id = ? AND user_id = ?')
          .get(contact.company_id, userId)) as { name: string } | undefined) ?? null;
      }
    }
  }
  if (opts.dealId) {
    ctx.deal = ((await db.prepare('SELECT name FROM crm_deals WHERE id = ? AND user_id = ?').get(opts.dealId, userId)) as
      | { name: string }
      | undefined) ?? null;
  } else if (opts.contactId) {
    ctx.deal = ((await db
      .prepare(
        `SELECT d.name FROM crm_deals d JOIN crm_deal_contacts dc ON dc.deal_id = d.id
         WHERE dc.contact_id = ? AND d.user_id = ? AND d.closed_at IS NULL
         ORDER BY d.created_at DESC LIMIT 1`,
      )
      .get(opts.contactId, userId)) as { name: string } | undefined) ?? null;
  }
  const owner = (await db.prepare('SELECT name, email FROM users WHERE id = ?').get(ownerId ?? userId)) as
    | Pick<UserRow, 'name' | 'email'>
    | undefined;
  ctx.owner = owner ? { name: owner.name ?? null, email: owner.email } : null;
  return ctx;
}

// ---------- Templates: CRUD ----------

export type TemplateKind = 'template' | 'snippet';

export interface TemplateInput {
  kind?: TemplateKind;
  name: string;
  subject?: string;
  body?: string;
}

export async function listEmailTemplates(userId: string, kind?: TemplateKind): Promise<CrmEmailTemplateRow[]> {
  const db = getDb();
  if (kind) {
    return (await db
      .prepare('SELECT * FROM crm_email_templates WHERE user_id = ? AND kind = ? ORDER BY name COLLATE NOCASE ASC')
      .all(userId, kind)) as CrmEmailTemplateRow[];
  }
  return (await db
    .prepare('SELECT * FROM crm_email_templates WHERE user_id = ? ORDER BY kind ASC, name COLLATE NOCASE ASC')
    .all(userId)) as CrmEmailTemplateRow[];
}

export async function getEmailTemplate(userId: string, id: string): Promise<CrmEmailTemplateRow | null> {
  return ((await getDb()
    .prepare('SELECT * FROM crm_email_templates WHERE id = ? AND user_id = ?')
    .get(id, userId)) as CrmEmailTemplateRow | undefined) ?? null;
}

export async function createEmailTemplate(
  userId: string,
  actorId: string,
  input: TemplateInput,
): Promise<CrmEmailTemplateRow> {
  const id = crypto.randomUUID();
  const ts = dbNow();
  const kind = input.kind ?? 'template';
  await getDb()
    .prepare(
      `INSERT INTO crm_email_templates (id, user_id, created_by, kind, name, subject, body, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, userId, actorId, kind, input.name, kind === 'snippet' ? '' : (input.subject ?? ''), input.body ?? '', ts, ts);
  return (await getEmailTemplate(userId, id))!;
}

export async function updateEmailTemplate(
  userId: string,
  id: string,
  input: Partial<TemplateInput>,
): Promise<CrmEmailTemplateRow | null> {
  const existing = await getEmailTemplate(userId, id);
  if (!existing) return null;
  await getDb()
    .prepare('UPDATE crm_email_templates SET name = ?, subject = ?, body = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(
      input.name ?? existing.name,
      existing.kind === 'snippet' ? '' : (input.subject ?? existing.subject),
      input.body ?? existing.body,
      dbNow(),
      id,
      userId,
    );
  return getEmailTemplate(userId, id);
}

export async function deleteEmailTemplate(userId: string, id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM crm_email_templates WHERE id = ? AND user_id = ?').run(id, userId);
  if (res.changes) {
    // Los pasos de secuencia que lo usaban quedan con su copia (subject/body).
    await getDb()
      .prepare(
        'UPDATE crm_sequence_steps SET template_id = NULL WHERE template_id = ? AND sequence_id IN (SELECT id FROM crm_sequences WHERE user_id = ?)',
      )
      .run(id, userId);
  }
  return res.changes > 0;
}

/** Admins gestionan todo; un miembro solo edita/borra lo que creó. */
export function canManageOwned(actor: { isAdmin: boolean; personId: string }, createdBy: string | null): boolean {
  return actor.isAdmin || (createdBy !== null && createdBy === actor.personId);
}

// ---------- Settings del workspace ----------

export async function getEmailSettings(userId: string): Promise<{ trackingEnabled: boolean }> {
  const row = (await getDb()
    .prepare('SELECT tracking_enabled FROM crm_email_settings WHERE user_id = ?')
    .get(userId)) as { tracking_enabled: number } | undefined;
  return { trackingEnabled: row ? row.tracking_enabled === 1 : true };
}

export async function setEmailSettings(userId: string, input: { trackingEnabled: boolean }): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO crm_email_settings (user_id, tracking_enabled, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT (user_id) DO UPDATE SET tracking_enabled = excluded.tracking_enabled, updated_at = excluded.updated_at`,
    )
    .run(userId, input.trackingEnabled ? 1 : 0);
}

// ---------- Tracking: tokens y firma ----------

function trackingKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? 'zerosoft-dev-secret';
  return createHmac('sha256', secret).update('crm-email-tracking-v1').digest();
}

export function signTracking(token: string, value: string): string {
  return createHmac('sha256', trackingKey()).update(`${token}\n${value}`).digest('base64url').slice(0, 32);
}

export function verifyTracking(token: string, value: string, sig: string | null | undefined): boolean {
  if (!sig) return false;
  const expected = Buffer.from(signTracking(token, value));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function newTrackingToken(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

export function isTrackingToken(v: string): boolean {
  return /^[a-f0-9]{32}$/.test(v);
}

export function pixelUrl(token: string, base = appBase()): string {
  return `${base}/api/crm/t/o/${token}.gif`;
}

export function clickUrl(token: string, url: string, base = appBase()): string {
  const params = new URLSearchParams({ u: url, s: signTracking(token, url) });
  return `${base}/api/crm/t/c/${token}?${params.toString()}`;
}

export function unsubscribeUrl(token: string, base = appBase()): string {
  return `${base}/api/crm/t/u/${token}?s=${signTracking(token, 'unsubscribe')}`;
}

/**
 * Destino de un click: solo si la firma coincide y es http(s). Sin firma
 * válida no hay redirect (evita un open redirect con nuestro dominio).
 */
export function resolveClickTarget(token: string, url: string | null, sig: string | null): string | null {
  if (!url || !isTrackingToken(token) || !verifyTracking(token, url, sig)) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

// ---------- HTML del email ----------

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const URL_RE = /https?:\/\/[^\s<>"']+/g;

/**
 * Texto plano → HTML simple. Con tracking: links reescritos al redirect
 * firmado + pixel 1×1 al final. `unsubscribe` agrega el link de baja.
 */
export function textToEmailHtml(
  text: string,
  opts: { token?: string | null; tracking?: boolean; unsubscribeLabel?: string | null; base?: string } = {},
): string {
  const base = opts.base ?? appBase();
  const linkify = (line: string): string => {
    let out = '';
    let last = 0;
    for (const m of line.matchAll(URL_RE)) {
      let url = m[0];
      const trail = /[.,;:!?)\]]+$/.exec(url)?.[0] ?? '';
      if (trail) url = url.slice(0, -trail.length);
      out += escapeHtml(line.slice(last, m.index));
      const href = opts.tracking && opts.token ? clickUrl(opts.token, url, base) : url;
      out += `<a href="${escapeHtml(href)}">${escapeHtml(url)}</a>`;
      last = (m.index ?? 0) + url.length;
    }
    return out + escapeHtml(line.slice(last));
  };
  const paragraphs = text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${p.split('\n').map(linkify).join('<br>')}</p>`)
    .join('');
  let html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#111">${paragraphs}`;
  if (opts.unsubscribeLabel && opts.token) {
    html += `<p style="margin:16px 0 0;font-size:12px;color:#888"><a href="${escapeHtml(unsubscribeUrl(opts.token, base))}" style="color:#888">${escapeHtml(opts.unsubscribeLabel)}</a></p>`;
  }
  if (opts.tracking && opts.token) {
    html += `<img src="${escapeHtml(pixelUrl(opts.token, base))}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">`;
  }
  return `${html}</div>`;
}

const DISPLAY_HTML: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'div', 'span', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'blockquote', 'a', 'h1', 'h2', 'h3', 'pre', 'code', 'table', 'tr', 'td', 'th', 'tbody', 'thead'],
  allowedAttributes: { a: ['href'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  disallowedTagsMode: 'discard',
  transformTags: { a: (tagName, attribs) => ({ tagName, attribs: { href: attribs.href ?? '', target: '_blank', rel: 'noopener noreferrer nofollow' } }) },
};

/** HTML entrante saneado (sin imágenes remotas: serían pixels de terceros). */
export function sanitizeEmailHtml(html: string): string {
  if (!html) return '';
  return sanitizeHtml(html.slice(0, BODY_HTML_MAX * 2), DISPLAY_HTML).slice(0, BODY_HTML_MAX);
}

export function htmlToText(html: string): string {
  return sanitizeHtml(html.replace(/<(br|\/p|\/div|\/li|\/tr)[^>]*>/gi, '\n'), { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------- Tracking: aperturas y clicks ----------

/** Scanners, crawlers y clientes HTTP: nunca cuentan. */
const BOT_UA_RE =
  /bot\b|crawler|spider|slurp|preview|scanner|curl\/|wget\/|python-|go-http-client|java\/|okhttp|headless|phantom|barracuda|proofpoint|mimecast|symantec|trendmicro|forcepoint|microsoft office protection|safelinks|linkchecker|facebookexternalhit|slackbot|twitterbot|discordbot|whatsapp|skypeuripreview/i;
/** Proxies de imágenes de webmail: abren de verdad, pero también precargan. */
const PROXY_UA_RE = /googleimageproxy|ggpht\.com|yahoomailproxy/i;

export const TRACK_DEDUPE_MS = 60_000;
const PROXY_PREFETCH_MS = 2 * 60_000;
const SCANNER_WINDOW_MS = 5_000;

export type TrackDecision = 'count' | 'bot' | 'prefetch' | 'duplicate';

/**
 * Heurística (pura, testeable): bots → nunca; hits en los primeros segundos
 * tras el envío → scanner; primer hit de un proxy de webmail (GoogleImageProxy)
 * en los primeros 2 minutos → precarga (o el remitente viendo "Enviados");
 * mismo evento dentro de 1 minuto → duplicado.
 */
export function classifyTrackingHit(input: {
  kind: 'open' | 'click';
  userAgent: string;
  sentAt: Date | null;
  now: Date;
  lastSameAt: Date | null;
  priorCounted: number;
}): TrackDecision {
  const ua = input.userAgent || '';
  if (!ua.trim() || BOT_UA_RE.test(ua)) return 'bot';
  const sinceSend = input.sentAt ? input.now.getTime() - input.sentAt.getTime() : Infinity;
  if (sinceSend < SCANNER_WINDOW_MS) return 'prefetch';
  if (input.kind === 'open' && PROXY_UA_RE.test(ua) && input.priorCounted === 0 && sinceSend < PROXY_PREFETCH_MS) {
    return 'prefetch';
  }
  if (input.lastSameAt && input.now.getTime() - input.lastSameAt.getTime() < TRACK_DEDUPE_MS) return 'duplicate';
  return 'count';
}

async function emailByToken(token: string): Promise<CrmEmailRow | null> {
  if (!isTrackingToken(token)) return null;
  return ((await getDb().prepare('SELECT * FROM crm_emails WHERE tracking_token = ?').get(token)) as CrmEmailRow | undefined) ?? null;
}

async function notifyOwner(email: CrmEmailRow, title: string, body: string): Promise<void> {
  const contact = (await getDb()
    .prepare('SELECT owner_id, first_name, last_name, email FROM crm_contacts WHERE id = ? AND user_id = ?')
    .get(email.contact_id, email.user_id)) as { owner_id: string | null } | undefined;
  const recipient = contact?.owner_id ?? email.person_id ?? email.user_id;
  await createNotification({
    userId: recipient,
    type: 'email_activity',
    title,
    body,
    href: `/app/crm/contacts/${email.contact_id}`,
    sourceType: 'crm_email',
    sourceId: email.id,
  }).catch(() => null);
}

async function fireTrackingEvents(email: CrmEmailRow, kind: 'open' | 'click', url: string): Promise<void> {
  const data = {
    email: { id: email.id, subject: email.subject, to: email.to_emails, threadId: email.thread_id },
    contactId: email.contact_id,
    openCount: email.open_count + (kind === 'open' ? 1 : 0),
    clickCount: email.click_count + (kind === 'click' ? 1 : 0),
    ...(kind === 'click' ? { url } : {}),
  };
  await emitEvent(email.user_id, kind === 'open' ? 'email.opened' : 'email.clicked', data);
  const { runWorkflowsForEvent } = await import('./crm-workflows');
  await runWorkflowsForEvent(email.user_id, {
    type: kind === 'open' ? 'email_opened' : 'email_clicked',
    entity: 'email',
    entityId: email.id,
    payload: kind === 'click' ? { url } : {},
  }).catch(() => null);
}

export async function recordTrackingHit(
  token: string,
  kind: 'open' | 'click',
  opts: { userAgent: string; url?: string; now?: Date },
): Promise<TrackDecision | 'unknown'> {
  const email = await emailByToken(token);
  if (!email) return 'unknown';
  const now = opts.now ?? new Date();
  const url = kind === 'click' ? (opts.url ?? '') : '';
  const db = getDb();
  const last = (await db
    .prepare('SELECT created_at FROM crm_email_events WHERE email_id = ? AND kind = ? AND url = ? ORDER BY created_at DESC LIMIT 1')
    .get(email.id, kind, url)) as { created_at: string } | undefined;
  const decision = classifyTrackingHit({
    kind,
    userAgent: opts.userAgent,
    sentAt: parseDbDate(email.sent_at),
    now,
    lastSameAt: parseDbDate(last?.created_at),
    priorCounted: kind === 'open' ? email.open_count : email.click_count,
  });
  if (decision !== 'count') return decision;

  const ts = dbNow(now);
  await db
    .prepare('INSERT INTO crm_email_events (id, user_id, email_id, kind, url, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), email.user_id, email.id, kind, url, opts.userAgent.slice(0, 300), ts);
  if (kind === 'open') {
    await db
      .prepare(
        'UPDATE crm_emails SET open_count = open_count + 1, first_opened_at = COALESCE(first_opened_at, ?), last_opened_at = ? WHERE id = ?',
      )
      .run(ts, ts, email.id);
  } else {
    // Un click implica que se abrió (el pixel pudo estar bloqueado).
    await db
      .prepare(
        `UPDATE crm_emails SET click_count = click_count + 1,
           open_count = CASE WHEN open_count = 0 THEN 1 ELSE open_count END,
           first_opened_at = COALESCE(first_opened_at, ?), last_opened_at = COALESCE(last_opened_at, ?)
         WHERE id = ?`,
      )
      .run(ts, ts, email.id);
  }

  const firstOfKind = kind === 'open' ? email.open_count === 0 : !last;
  if (firstOfKind) {
    const subject = email.subject || '(no subject)';
    await notifyOwner(
      email,
      kind === 'open' ? `${email.to_emails} opened "${subject}"` : `${email.to_emails} clicked a link in "${subject}"`,
      kind === 'click' ? url : '',
    );
  }
  await fireTrackingEvents(email, kind, url).catch(() => null);
  return 'count';
}

/** Baja de la secuencia (link al pie): registra el email y saca de las secuencias. */
export async function recordUnsubscribe(token: string, sig: string | null): Promise<boolean> {
  if (!isTrackingToken(token) || !verifyTracking(token, 'unsubscribe', sig)) return false;
  const email = await emailByToken(token);
  if (!email) return false;
  const contact = (await getDb()
    .prepare('SELECT email FROM crm_contacts WHERE id = ? AND user_id = ?')
    .get(email.contact_id, email.user_id)) as { email: string } | undefined;
  const address = (contact?.email || email.to_emails).trim().toLowerCase();
  if (address) {
    await getDb()
      .prepare('INSERT OR IGNORE INTO crm_email_unsubscribes (user_id, email) VALUES (?, ?)')
      .run(email.user_id, address);
  }
  const { exitEnrollmentsForContacts } = await import('./crm-sequences');
  await exitEnrollmentsForContacts(email.user_id, [email.contact_id], 'unsubscribed');
  return true;
}

export async function isUnsubscribed(userId: string, address: string): Promise<boolean> {
  return Boolean(
    await getDb()
      .prepare('SELECT 1 FROM crm_email_unsubscribes WHERE user_id = ? AND email = ?')
      .get(userId, address.trim().toLowerCase()),
  );
}

// ---------- Envío ----------

export interface SendCrmEmailInput {
  /** Persona que envía (su Gmail, si está conectado con permiso de envío). */
  senderId: string;
  /** Email del remitente para el fallback del sistema / registro. */
  senderEmail: string;
  contactId: string;
  to: string;
  subject: string;
  body: string;
  /** Override por email; además manda el setting del workspace. */
  tracking?: boolean;
  /** Responder en un thread existente (Gmail threadId + Message-ID original). */
  threadId?: string | null;
  inReplyTo?: string | null;
  /** Secuencias: exige Gmail y agrega link de baja. */
  requireGmail?: boolean;
  unsubscribeLabel?: string | null;
  enrollmentId?: string | null;
  stepId?: string | null;
  /** Deal para el timeline (la actividad se asocia también al deal). */
  dealId?: string | null;
  companyId?: string | null;
}

export type SendCrmEmailResult =
  | { ok: true; email: CrmEmailRow; via: 'gmail' | 'system' }
  | { ok: false; error: string };

/** Gmail con permiso de envío de una persona (o null). */
export async function gmailSender(personId: string): Promise<{ token: string; email: string } | null> {
  const integration = await getIntegration(personId, 'gmail');
  if (!integration || !scopeAllowsSend(integration.scope)) return null;
  const token = await getValidAccessToken(integration);
  if (!token) return null;
  return { token, email: integration.email };
}

export async function sendCrmEmail(userId: string, input: SendCrmEmailInput): Promise<SendCrmEmailResult> {
  const to = input.to.trim();
  if (!to) return { ok: false, error: 'missing_recipient' };
  const settings = await getEmailSettings(userId);
  const tracking = settings.trackingEnabled && input.tracking !== false;
  const emailId = crypto.randomUUID();
  const token = tracking || input.unsubscribeLabel ? newTrackingToken() : null;
  const html = textToEmailHtml(input.body, { token, tracking, unsubscribeLabel: input.unsubscribeLabel ?? null });
  const sentAt = dbNow();

  let via: 'gmail' | 'system';
  let gmailId = emailId;
  let threadId = input.threadId || '';
  let messageId = '';
  let fromEmail = input.senderEmail;
  let source: 'gmail' | 'zerosoft' = 'zerosoft';

  const gmail = await gmailSender(input.senderId);
  if (gmail) {
    const mime = buildMime({
      from: gmail.email,
      to,
      subject: input.subject,
      text: input.body,
      html,
      inReplyTo: input.inReplyTo || undefined,
      references: input.inReplyTo || undefined,
      // Baja en un click desde el cliente de correo (RFC 8058): POST al mismo link.
      headers:
        input.unsubscribeLabel && token
          ? { 'List-Unsubscribe': `<${unsubscribeUrl(token)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
          : undefined,
    });
    try {
      const gmailThread = input.threadId && !input.threadId.startsWith('zs-') ? input.threadId : null;
      const sent = await gmailSend(gmail.token, mime, gmailThread);
      gmailId = sent.id || emailId;
      threadId = sent.threadId || threadId;
      messageId = sent.id ? await gmailMessageIdHeader(gmail.token, sent.id) : '';
    } catch {
      return { ok: false, error: 'send_failed' };
    }
    via = 'gmail';
    source = 'gmail';
    fromEmail = gmail.email;
  } else {
    if (input.requireGmail) return { ok: false, error: 'gmail_not_connected' };
    const sent = await sendEmail({ to, subject: input.subject, text: input.body, html });
    if (!sent.ok) return { ok: false, error: sent.error ?? 'send_failed' };
    via = 'system';
    threadId = threadId || `zs-${emailId}`;
  }

  const db = getDb();
  await db
    .prepare(
      `INSERT INTO crm_emails
         (id, user_id, contact_id, gmail_id, thread_id, source, direction, from_email, to_emails, subject, snippet,
          body_text, body_html, sent_at, created_at, message_id, in_reply_to, person_id, tracking_token,
          enrollment_id, step_id)
       VALUES (?, ?, ?, ?, ?, ?, 'out', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      emailId,
      userId,
      input.contactId,
      gmailId,
      threadId,
      source,
      fromEmail,
      to,
      input.subject,
      input.body.slice(0, 200),
      input.body.slice(0, BODY_TEXT_MAX),
      sanitizeEmailHtml(html),
      sentAt,
      sentAt,
      messageId,
      input.inReplyTo ?? '',
      input.senderId,
      token,
      input.enrollmentId ?? null,
      input.stepId ?? null,
    );
  await db
    .prepare('INSERT OR IGNORE INTO crm_email_contacts (email_id, contact_id, user_id) VALUES (?, ?, ?)')
    .run(emailId, input.contactId, userId);

  // Actividad "email" (reportes de actividad); el timeline la muestra dentro del thread.
  const activity = await createActivity(userId, {
    type: 'email',
    subject: input.subject,
    body: input.body.slice(0, 5000),
    direction: 'outbound',
    contactId: input.contactId,
    dealId: input.dealId ?? null,
    companyId: input.companyId ?? null,
    ownerId: input.senderId,
  }).catch(() => null);
  if (activity) await db.prepare('UPDATE crm_emails SET activity_id = ? WHERE id = ?').run(activity.id, emailId);

  const email = (await db.prepare('SELECT * FROM crm_emails WHERE id = ?').get(emailId)) as CrmEmailRow;
  await emitEvent(userId, 'email.sent', {
    email: { id: email.id, subject: email.subject, to: email.to_emails, threadId: email.thread_id, via },
    contactId: input.contactId,
    sequence: input.enrollmentId ? { enrollmentId: input.enrollmentId, stepId: input.stepId ?? null } : null,
  });
  return { ok: true, email, via };
}

/** Datos para responder en un thread del workspace (Message-ID del último mensaje). */
export async function threadReplyInfo(
  userId: string,
  threadId: string,
): Promise<{ threadId: string; inReplyTo: string; subject: string } | null> {
  const last = (await getDb()
    .prepare(
      `SELECT thread_id, message_id, subject FROM crm_emails WHERE user_id = ? AND thread_id = ?
       ORDER BY sent_at DESC LIMIT 1`,
    )
    .get(userId, threadId)) as { thread_id: string; message_id: string; subject: string } | undefined;
  if (!last) return null;
  return { threadId: last.thread_id, inReplyTo: last.message_id, subject: last.subject };
}

// ---------- Threads para el timeline ----------

export interface EmailMessageView {
  id: string;
  direction: 'in' | 'out';
  from: string;
  to: string;
  cc: string;
  subject: string;
  snippet: string;
  body: string;
  sentAt: string;
  source: string;
  tracked: boolean;
  openCount: number;
  clickCount: number;
  lastOpenedAt: string | null;
  clicks: Array<{ url: string; count: number }>;
}

export interface EmailThreadView {
  threadId: string;
  subject: string;
  lastAt: string;
  messages: EmailMessageView[];
}

/**
 * Emails de un contacto / company / deal agrupados por thread (más reciente
 * primero). Para deals: los de sus contactos asociados.
 */
export async function listEmailThreads(
  userId: string,
  f: { contactId?: string; companyId?: string; dealId?: string; limit?: number },
): Promise<{ threads: EmailThreadView[]; activityIds: string[] }> {
  const db = getDb();
  const limit = Math.min(Math.max(f.limit ?? 100, 1), 300);
  let where: string;
  let arg: string;
  if (f.contactId) {
    where = 'ec.contact_id = ?';
    arg = f.contactId;
  } else if (f.companyId) {
    where = 'ec.contact_id IN (SELECT id FROM crm_contacts WHERE user_id = ec.user_id AND company_id = ?)';
    arg = f.companyId;
  } else if (f.dealId) {
    where = 'ec.contact_id IN (SELECT contact_id FROM crm_deal_contacts WHERE deal_id = ?)';
    arg = f.dealId;
  } else {
    return { threads: [], activityIds: [] };
  }
  const rows = (await db
    .prepare(
      `SELECT DISTINCT e.* FROM crm_emails e
       JOIN crm_email_contacts ec ON ec.email_id = e.id
       WHERE ec.user_id = ? AND ${where}
       ORDER BY e.sent_at DESC LIMIT ?`,
    )
    .all(userId, arg, limit)) as CrmEmailRow[];
  if (!rows.length) return { threads: [], activityIds: [] };

  const clickRows = (await db
    .prepare(
      `SELECT email_id, url, COUNT(*) AS n FROM crm_email_events
       WHERE kind = 'click' AND email_id IN (${rows.map(() => '?').join(',')})
       GROUP BY email_id, url ORDER BY n DESC`,
    )
    .all(...rows.map((r) => r.id))) as Array<{ email_id: string; url: string; n: number }>;
  const clicksBy = new Map<string, Array<{ url: string; count: number }>>();
  for (const c of clickRows) {
    const list = clicksBy.get(c.email_id) ?? [];
    list.push({ url: c.url, count: Number(c.n) });
    clicksBy.set(c.email_id, list);
  }

  const byThread = new Map<string, EmailThreadView>();
  for (const e of rows) {
    const key = e.thread_id || e.id;
    const msg: EmailMessageView = {
      id: e.id,
      direction: e.direction,
      from: e.from_email,
      to: e.to_emails,
      cc: e.cc_emails ?? '',
      subject: e.subject,
      snippet: e.snippet,
      body: (e.body_text || (e.body_html ? htmlToText(e.body_html) : '') || e.snippet).slice(0, 20_000),
      sentAt: e.sent_at,
      source: e.source,
      tracked: Boolean(e.tracking_token),
      openCount: Number(e.open_count ?? 0),
      clickCount: Number(e.click_count ?? 0),
      lastOpenedAt: e.last_opened_at ?? null,
      clicks: clicksBy.get(e.id) ?? [],
    };
    const t = byThread.get(key);
    if (t) {
      t.messages.push(msg);
    } else {
      byThread.set(key, { threadId: key, subject: e.subject.replace(/^(re|fwd?):\s*/i, '') || '', lastAt: e.sent_at, messages: [msg] });
    }
  }
  const threads = [...byThread.values()].map((t) => ({
    ...t,
    messages: t.messages.sort((a, b) => a.sentAt.localeCompare(b.sentAt)),
  }));
  return { threads, activityIds: rows.map((r) => r.activity_id).filter((v): v is string => Boolean(v)) };
}

/** Item de timeline con un thread de emails. */
export interface ThreadTimelineItem {
  id: string;
  type: 'email';
  subject: string;
  body: string;
  due_at: null;
  done: 0;
  pinned: 0;
  direction: string;
  outcome: string;
  duration_min: null;
  created_at: string;
  external: true;
  thread: EmailThreadView;
}

/**
 * Timeline: actividades (sin las "email" que ya están dentro de un thread)
 * + un item por thread. Pinned primero, después por fecha desc.
 */
export function mergeTimelineWithThreads<T extends { id: string; pinned: 0 | 1; due_at: string | null; created_at: string }>(
  activities: T[],
  threads: { threads: EmailThreadView[]; activityIds: string[] },
): Array<T | ThreadTimelineItem> {
  const hidden = new Set(threads.activityIds);
  const items: ThreadTimelineItem[] = threads.threads.map((t) => {
    const last = t.messages[t.messages.length - 1];
    return {
      id: `thread-${t.threadId}`,
      type: 'email',
      subject: t.subject || last?.subject || '',
      body: last?.snippet ?? '',
      due_at: null,
      done: 0,
      pinned: 0,
      direction: last?.direction === 'out' ? 'outbound' : 'inbound',
      outcome: '',
      duration_min: null,
      created_at: t.lastAt,
      external: true,
      thread: t,
    };
  });
  const key = (iso: string): string => (iso.includes('T') ? iso : iso.replace(' ', 'T'));
  return [...activities.filter((a) => !hidden.has(a.id)), ...items].sort((a, b) => {
    if (a.pinned !== b.pinned) return b.pinned - a.pinned;
    return key(b.due_at ?? b.created_at).localeCompare(key(a.due_at ?? a.created_at));
  });
}
