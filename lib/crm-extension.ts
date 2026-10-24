/**
 * CRM — backend de la extensión de Chrome para Gmail (extensions/chrome).
 * La extensión se autentica con un token personal de la API (/api/v1) y
 * llama a estas funciones a través de app/api/v1/crm/extension/*:
 *
 * - sidebar: el contacto del remitente (por email) con su empresa, deals y
 *   tareas abiertas, todo filtrado por la visibilidad de quien creó el token.
 * - logEmail: registra en el timeline un email abierto en Gmail (crm_emails,
 *   source 'extension'). El id de mensaje de Gmail web (data-legacy-message-id)
 *   es el mismo que usa la API de Gmail, así que si después lo trae el sync de
 *   Gmail no se duplica (storeGmailMessage busca por gmail_id).
 * - trackEmail: antes de enviar desde Gmail, crea el email saliente con su
 *   token de tracking y devuelve la URL del pixel (mismo tracking de aperturas
 *   que los emails enviados desde el CRM).
 *
 * Todas reciben el workspace (userId del dueño) y la persona del token.
 * Server-only.
 */
import { getDb, type CrmActivityRow, type CrmCompanyRow, type CrmContactRow } from './db';
import { createActivity, createContact } from './crm';
import { BODY_TEXT_MAX, dbNow, newTrackingToken, pixelUrl } from './crm-email';
import { parseAddressList } from './gmail';
import { canSeeOwner, scopeAnd, type OwnerScope } from './crm-visibility';
import { emitEvent } from './events';

export interface ExtensionActor {
  workspaceId: string;
  personId: string;
  scope: OwnerScope | undefined;
}

export interface SidebarContact {
  id: string;
  name: string;
  email: string;
  phone: string;
  jobTitle: string;
  lifecycleStage: string;
  url: string;
}

export interface SidebarResult {
  email: string;
  contact: SidebarContact | null;
  company: { id: string; name: string; domain: string; url: string } | null;
  deals: Array<{ id: string; name: string; amount: number; currency: string; stage: string; closed: boolean; url: string }>;
  tasks: Array<{ id: string; subject: string; dueAt: string | null; url: string }>;
  emailsLogged: number;
}

/** Email limpio en minúsculas o null si no parece un email. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const found = parseAddressList(raw.trim());
  return found.length ? found[0] : null;
}

export function contactName(c: Pick<CrmContactRow, 'first_name' | 'last_name' | 'email'>): string {
  return `${c.first_name} ${c.last_name}`.trim() || c.email;
}

/** Id de mensaje de Gmail web: hex de 16 caracteres (igual al id de la API de Gmail). */
export function isGmailMessageId(id: string): boolean {
  return /^[0-9a-f]{10,24}$/i.test(id);
}

/** gmail_id con el que se guarda un mensaje registrado desde la extensión. */
export function extensionGmailId(messageId: string): string {
  const clean = messageId.trim().slice(0, 200);
  return isGmailMessageId(clean) ? clean.toLowerCase() : `ext:${clean}`;
}

/** Contactos visibles del workspace por email (minúsculas), el más viejo primero. */
async function visibleContactsByEmail(actor: ExtensionActor, emails: string[]): Promise<Map<string, CrmContactRow>> {
  const out = new Map<string, CrmContactRow>();
  if (!emails.length) return out;
  const scope = scopeAnd('c', actor.scope);
  const rows = (await getDb()
    .prepare(
      `SELECT c.* FROM crm_contacts c
       WHERE c.user_id = ? AND lower(c.email) IN (${emails.map(() => '?').join(',')})${scope.sql}
       ORDER BY c.created_at ASC`,
    )
    .all(actor.workspaceId, ...emails, ...scope.args)) as CrmContactRow[];
  for (const r of rows) {
    const key = r.email.toLowerCase();
    if (!out.has(key)) out.set(key, r);
  }
  return out;
}

export async function extensionSidebar(actor: ExtensionActor, email: string): Promise<SidebarResult> {
  const db = getDb();
  const contact = (await visibleContactsByEmail(actor, [email])).get(email) ?? null;
  const empty: SidebarResult = { email, contact: null, company: null, deals: [], tasks: [], emailsLogged: 0 };
  if (!contact) return empty;

  const company = contact.company_id
    ? ((await db
        .prepare('SELECT * FROM crm_companies WHERE id = ? AND user_id = ?')
        .get(contact.company_id, actor.workspaceId)) as CrmCompanyRow | undefined) ?? null
    : null;
  const deals = (await db
    .prepare(
      `SELECT d.id, d.name, d.amount, d.currency, d.closed_at, d.owner_id, d.user_id, s.name AS stage_name
       FROM crm_deals d
       JOIN crm_deal_contacts dc ON dc.deal_id = d.id
       LEFT JOIN crm_stages s ON s.id = d.stage_id
       WHERE dc.contact_id = ? AND d.user_id = ?
       ORDER BY d.closed_at IS NOT NULL, d.created_at DESC LIMIT 20`,
    )
    .all(contact.id, actor.workspaceId)) as Array<{
    id: string;
    name: string;
    amount: number;
    currency: string;
    closed_at: string | null;
    owner_id: string | null;
    user_id: string;
    stage_name: string | null;
  }>;
  const tasks = (await db
    .prepare(
      `SELECT * FROM crm_activities
       WHERE user_id = ? AND contact_id = ? AND type = 'task' AND done = 0
       ORDER BY due_at IS NULL, due_at ASC, created_at DESC LIMIT 20`,
    )
    .all(actor.workspaceId, contact.id)) as CrmActivityRow[];
  const logged = (await db
    .prepare('SELECT COUNT(*) AS n FROM crm_email_contacts WHERE user_id = ? AND contact_id = ?')
    .get(actor.workspaceId, contact.id)) as { n: number } | undefined;

  return {
    email,
    contact: {
      id: contact.id,
      name: contactName(contact),
      email: contact.email,
      phone: contact.phone,
      jobTitle: contact.job_title,
      lifecycleStage: contact.lifecycle_stage,
      url: `/app/crm/contacts/${contact.id}`,
    },
    company:
      company && canSeeOwner(actor.scope, company.owner_id, company.user_id)
        ? { id: company.id, name: company.name, domain: company.domain ?? '', url: `/app/crm/companies/${company.id}` }
        : null,
    deals: deals
      .filter((d) => canSeeOwner(actor.scope, d.owner_id, d.user_id))
      .map((d) => ({
        id: d.id,
        name: d.name,
        amount: Number(d.amount) || 0,
        currency: d.currency,
        stage: d.stage_name ?? '',
        closed: Boolean(d.closed_at),
        url: `/app/crm/deals/${d.id}`,
      })),
    tasks: tasks
      .filter((t) => canSeeOwner(actor.scope, t.owner_id, t.user_id))
      .map((t) => ({ id: t.id, subject: t.subject, dueAt: t.due_at, url: `/app/crm/tasks/${t.id}` })),
    emailsLogged: Number(logged?.n ?? 0),
  };
}

async function personEmail(personId: string): Promise<string> {
  const row = (await getDb().prepare('SELECT email FROM users WHERE id = ?').get(personId)) as { email: string } | undefined;
  return row?.email ?? '';
}

export interface LogEmailInput {
  messageId: string;
  threadId?: string;
  subject?: string;
  body?: string;
  from: string;
  to?: string;
  cc?: string;
  sentAt?: string | null;
}

export type LogEmailResult =
  | { ok: true; emailId: string; contactIds: string[]; duplicate: boolean }
  | { ok: false; error: 'no_contact' };

/** Fecha ISO válida y no futura → formato de la base; si no, ahora. */
function sentAtDb(raw: string | null | undefined, now: Date): string {
  const d = raw ? new Date(raw) : null;
  if (!d || Number.isNaN(d.getTime()) || d.getTime() > now.getTime() + 60_000) return dbNow(now);
  return dbNow(d);
}

/**
 * Registra un email abierto en Gmail en el timeline de los contactos visibles
 * que participan. Si ya estaba (por la extensión o por el sync de Gmail), no
 * lo duplica.
 */
export async function logExtensionEmail(actor: ExtensionActor, input: LogEmailInput, now = new Date()): Promise<LogEmailResult> {
  const db = getDb();
  const gmailId = extensionGmailId(input.messageId);
  const mine = (await personEmail(actor.personId)).toLowerCase();
  const from = parseAddressList(input.from);
  const to = parseAddressList(input.to ?? '');
  const cc = parseAddressList(input.cc ?? '');
  const outbound = Boolean(mine) && from[0] === mine;
  const participants = [...new Set([...from, ...to, ...cc])].filter((e) => e !== mine);
  const contacts = await visibleContactsByEmail(actor, participants);
  if (!contacts.size) return { ok: false, error: 'no_contact' };
  const contactIds = [...new Set([...contacts.values()].map((c) => c.id))];

  const existing = (await db
    .prepare('SELECT id FROM crm_emails WHERE user_id = ? AND gmail_id IN (?, ?)')
    .get(actor.workspaceId, gmailId, `ext:${input.messageId.trim().slice(0, 200)}`)) as { id: string } | undefined;
  if (existing) return { ok: true, emailId: existing.id, contactIds, duplicate: true };

  const ordered = outbound ? [...to, ...cc] : [...from, ...to, ...cc];
  const primary = ordered.map((e) => contacts.get(e)?.id).find(Boolean) ?? contactIds[0];
  const body = (input.body ?? '').slice(0, BODY_TEXT_MAX);
  const subject = (input.subject ?? '').slice(0, 1000);
  const emailId = crypto.randomUUID();
  const sentAt = sentAtDb(input.sentAt, now);
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO crm_emails
         (id, user_id, contact_id, gmail_id, thread_id, source, direction, from_email, to_emails, cc_emails,
          subject, snippet, body_text, body_html, sent_at, person_id)
       VALUES (?, ?, ?, ?, ?, 'extension', ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .run(
      emailId,
      actor.workspaceId,
      primary,
      gmailId,
      (input.threadId ?? '').slice(0, 200) || `zs-ext-${emailId}`,
      outbound ? 'out' : 'in',
      input.from.slice(0, 500),
      (input.to ?? '').slice(0, 2000),
      (input.cc ?? '').slice(0, 2000),
      subject,
      body.replace(/\s+/g, ' ').trim().slice(0, 200),
      body,
      sentAt,
      actor.personId,
    );
  if (!res.changes) {
    const again = (await db
      .prepare('SELECT id FROM crm_emails WHERE user_id = ? AND gmail_id = ?')
      .get(actor.workspaceId, gmailId)) as { id: string } | undefined;
    return { ok: true, emailId: again?.id ?? emailId, contactIds, duplicate: true };
  }
  for (const contactId of contactIds) {
    await db
      .prepare('INSERT OR IGNORE INTO crm_email_contacts (email_id, contact_id, user_id) VALUES (?, ?, ?)')
      .run(emailId, contactId, actor.workspaceId);
  }
  await linkActivity(actor, emailId, {
    subject,
    body,
    outbound,
    contactId: primary,
  });
  await emitEvent(actor.workspaceId, outbound ? 'email.sent' : 'email.received', {
    email: { id: emailId, subject, from: input.from, to: input.to ?? '', threadId: input.threadId ?? '', via: 'extension' },
    contactIds,
  });
  return { ok: true, emailId, contactIds, duplicate: false };
}

/** Actividad "email" para reportes; el timeline la muestra dentro del thread. */
async function linkActivity(
  actor: ExtensionActor,
  emailId: string,
  a: { subject: string; body: string; outbound: boolean; contactId: string },
): Promise<void> {
  const activity = await createActivity(actor.workspaceId, {
    type: 'email',
    subject: a.subject,
    body: a.body.slice(0, 5000),
    direction: a.outbound ? 'outbound' : 'inbound',
    contactId: a.contactId,
    ownerId: actor.personId,
  }).catch(() => null);
  if (activity) await getDb().prepare('UPDATE crm_emails SET activity_id = ? WHERE id = ?').run(activity.id, emailId);
}

export interface TrackEmailInput {
  to: string;
  cc?: string;
  subject?: string;
  body?: string;
  threadId?: string;
}

export type TrackEmailResult =
  | { ok: true; emailId: string; pixelUrl: string; contactIds: string[]; createdContact: boolean }
  | { ok: false; error: 'missing_recipient' };

/**
 * Email que se va a enviar desde Gmail con "Registrar y trackear": se guarda
 * como saliente con token de tracking y se devuelve la URL del pixel. Si
 * ningún destinatario es contacto, se crea el contacto del primer destinatario
 * (como HubSpot al registrar un email).
 */
export async function trackExtensionEmail(actor: ExtensionActor, input: TrackEmailInput, now = new Date()): Promise<TrackEmailResult> {
  const db = getDb();
  const mine = (await personEmail(actor.personId)).toLowerCase();
  const to = parseAddressList(input.to).filter((e) => e !== mine);
  const cc = parseAddressList(input.cc ?? '').filter((e) => e !== mine);
  if (!to.length && !cc.length) return { ok: false, error: 'missing_recipient' };
  const contacts = await visibleContactsByEmail(actor, [...new Set([...to, ...cc])]);
  let createdContact = false;
  if (!contacts.size) {
    const first = to[0] ?? cc[0];
    const created = await createContact(actor.workspaceId, { email: first, ownerId: actor.personId, source: 'email' });
    contacts.set(first, created);
    createdContact = true;
  }
  const contactIds = [...new Set([...contacts.values()].map((c) => c.id))];
  const primary = [...to, ...cc].map((e) => contacts.get(e)?.id).find(Boolean) ?? contactIds[0];
  const token = newTrackingToken();
  const emailId = crypto.randomUUID();
  const body = (input.body ?? '').slice(0, BODY_TEXT_MAX);
  const subject = (input.subject ?? '').slice(0, 1000);
  const ts = dbNow(now);
  await db
    .prepare(
      `INSERT INTO crm_emails
         (id, user_id, contact_id, gmail_id, thread_id, source, direction, from_email, to_emails, cc_emails,
          subject, snippet, body_text, body_html, sent_at, created_at, person_id, tracking_token)
       VALUES (?, ?, ?, ?, ?, 'extension', 'out', ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    )
    .run(
      emailId,
      actor.workspaceId,
      primary,
      `ext:${emailId}`,
      (input.threadId ?? '').slice(0, 200) || `zs-ext-${emailId}`,
      mine,
      input.to.slice(0, 2000),
      (input.cc ?? '').slice(0, 2000),
      subject,
      body.replace(/\s+/g, ' ').trim().slice(0, 200),
      body,
      ts,
      ts,
      actor.personId,
      token,
    );
  for (const contactId of contactIds) {
    await db
      .prepare('INSERT OR IGNORE INTO crm_email_contacts (email_id, contact_id, user_id) VALUES (?, ?, ?)')
      .run(emailId, contactId, actor.workspaceId);
  }
  await linkActivity(actor, emailId, { subject, body, outbound: true, contactId: primary });
  await emitEvent(actor.workspaceId, 'email.sent', {
    email: { id: emailId, subject, to: input.to, threadId: input.threadId ?? '', via: 'extension' },
    contactId: primary,
    sequence: null,
  });
  return { ok: true, emailId, pixelUrl: pixelUrl(token), contactIds, createdContact };
}
