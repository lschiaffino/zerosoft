/**
 * CRM como centro de la suite: lo que pasa en Cal y Chat queda en el CRM.
 * - Cal: cada reserva crea/actualiza el contacto del invitado y registra la
 *   reunión en su timeline; reprogramar o cancelar actualiza esa actividad.
 * - Chat: desde una conversación se crea el contacto y se guarda la charla.
 * Nada de esto puede romper la reserva o el chat: quien llama atrapa errores.
 * Server-only.
 */
import { getDb } from './db';
import { createActivity, createContact, updateActivity } from './crm';
import { isWorkspacePerson } from './crm-refs';
import { assignNewLead, type AssignmentSource } from './crm-assignment';
import type { CalendarBookingRow, ChatMessageRow, ChatVisitorRow, CrmContactRow } from './db';

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: '', lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

/** ISO 8601 → 'YYYY-MM-DD HH:MM:SS' UTC (formato de la DB del CRM). */
function toDbUtc(iso: string): string {
  const d = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 19).replace('T', ' ');
}

/** Contacto del workspace con ese email (sin distinguir mayúsculas). */
export async function findContactByEmail(userId: string, email: string): Promise<CrmContactRow | null> {
  if (!email) return null;
  return (
    ((await getDb()
      .prepare('SELECT * FROM crm_contacts WHERE user_id = ? AND lower(email) = lower(?) ORDER BY created_at ASC LIMIT 1')
      .get(userId, email.trim())) as CrmContactRow | undefined) ?? null
  );
}

/** Busca el contacto por email o lo crea. `created` indica si es nuevo. */
export async function findOrCreateContact(
  userId: string,
  input: {
    email: string;
    name?: string | null;
    ownerId?: string | null;
    source?: string;
    /** Fuente para la asignación round-robin de leads nuevos (lib/crm-assignment.ts). */
    assign?: AssignmentSource;
  },
): Promise<{ contact: CrmContactRow; created: boolean }> {
  const existing = await findContactByEmail(userId, input.email);
  if (existing) return { contact: existing, created: false };
  const ownerId = input.ownerId && (await isWorkspacePerson(userId, input.ownerId)) ? input.ownerId : undefined;
  const contact = await createContact(userId, {
    ...splitName(input.name ?? ''),
    email: input.email.trim(),
    source: input.source ?? 'other',
    ownerId,
  });
  if (input.assign) {
    const assigned = await assignNewLead(userId, contact.id, input.assign);
    if (assigned) return { contact: { ...contact, owner_id: assigned }, created: true };
  }
  return { contact, created: true };
}

// ---------- Cal ----------

function bookingBody(booking: CalendarBookingRow): string {
  const lines: string[] = [];
  if (booking.meeting_url) lines.push(booking.meeting_url);
  try {
    const answers = JSON.parse(booking.answers || '{}') as Record<string, unknown>;
    for (const [key, value] of Object.entries(answers)) {
      if (value !== '' && value !== null && value !== undefined) lines.push(`${key}: ${String(value)}`);
    }
  } catch {
    /* respuestas corruptas: se ignoran */
  }
  return lines.join('\n');
}

function durationMin(booking: CalendarBookingRow): number | null {
  const ms = new Date(booking.ends_at).getTime() - new Date(booking.starts_at).getTime();
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms / 60000) : null;
}

async function activityForBooking(userId: string, bookingId: string): Promise<{ id: string } | null> {
  return (
    ((await getDb()
      .prepare('SELECT id FROM crm_activities WHERE user_id = ? AND booking_id = ? LIMIT 1')
      .get(userId, bookingId)) as { id: string } | undefined) ?? null
  );
}

/**
 * Refleja una reserva de Cal en el CRM del dueño del tipo de evento.
 * created → contacto (si no existe) + actividad "meeting" con la fecha de la reunión.
 * rescheduled → mueve la actividad de la reserva a la nueva fecha.
 * cancelled → marca la actividad como cancelada.
 */
export async function recordBookingInCrm(
  workspaceId: string,
  kind: 'created' | 'rescheduled' | 'cancelled',
  booking: CalendarBookingRow,
  eventTitle: string,
  reason?: string | null,
): Promise<void> {
  const db = getDb();
  if (kind === 'cancelled') {
    const activity = await activityForBooking(workspaceId, booking.id);
    if (!activity) return;
    await updateActivity(workspaceId, activity.id, {
      outcome: 'cancelled',
      subject: `${eventTitle} (cancelled)`,
      ...(reason ? { body: `${bookingBody(booking)}\n\nCancel reason: ${reason}`.trim() } : {}),
    });
    return;
  }

  // Reprogramar conserva el id de la reserva (rescheduled_from es solo la
  // fecha anterior): la actividad se busca por ese id y se mueve.
  const previous = kind === 'rescheduled' ? await activityForBooking(workspaceId, booking.id) : null;
  if (previous) {
    await updateActivity(workspaceId, previous.id, {
      dueAt: toDbUtc(booking.starts_at),
      durationMin: durationMin(booking),
      body: bookingBody(booking),
      outcome: 'rescheduled',
    });
    return;
  }

  const { contact } = await findOrCreateContact(workspaceId, {
    email: booking.invitee_email,
    name: booking.invitee_name,
    ownerId: booking.host_user_id,
    assign: 'cal',
  });
  if (await activityForBooking(workspaceId, booking.id)) return;
  const activity = await createActivity(workspaceId, {
    type: 'meeting',
    subject: eventTitle,
    body: bookingBody(booking),
    dueAt: toDbUtc(booking.starts_at),
    durationMin: durationMin(booking),
    contactId: contact.id,
    companyId: contact.company_id,
    ownerId: booking.host_user_id && (await isWorkspacePerson(workspaceId, booking.host_user_id))
      ? booking.host_user_id
      : null,
  });
  await db.prepare('UPDATE crm_activities SET booking_id = ? WHERE id = ?').run(booking.id, activity.id);

  const { runWorkflowsForEvent } = await import('./crm-workflows');
  await runWorkflowsForEvent(workspaceId, {
    type: 'meeting_booked',
    entity: 'contact',
    entityId: contact.id,
    payload: { bookingId: booking.id, startsAt: booking.starts_at, eventTitle },
  });

  // Agendar una reunión saca al contacto de sus secuencias activas.
  const { exitEnrollmentsForContacts } = await import('./crm-sequences');
  await exitEnrollmentsForContacts(workspaceId, [contact.id], 'meeting_booked');
}

// ---------- Chat ----------

const TRANSCRIPT_MAX = 40;

/**
 * Crea (o encuentra) el contacto del visitante y guarda la conversación como
 * nota en su timeline. Si la conversación ya se registró, actualiza esa nota.
 */
export async function logChatToCrm(
  workspaceId: string,
  input: {
    conversationId: string;
    subject: string | null;
    visitor: ChatVisitorRow;
    messages: Array<Pick<ChatMessageRow, 'sender_type' | 'body' | 'created_at'>>;
    actorId?: string | null;
    /** El agente confirmó la identidad de un visitante con email sin verificar. */
    confirmed?: boolean;
  },
): Promise<{ contact: CrmContactRow; created: boolean } | { error: 'missing_email' | 'unverified_email' }> {
  const email = input.visitor.email?.trim();
  if (!email) return { error: 'missing_email' };
  // Un email sin verificar (lo escribió cualquiera en el widget) no se asocia
  // solo a un contacto que ya existe: hace falta que el agente lo confirme.
  // Si esta conversación ya se guardó en un contacto, eso ya fue confirmado.
  if (input.visitor.email_verified !== 1 && !input.confirmed) {
    const logged = await getDb()
      .prepare('SELECT id FROM crm_activities WHERE user_id = ? AND chat_conversation_id = ? LIMIT 1')
      .get(workspaceId, input.conversationId);
    if (!logged && (await findContactByEmail(workspaceId, email))) return { error: 'unverified_email' };
  }
  const result = await findOrCreateContact(workspaceId, {
    email,
    name: input.visitor.name,
    ownerId: input.actorId,
    assign: 'chat',
  });

  const transcript = input.messages
    .filter((m) => m.body.trim())
    .slice(-TRANSCRIPT_MAX)
    .map((m) => {
      const who = m.sender_type === 'visitor' ? input.visitor.name || email : m.sender_type === 'user' ? 'Agent' : 'Bot';
      return `[${m.created_at.slice(0, 16).replace('T', ' ')}] ${who}: ${m.body.trim()}`;
    })
    .join('\n');
  const subject = `Chat: ${input.subject?.trim() || 'conversation'}`;

  const existing = (await getDb()
    .prepare('SELECT id FROM crm_activities WHERE user_id = ? AND chat_conversation_id = ? LIMIT 1')
    .get(workspaceId, input.conversationId)) as { id: string } | undefined;
  if (existing) {
    await updateActivity(workspaceId, existing.id, { subject, body: transcript });
  } else {
    const activity = await createActivity(workspaceId, {
      type: 'note',
      subject,
      body: transcript,
      contactId: result.contact.id,
      companyId: result.contact.company_id,
    });
    await getDb()
      .prepare('UPDATE crm_activities SET chat_conversation_id = ? WHERE id = ?')
      .run(input.conversationId, activity.id);
  }
  return result;
}
