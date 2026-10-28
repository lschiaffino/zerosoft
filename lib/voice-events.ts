/**
 * Voice → webhooks y Flow. Server-only.
 *
 * - voice.meeting.completed: se cortó la grabación (o se importó).
 * - voice.notes.ready: la nota con IA quedó lista (o se regeneró).
 *
 * Las reuniones son privadas: solo reciben el evento los webhooks y flows que
 * creó la misma persona que grabó (audience). El cuerpo lleva la nota, nunca
 * la transcripción.
 */
import { getDb } from './db';
import { personAppAccess } from './api-auth';
import { parseAttendees, type VoiceSessionRow } from './voice';
import type { VoiceEnhanced } from './voice-types';

function appUrl(): string {
  return (process.env.NEXTAUTH_URL || 'https://zerosoftware.ai').replace(/\/$/, '');
}

export function meetingPayload(row: VoiceSessionRow) {
  return {
    id: row.id,
    title: row.title,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationMs: Number(row.duration_ms) || 0,
    attendees: parseAttendees(row.attendees),
    contactId: row.contact_id,
    calBookingId: row.cal_booking_id,
    url: `${appUrl()}/${row.locale || 'en'}/app/voice/meetings/${row.id}`,
  };
}

export async function emitVoiceEvent(sessionId: string, type: 'voice.meeting.completed' | 'voice.notes.ready', enhanced?: VoiceEnhanced | null): Promise<void> {
  try {
    const row = (await getDb().prepare('SELECT * FROM voice_sessions WHERE id = ?').get(sessionId)) as VoiceSessionRow | undefined;
    if (!row || row.kind !== 'meeting') return;
    const data: Record<string, unknown> = { meeting: meetingPayload(row) };
    if (type === 'voice.notes.ready' && enhanced) {
      data.notes = { summary: enhanced.summary, sections: enhanced.sections, decisions: enhanced.decisions, actionItems: enhanced.actionItems };
    }
    const { emitEventSoon } = await import('./events');
    await emitEventSoon(row.workspace_id, type, data, {
      audience: async (creatorId) => creatorId === row.person_id && (await personUsesVoice(row.workspace_id, creatorId)),
    });
  } catch (err) {
    console.error('[voice] event failed', err instanceof Error ? err.message : 'error');
  }
}

/**
 * ¿Se puede entregar (o reintentar) este evento al webhook de `creatorId`?
 * Solo si la reunión sigue existiendo, es de esa misma persona y la persona
 * sigue en el workspace con la app Voice.
 */
export async function voiceDeliveryAllowed(workspaceId: string, creatorId: string | null, data: unknown): Promise<boolean> {
  if (!creatorId) return false;
  const id = String((data as { meeting?: { id?: unknown } } | null)?.meeting?.id ?? '');
  if (!id) return false;
  const row = (await getDb().prepare('SELECT person_id FROM voice_sessions WHERE id = ? AND workspace_id = ?').get(id, workspaceId)) as { person_id: string } | undefined;
  if (!row || row.person_id !== creatorId) return false;
  return personUsesVoice(workspaceId, creatorId);
}

/** ¿La persona sigue en el workspace y con la app Voice? (acceso por app, migración 128). */
export async function personUsesVoice(workspaceId: string, personId: string | null): Promise<boolean> {
  if (!personId) return false;
  const access = await personAppAccess(workspaceId, personId);
  if (!access) return false;
  return access.role === 'owner' || (access.role !== 'guest' && (access.apps === '*' || access.apps.includes('voice')));
}
