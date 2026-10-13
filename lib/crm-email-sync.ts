/**
 * CRM — sync automático de Gmail. Por cada (workspace, persona con Gmail
 * conectado) guarda el historyId de Gmail y en cada pasada pide solo los
 * cambios (history API). Si el historyId venció (404) o es la primera vez,
 * hace un sync completo acotado (últimos 30 días). Solo se guardan los
 * mensajes que involucran a contactos del workspace (from/to/cc).
 *
 * Corre desde el cron (app/api/cron/tick) y desde "Sync now". Cada buzón se
 * toma con compare-and-set sobre locked_until: dos ticks concurrentes nunca
 * sincronizan el mismo buzón. Todo el estado vive en la DB (crm_email_sync).
 * Server-only.
 */
import { getDb, type CrmEmailSyncRow } from './db';
import { getIntegration, getValidAccessToken } from './integrations';
import {
  GmailApiError,
  gmailGetMessage,
  gmailListHistory,
  gmailListMessages,
  gmailProfile,
  parseAddressList,
  type ParsedGmailMessage,
} from './gmail';
import { BODY_TEXT_MAX, dbNow, htmlToText, sanitizeEmailHtml } from './crm-email';
import { emitEvent } from './events';

const LOCK_MS = 10 * 60_000;
const FULL_SYNC_QUERY = 'newer_than:30d -in:chats -in:spam -in:trash';
/** Eventos/workflows solo para mensajes recientes (el primer sync no dispara el historial). */
const EVENT_MAX_AGE_MS = 3 * 86_400_000;

export interface MailboxSyncResult {
  status: 'ok' | 'locked' | 'not_connected' | 'token_expired' | 'error';
  mode?: 'incremental' | 'full';
  fetched: number;
  stored: number;
  more?: boolean;
}

/** Registra el buzón de una persona para sincronizar en un workspace. */
export async function registerMailbox(userId: string, personId: string): Promise<void> {
  await getDb()
    .prepare('INSERT OR IGNORE INTO crm_email_sync (user_id, person_id) VALUES (?, ?)')
    .run(userId, personId);
}

export async function unregisterMailboxes(personId: string): Promise<void> {
  await getDb().prepare('DELETE FROM crm_email_sync WHERE person_id = ?').run(personId);
}

export async function getMailboxSync(userId: string, personId: string): Promise<CrmEmailSyncRow | null> {
  return ((await getDb()
    .prepare('SELECT * FROM crm_email_sync WHERE user_id = ? AND person_id = ?')
    .get(userId, personId)) as CrmEmailSyncRow | undefined) ?? null;
}

async function claimMailbox(userId: string, personId: string, now: Date): Promise<boolean> {
  const res = await getDb()
    .prepare(
      `UPDATE crm_email_sync SET locked_until = ?, status = 'syncing'
       WHERE user_id = ? AND person_id = ? AND (locked_until IS NULL OR locked_until < ?)`,
    )
    .run(dbNow(new Date(now.getTime() + LOCK_MS)), userId, personId, dbNow(now));
  return res.changes > 0;
}

async function releaseMailbox(
  userId: string,
  personId: string,
  patch: { status: string; error?: string | null; historyId?: string | null; full?: boolean },
  now: Date,
): Promise<void> {
  const ts = dbNow(now);
  await getDb()
    .prepare(
      `UPDATE crm_email_sync SET locked_until = NULL, status = ?, error = ?, last_sync_at = ?,
         history_id = COALESCE(?, history_id),
         last_full_sync_at = CASE WHEN ? = 1 THEN ? ELSE last_full_sync_at END
       WHERE user_id = ? AND person_id = ?`,
    )
    .run(patch.status, patch.error ?? null, ts, patch.historyId ?? null, patch.full ? 1 : 0, ts, userId, personId);
  await getDb()
    .prepare("UPDATE integrations SET last_sync_at = datetime('now') WHERE user_id = ? AND provider = 'gmail'")
    .run(personId);
}

/** Contactos del workspace por email (minúsculas). Nunca cruza workspaces. */
async function contactsByEmail(userId: string, emails: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!emails.length) return out;
  const rows = (await getDb()
    .prepare(
      `SELECT id, lower(email) AS email FROM crm_contacts
       WHERE user_id = ? AND lower(email) IN (${emails.map(() => '?').join(',')})
       ORDER BY created_at ASC`,
    )
    .all(userId, ...emails)) as Array<{ id: string; email: string }>;
  for (const r of rows) if (!out.has(r.email)) out.set(r.email, r.id);
  return out;
}

/**
 * Guarda un mensaje de Gmail si involucra contactos del workspace.
 * Devuelve true si se insertó (no existía).
 */
export async function storeGmailMessage(
  userId: string,
  personId: string,
  mailboxEmail: string,
  msg: ParsedGmailMessage,
  now = new Date(),
): Promise<boolean> {
  if (msg.labelIds.some((l) => l === 'DRAFT' || l === 'SPAM' || l === 'TRASH' || l === 'CHAT')) return false;
  const from = parseAddressList(msg.from);
  const to = parseAddressList(msg.to);
  const cc = parseAddressList(msg.cc);
  const mailbox = mailboxEmail.toLowerCase();
  const outbound = msg.labelIds.includes('SENT') || (from.length > 0 && from[0] === mailbox);
  const participants = [...new Set([...from, ...to, ...cc])].filter((e) => e !== mailbox);
  const contacts = await contactsByEmail(userId, participants);
  if (!contacts.size) return false;

  // Contacto principal: el remitente (entrante) o el primer destinatario (saliente).
  const ordered = outbound ? [...to, ...cc] : [...from, ...to, ...cc];
  const primary = ordered.map((e) => contacts.get(e)).find(Boolean) ?? [...contacts.values()][0];
  const html = sanitizeEmailHtml(msg.html);
  const text = (msg.text || (html ? htmlToText(html) : '') || msg.snippet).slice(0, BODY_TEXT_MAX);
  const sentAt = dbNow(new Date(msg.internalDate));
  const db = getDb();

  // Un email enviado desde el CRM ya está guardado con su gmail_id: solo se completa.
  const existing = (await db
    .prepare('SELECT id FROM crm_emails WHERE user_id = ? AND gmail_id = ?')
    .get(userId, msg.id)) as { id: string } | undefined;
  if (existing) {
    await db
      .prepare(
        "UPDATE crm_emails SET thread_id = CASE WHEN thread_id = '' THEN ? ELSE thread_id END, message_id = CASE WHEN message_id = '' THEN ? ELSE message_id END WHERE id = ?",
      )
      .run(msg.threadId, msg.messageId, existing.id);
    return false;
  }

  const emailId = crypto.randomUUID();
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO crm_emails
         (id, user_id, contact_id, gmail_id, thread_id, source, direction, from_email, to_emails, cc_emails,
          subject, snippet, body_text, body_html, sent_at, message_id, in_reply_to, person_id)
       VALUES (?, ?, ?, ?, ?, 'gmail', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      emailId,
      userId,
      primary!,
      msg.id,
      msg.threadId,
      outbound ? 'out' : 'in',
      msg.from.slice(0, 500),
      msg.to.slice(0, 2000),
      msg.cc.slice(0, 2000),
      msg.subject.slice(0, 1000),
      msg.snippet.slice(0, 500),
      text,
      html || null,
      sentAt,
      msg.messageId.slice(0, 500),
      msg.inReplyTo.slice(0, 500),
      personId,
    );
  if (!res.changes) return false;
  for (const contactId of new Set(contacts.values())) {
    await db
      .prepare('INSERT OR IGNORE INTO crm_email_contacts (email_id, contact_id, user_id) VALUES (?, ?, ?)')
      .run(emailId, contactId, userId);
  }

  const recent = now.getTime() - new Date(msg.internalDate).getTime() < EVENT_MAX_AGE_MS;
  if (!outbound) {
    // Responder (en cualquier thread) saca al contacto de sus secuencias.
    const senderContacts = from.map((e) => contacts.get(e)).filter((v): v is string => Boolean(v));
    if (senderContacts.length) {
      const { exitEnrollmentsForContacts } = await import('./crm-sequences');
      await exitEnrollmentsForContacts(userId, senderContacts, 'replied', now);
      if (msg.threadId) {
        await db
          .prepare(
            `UPDATE crm_emails SET replied_at = ? WHERE id = (
               SELECT id FROM crm_emails WHERE user_id = ? AND thread_id = ? AND direction = 'out' AND sent_at <= ?
               ORDER BY sent_at DESC LIMIT 1) AND replied_at IS NULL`,
          )
          .run(dbNow(now), userId, msg.threadId, sentAt);
      }
    }
    if (recent) {
      const { runWorkflowsForEvent } = await import('./crm-workflows');
      await runWorkflowsForEvent(userId, {
        type: 'email_received',
        entity: 'email',
        entityId: emailId,
        payload: { contactId: primary, gmailId: msg.id, direction: 'in' },
      }).catch(() => null);
      await emitEvent(userId, 'email.received', {
        email: { id: emailId, subject: msg.subject, from: msg.from, threadId: msg.threadId },
        contactIds: [...new Set(contacts.values())],
      });
    }
  } else if (recent) {
    await emitEvent(userId, 'email.sent', {
      email: { id: emailId, subject: msg.subject, to: msg.to, threadId: msg.threadId, via: 'gmail' },
      contactId: primary,
      sequence: null,
    });
  }
  return true;
}

/**
 * Sincroniza un buzón. `maxMessages` acota la pasada: con history, el
 * historyId guardado avanza solo hasta el último registro procesado, así lo
 * que quedó pendiente entra en la próxima pasada.
 */
export async function syncMailbox(
  userId: string,
  personId: string,
  opts: { maxMessages?: number; now?: Date } = {},
): Promise<MailboxSyncResult> {
  const now = opts.now ?? new Date();
  const max = Math.min(Math.max(opts.maxMessages ?? 50, 1), 500);
  await registerMailbox(userId, personId);
  const integration = await getIntegration(personId, 'gmail');
  if (!integration) return { status: 'not_connected', fetched: 0, stored: 0 };
  if (!(await claimMailbox(userId, personId, now))) return { status: 'locked', fetched: 0, stored: 0 };

  let token: string | null = null;
  try {
    token = await getValidAccessToken(integration);
  } catch {
    token = null;
  }
  if (!token) {
    await releaseMailbox(userId, personId, { status: 'error', error: 'token_expired' }, now);
    return { status: 'token_expired', fetched: 0, stored: 0 };
  }

  const state = await getMailboxSync(userId, personId);
  let fetched = 0;
  let stored = 0;
  const mailboxEmail = integration.email;

  async function handle(id: string): Promise<void> {
    fetched += 1;
    const msg = await gmailGetMessage(token!, id).catch((e: unknown) => {
      if (e instanceof GmailApiError && e.status === 404) return null; // borrado entre medio
      throw e;
    });
    if (msg && (await storeGmailMessage(userId, personId, mailboxEmail, msg, now))) stored += 1;
  }

  try {
    if (state?.history_id) {
      try {
        let pageToken: string | null = null;
        let lastDone: string | null = null;
        let latest = state.history_id;
        let more = false;
        const seen = new Set<string>();
        outer: do {
          const page = await gmailListHistory(token, state.history_id, pageToken);
          latest = page.historyId || latest;
          for (const a of page.added) {
            if (seen.has(a.id)) continue;
            if (fetched >= max) {
              more = true;
              break outer;
            }
            seen.add(a.id);
            await handle(a.id);
            lastDone = a.historyId;
          }
          pageToken = page.nextPageToken;
        } while (pageToken);
        // Completo → historyId actual del buzón; cortado → último registro procesado.
        const nextHistory = more ? (lastDone ?? state.history_id) : latest;
        await releaseMailbox(userId, personId, { status: 'idle', historyId: nextHistory }, now);
        return { status: 'ok', mode: 'incremental', fetched, stored, more };
      } catch (e) {
        if (!(e instanceof GmailApiError && e.status === 404)) throw e;
        // historyId vencido: cae al sync completo.
      }
    }

    const profile = await gmailProfile(token);
    let pageToken: string | null = null;
    do {
      const page = await gmailListMessages(token, FULL_SYNC_QUERY, Math.min(100, max - fetched), pageToken);
      for (const m of page.messages) {
        if (fetched >= max) break;
        await handle(m.id);
      }
      pageToken = fetched < max ? page.nextPageToken : null;
    } while (pageToken);
    await releaseMailbox(userId, personId, { status: 'idle', historyId: profile.historyId || null, full: true }, now);
    return { status: 'ok', mode: 'full', fetched, stored };
  } catch (e) {
    const code = e instanceof GmailApiError ? e.message : 'sync_failed';
    await releaseMailbox(userId, personId, { status: 'error', error: code }, now);
    return { status: 'error', fetched, stored };
  }
}

/**
 * Pasada del cron: los buzones con Gmail conectado que hace más tiempo no se
 * sincronizan, acotado a `limit` buzones y `maxMessages` por buzón.
 */
export async function syncDueMailboxes(opts: { limit?: number; maxMessages?: number; now?: Date } = {}): Promise<{
  mailboxes: number;
  stored: number;
}> {
  const now = opts.now ?? new Date();
  const rows = (await getDb()
    .prepare(
      `SELECT s.user_id, s.person_id FROM crm_email_sync s
       JOIN integrations i ON i.user_id = s.person_id AND i.provider = 'gmail'
       WHERE s.locked_until IS NULL OR s.locked_until < ?
       ORDER BY COALESCE(s.last_sync_at, '') ASC LIMIT ?`,
    )
    .all(dbNow(now), Math.min(Math.max(opts.limit ?? 20, 1), 200))) as Array<{ user_id: string; person_id: string }>;
  let stored = 0;
  let mailboxes = 0;
  for (const r of rows) {
    const res = await syncMailbox(r.user_id, r.person_id, { maxMessages: opts.maxMessages ?? 50, now }).catch(() => null);
    if (res && res.status !== 'locked') mailboxes += 1;
    stored += res?.stored ?? 0;
  }
  return { mailboxes, stored };
}
