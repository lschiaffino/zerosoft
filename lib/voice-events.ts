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
    await emitEventSoon(row.workspace_id, type, data, { audience: async (creatorId) => creatorId === row.person_id });
  } catch (err) {
    console.error('[voice] event failed', err instanceof Error ? err.message : 'error');
  }
}
