/**
 * CRM — sync de Outlook / Microsoft 365 (el equivalente al de Gmail en
 * lib/crm-email-sync.ts). Por cada (workspace, persona con Outlook conectado)
 * guarda los deltaLink de Graph de Bandeja de entrada, Enviados y calendario;
 * cada pasada pide solo los cambios. La primera vez trae los últimos 30 días.
 *
 * - Emails: solo los que involucran contactos del workspace; se guardan en
 *   crm_emails con source 'outlook' (mismo guardado que Gmail: timeline por
 *   thread, respuestas que sacan de secuencias, workflows y eventos).
 * - Calendario: reuniones con algún contacto como asistente → actividad
 *   'meeting' en el timeline (se actualiza si cambia y se borra si se cancela).
 *
 * Cada buzón se reclama con compare-and-set sobre locked_until: dos corridas
 * del cron nunca sincronizan el mismo buzón. Server-only.
 */
import { getDb, type CrmOutlookSyncRow, type IntegrationRow } from './db';
import { getIntegration } from './integrations';
import { seal } from './secret-box';
import {
  GraphApiError,
  OUTLOOK_PROVIDER,
  graphCalendarDelta,
  graphDate,
  graphMessagesDelta,
  graphToParsed,
  outlookScopeAllowsSend,
  refreshOutlookToken,
  type GraphEvent,
  type MailFolder,
} from './microsoft';
import { contactsByEmail, storeGmailMessage } from './crm-email-sync';
import { dbNow, parseDbDate } from './crm-email';

const LOCK_MS = 10 * 60_000;
/** La ventana del delta de calendarView es fija: se rehace cada semana. */
const CALENDAR_WINDOW_MS = 7 * 86_400_000;
const MEETING_BODY_MAX = 4000;

export interface OutlookSyncResult {
  status: 'ok' | 'locked' | 'not_connected' | 'token_expired' | 'error';
  fetched: number;
  stored: number;
  meetings: number;
  more?: boolean;
}

/** Access token válido de Outlook: refresca si venció y guarda el refresh token rotado. */
export async function getValidOutlookToken(row: IntegrationRow): Promise<string | null> {
  if (row.access_token && row.expires_at > Date.now() + 60_000) return row.access_token;
  if (!row.refresh_token) return null;
  const tok = await refreshOutlookToken(row.refresh_token);
  if (!tok.access_token) return null;
  const expiresAt = Date.now() + (tok.expires_in ?? 3600) * 1000;
  await getDb()
    .prepare(
      `UPDATE integrations SET access_token = ?, expires_at = ?,
         refresh_token = CASE WHEN ? = '' THEN refresh_token ELSE ? END,
         updated_at = datetime('now')
       WHERE user_id = ? AND provider = ?`,
    )
    .run(seal(tok.access_token), expiresAt, tok.refresh_token ?? '', tok.refresh_token ? seal(tok.refresh_token) : '', row.user_id, row.provider);
  return tok.access_token;
}

/** Outlook con permiso de envío de una persona (o null). */
export async function outlookSender(personId: string): Promise<{ token: string; email: string } | null> {
  const integration = await getIntegration(personId, OUTLOOK_PROVIDER);
  if (!integration || !outlookScopeAllowsSend(integration.scope)) return null;
  const token = await getValidOutlookToken(integration).catch(() => null);
  if (!token) return null;
  return { token, email: integration.email };
}

export async function registerOutlookMailbox(userId: string, personId: string): Promise<void> {
  await getDb()
    .prepare('INSERT OR IGNORE INTO crm_outlook_sync (user_id, person_id) VALUES (?, ?)')
    .run(userId, personId);
}

export async function unregisterOutlookMailboxes(personId: string): Promise<void> {
  await getDb().prepare('DELETE FROM crm_outlook_sync WHERE person_id = ?').run(personId);
}

export async function getOutlookSync(userId: string, personId: string): Promise<CrmOutlookSyncRow | null> {
  return ((await getDb()
    .prepare('SELECT * FROM crm_outlook_sync WHERE user_id = ? AND person_id = ?')
    .get(userId, personId)) as CrmOutlookSyncRow | undefined) ?? null;
}

async function claim(userId: string, personId: string, now: Date): Promise<boolean> {
  const res = await getDb()
    .prepare(
      `UPDATE crm_outlook_sync SET locked_until = ?, status = 'syncing'
       WHERE user_id = ? AND person_id = ? AND (locked_until IS NULL OR locked_until < ?)`,
    )
    .run(dbNow(new Date(now.getTime() + LOCK_MS)), userId, personId, dbNow(now));
  return res.changes > 0;
}

async function release(
  userId: string,
  personId: string,
  patch: {
    status: string;
    error?: string | null;
    inbox?: string | null;
    sent?: string | null;
    calendar?: string | null;
    calendarWindow?: boolean;
    resetCalendar?: boolean;
  },
  now: Date,
): Promise<void> {
  const ts = dbNow(now);
  await getDb()
    .prepare(
      `UPDATE crm_outlook_sync SET locked_until = NULL, status = ?, error = ?, last_sync_at = ?,
         inbox_delta = COALESCE(?, inbox_delta),
         sent_delta = COALESCE(?, sent_delta),
         calendar_delta = CASE WHEN ? = 1 THEN NULL ELSE COALESCE(?, calendar_delta) END,
         calendar_window_at = CASE WHEN ? = 1 THEN ? ELSE calendar_window_at END,
         last_full_sync_at = CASE WHEN last_full_sync_at IS NULL AND ? = 'idle' THEN ? ELSE last_full_sync_at END
       WHERE user_id = ? AND person_id = ?`,
    )
    .run(
      patch.status,
      patch.error ?? null,
      ts,
      patch.inbox ?? null,
      patch.sent ?? null,
      patch.resetCalendar ? 1 : 0,
      patch.calendar ?? null,
      patch.calendarWindow ? 1 : 0,
      ts,
      patch.status,
      ts,
      userId,
      personId,
    );
  await getDb()
    .prepare("UPDATE integrations SET last_sync_at = datetime('now') WHERE user_id = ? AND provider = ?")
    .run(personId, OUTLOOK_PROVIDER);
}

// ---------- Calendario → reuniones ----------

function eventKey(ev: GraphEvent): string {
  return (ev.iCalUId || ev.id).slice(0, 500);
}

function meetingBody(ev: GraphEvent): string {
  const parts = [ev.bodyPreview?.trim() ?? ''];
  if (ev.location?.displayName) parts.push(ev.location.displayName);
  if (ev.onlineMeeting?.joinUrl) parts.push(ev.onlineMeeting.joinUrl);
  return parts.filter(Boolean).join('\n').slice(0, MEETING_BODY_MAX);
}

/**
 * Vuelca un evento del calendario al timeline. Devuelve true si creó o
 * actualizó una reunión. Eventos sin contactos del workspace no se guardan.
 */
export async function storeOutlookEvent(
  userId: string,
  personId: string,
  mailboxEmail: string,
  ev: GraphEvent,
  now = new Date(),
): Promise<boolean> {
  const db = getDb();
  const { createActivity, updateActivity, deleteActivity } = await import('./crm');
  const key = eventKey(ev);
  const existing = (await db
    .prepare('SELECT activity_id FROM crm_outlook_events WHERE user_id = ? AND event_key = ?')
    .get(userId, key)) as { activity_id: string | null } | undefined;

  if (ev['@removed'] || ev.isCancelled) {
    if (existing?.activity_id) await deleteActivity(userId, existing.activity_id).catch(() => null);
    if (existing) await db.prepare('DELETE FROM crm_outlook_events WHERE user_id = ? AND event_key = ?').run(userId, key);
    return Boolean(existing);
  }

  const mailbox = mailboxEmail.toLowerCase();
  const emails = [
    ...new Set(
      [ev.organizer, ...(ev.attendees ?? [])]
        .map((a) => a?.emailAddress?.address?.toLowerCase() ?? '')
        .filter((e) => e && e !== mailbox),
    ),
  ];
  const contacts = await contactsByEmail(userId, emails);
  if (!contacts.size) return false;
  const primary = emails.map((e) => contacts.get(e)).find(Boolean)!;
  const start = graphDate(ev.start);
  const end = graphDate(ev.end);
  if (!start) return false;
  const durationMin = end ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000)) : null;
  const fields = {
    subject: (ev.subject ?? '').slice(0, 500),
    body: meetingBody(ev),
    dueAt: dbNow(start),
    durationMin,
  };

  if (existing?.activity_id) {
    const updated = await updateActivity(userId, existing.activity_id, {
      ...fields,
      done: (end ?? start).getTime() < now.getTime(),
    }).catch(() => null);
    if (updated) {
      await db
        .prepare("UPDATE crm_outlook_events SET updated_at = datetime('now') WHERE user_id = ? AND event_key = ?")
        .run(userId, key);
      return true;
    }
  }

  const contact = (await db.prepare('SELECT company_id FROM crm_contacts WHERE id = ?').get(primary)) as
    | { company_id: string | null }
    | undefined;
  const activity = await createActivity(userId, {
    type: 'meeting',
    ...fields,
    contactId: primary,
    companyId: contact?.company_id ?? null,
    ownerId: personId,
  });
  if ((end ?? start).getTime() < now.getTime()) {
    await updateActivity(userId, activity.id, { done: true }).catch(() => null);
  }
  await db
    .prepare(
      `INSERT INTO crm_outlook_events (user_id, event_key, person_id, activity_id) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, event_key) DO UPDATE SET activity_id = excluded.activity_id, updated_at = datetime('now')`,
    )
    .run(userId, key, personId, activity.id);
  // Una reunión nueva por venir saca a los contactos de sus secuencias (como al agendar con Cal).
  if (start.getTime() > now.getTime()) {
    const { exitEnrollmentsForContacts } = await import('./crm-sequences');
    await exitEnrollmentsForContacts(userId, [...new Set(contacts.values())], 'meeting_booked', now).catch(() => null);
  }
  return true;
}

// ---------- Pasada ----------

/**
 * Sincroniza un buzón de Outlook: Bandeja de entrada, Enviados y calendario.
 * `maxMessages` acota los mensajes por pasada; si se corta, el link guardado
 * es el nextLink de la página siguiente y lo pendiente entra en la próxima.
 */
export async function syncOutlookMailbox(
  userId: string,
  personId: string,
  opts: { maxMessages?: number; now?: Date } = {},
): Promise<OutlookSyncResult> {
  const now = opts.now ?? new Date();
  const max = Math.min(Math.max(opts.maxMessages ?? 50, 1), 500);
  await registerOutlookMailbox(userId, personId);
  const integration = await getIntegration(personId, OUTLOOK_PROVIDER);
  if (!integration) return { status: 'not_connected', fetched: 0, stored: 0, meetings: 0 };
  if (!(await claim(userId, personId, now))) return { status: 'locked', fetched: 0, stored: 0, meetings: 0 };

  const token = await getValidOutlookToken(integration).catch(() => null);
  if (!token) {
    await release(userId, personId, { status: 'error', error: 'token_expired' }, now);
    return { status: 'token_expired', fetched: 0, stored: 0, meetings: 0 };
  }

  const state = await getOutlookSync(userId, personId);
  let fetched = 0;
  let stored = 0;
  let meetings = 0;
  let more = false;
  const links: { inbox: string | null; sent: string | null; calendar: string | null } = {
    inbox: null,
    sent: null,
    calendar: null,
  };

  async function folder(name: MailFolder, saved: string | null): Promise<string | null> {
    let link = saved;
    for (;;) {
      let page;
      try {
        page = await graphMessagesDelta(token!, name, link);
      } catch (e) {
        // deltaLink vencido o inválido (410/400): vuelve a empezar la carpeta.
        if (link && e instanceof GraphApiError && (e.status === 410 || e.status === 400 || e.status === 404)) {
          link = null;
          continue;
        }
        throw e;
      }
      for (const m of page.items) {
        if (m['@removed']) continue;
        fetched += 1;
        if (await storeGmailMessage(userId, personId, integration!.email, graphToParsed(m, name), now, 'outlook')) {
          stored += 1;
        }
      }
      if (page.deltaLink) return page.deltaLink;
      if (!page.nextLink) return link;
      link = page.nextLink;
      if (fetched >= max) {
        more = true;
        return link;
      }
    }
  }

  try {
    links.inbox = await folder('inbox', state?.inbox_delta ?? null);
    links.sent = await folder('sentitems', state?.sent_delta ?? null);

    // Calendario: la ventana se rehace cada semana para seguir cubriendo lo que viene.
    const windowAt = parseDbDate(state?.calendar_window_at);
    const renewWindow = !state?.calendar_delta || !windowAt || now.getTime() - windowAt.getTime() > CALENDAR_WINDOW_MS;
    let calLink = renewWindow ? null : state!.calendar_delta;
    for (let pages = 0; pages < 20; pages++) {
      let page;
      try {
        page = await graphCalendarDelta(token, calLink, { now });
      } catch (e) {
        if (calLink && e instanceof GraphApiError && (e.status === 410 || e.status === 400)) {
          calLink = null;
          continue;
        }
        // Sin permiso de calendario (conexión vieja): los emails siguen.
        if (e instanceof GraphApiError && e.status === 403) break;
        throw e;
      }
      for (const ev of page.items) {
        if (await storeOutlookEvent(userId, personId, integration.email, ev, now)) meetings += 1;
      }
      if (page.deltaLink) {
        calLink = page.deltaLink;
        break;
      }
      if (!page.nextLink) break;
      calLink = page.nextLink;
    }
    links.calendar = calLink;

    await release(
      userId,
      personId,
      { status: 'idle', inbox: links.inbox, sent: links.sent, calendar: links.calendar, calendarWindow: renewWindow },
      now,
    );
    return { status: 'ok', fetched, stored, meetings, more };
  } catch (e) {
    const code = e instanceof GraphApiError ? e.message : 'sync_failed';
    await release(userId, personId, { status: 'error', error: code, inbox: links.inbox, sent: links.sent }, now);
    return { status: 'error', fetched, stored, meetings };
  }
}

/** Pasada del cron: los buzones de Outlook que hace más tiempo no se sincronizan. */
export async function syncDueOutlookMailboxes(
  opts: { limit?: number; maxMessages?: number; now?: Date } = {},
): Promise<{ mailboxes: number; stored: number; meetings: number }> {
  const now = opts.now ?? new Date();
  const rows = (await getDb()
    .prepare(
      `SELECT s.user_id, s.person_id FROM crm_outlook_sync s
       JOIN integrations i ON i.user_id = s.person_id AND i.provider = ?
       WHERE s.locked_until IS NULL OR s.locked_until < ?
       ORDER BY COALESCE(s.last_sync_at, '') ASC LIMIT ?`,
    )
    .all(OUTLOOK_PROVIDER, dbNow(now), Math.min(Math.max(opts.limit ?? 20, 1), 200))) as Array<{
    user_id: string;
    person_id: string;
  }>;
  let mailboxes = 0;
  let stored = 0;
  let meetings = 0;
  for (const r of rows) {
    const res = await syncOutlookMailbox(r.user_id, r.person_id, { maxMessages: opts.maxMessages ?? 50, now }).catch(
      () => null,
    );
    if (res && res.status !== 'locked') mailboxes += 1;
    stored += res?.stored ?? 0;
    meetings += res?.meetings ?? 0;
  }
  return { mailboxes, stored, meetings };
}
