import { NextResponse } from 'next/server';
import { voiceAuth } from '@/lib/voice-route';
import { listCalendarEvents } from '@/lib/voice-calendar';
import { getVoiceSettings } from '@/lib/voice';
import { noStore } from '@/lib/no-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Próximos eventos del calendario de la persona (reservas de Cal, Google y
 * Outlook conectados en Cal), con la reunión de Voice ya creada si hay, y
 * los ajustes del aviso previo.
 */
async function getPrivate() {
  const auth = await voiceAuth();
  if (auth.res) return auth.res;
  const [events, settings] = await Promise.all([listCalendarEvents(auth.owner).catch(() => []), getVoiceSettings(auth.owner)]);
  return NextResponse.json({ events, reminders: settings.reminders, reminderMinutes: settings.reminderMinutes });
}

/** Datos de la persona: sin caché (lib/no-store.ts). */
export async function GET(...args: Parameters<typeof getPrivate>) {
  return noStore(await getPrivate(...args));
}
