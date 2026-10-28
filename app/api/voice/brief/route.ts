import { NextRequest, NextResponse } from 'next/server';
import { voiceAuth, readBody } from '@/lib/voice-route';
import { meetingLabels, voiceErrorResponse, voiceJsonError } from '@/lib/voice-http';
import { findCalendarEvent } from '@/lib/voice-calendar';
import { buildBrief } from '@/lib/voice-prep';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Brief antes de una reunión del calendario: lo hablado antes con sus
 * asistentes, solo con las reuniones propias. Body: { eventKey, locale? }.
 */
export async function POST(req: NextRequest) {
  const auth = await voiceAuth({ bucket: 'ai', limit: 20 });
  if (auth.res) return auth.res;
  const body = await readBody(req);
  const key = typeof body.eventKey === 'string' ? body.eventKey.slice(0, 600) : '';
  const locale = typeof body.locale === 'string' ? body.locale : 'en';
  const event = key ? await findCalendarEvent(auth.owner, key) : null;
  if (!event) return voiceJsonError(404, 'event_not_found');
  try {
    return NextResponse.json(
      await buildBrief({ owner: auth.owner, title: event.title, attendees: event.attendees, locale, labels: meetingLabels(locale), excludeId: event.sessionId ?? undefined }),
    );
  } catch (err) {
    return voiceErrorResponse(err);
  }
}
