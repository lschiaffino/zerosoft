import { NextRequest, NextResponse } from 'next/server';
import { voiceAuth } from '@/lib/voice-route';
import { dayWindow, listCalendarEvents } from '@/lib/voice-calendar';
import { googleCalendarConnected } from '@/lib/google-calendar';
import { outlookCalendarConnected } from '@/lib/outlook-calendar';
import { getVoiceSettings } from '@/lib/voice';
import { noStore } from '@/lib/no-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Próximos eventos del calendario de la persona (reservas de Cal, Google y
 * Outlook conectados en Cal), con la reunión de Voice ya creada si hay, y
 * los ajustes del aviso previo. Con ?from=&to= (el día local de la persona,
 * hasta 36 h) devuelve los eventos de ese día, para elegir uno en la reunión.
 */
async function getPrivate(req: NextRequest) {
  const auth = await voiceAuth();
  if (auth.res) return auth.res;
  const params = new URL(req.url).searchParams;
  const window = dayWindow(params.get('from'), params.get('to'));
  const [events, settings, google, outlook] = await Promise.all([
    listCalendarEvents(auth.owner, window ? { window } : {}).catch(() => []),
    getVoiceSettings(auth.owner),
    googleCalendarConnected(auth.owner.personId).catch(() => false),
    outlookCalendarConnected(auth.owner.personId).catch(() => false),
  ]);
  return NextResponse.json({ events, reminders: settings.reminders, reminderMinutes: settings.reminderMinutes, calendarConnected: google || outlook });
}

/** Datos de la persona: sin caché (lib/no-store.ts). */
export async function GET(...args: Parameters<typeof getPrivate>) {
  return noStore(await getPrivate(...args));
}
