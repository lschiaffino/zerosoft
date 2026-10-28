import { NextResponse } from 'next/server';
import { voiceAuth } from '@/lib/voice-route';
import { listCalendarEvents } from '@/lib/voice-calendar';
import { getVoiceSettings } from '@/lib/voice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Próximos eventos del calendario de la persona (reservas de Cal, Google y
 * Outlook conectados en Cal), con la reunión de Voice ya creada si hay, y
 * los ajustes del aviso previo.
 */
export async function GET() {
  const auth = await voiceAuth();
  if (auth.res) return auth.res;
  const [events, settings] = await Promise.all([listCalendarEvents(auth.owner).catch(() => []), getVoiceSettings(auth.owner)]);
  return NextResponse.json({ events, reminders: settings.reminders, reminderMinutes: settings.reminderMinutes });
}
