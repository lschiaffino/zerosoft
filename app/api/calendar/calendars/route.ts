import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, realUserId } from '@/lib/session';
import { getIntegration } from '@/lib/integrations';
import { GOOGLE_CALENDAR_PROVIDER, GOOGLE_CALENDARLIST_SCOPE, invalidateBusyCache, listGoogleCalendars } from '@/lib/google-calendar';
import { OUTLOOK_CALENDAR_PROVIDER, invalidateOutlookBusyCache, listOutlookCalendars } from '@/lib/outlook-calendar';
import { ICLOUD_CALENDAR_PROVIDER, invalidateICloudBusyCache, listICloudCalendars } from '@/lib/icloud-calendar';
import { getPersonCalendars, setPersonCalendars } from '@/lib/calendar-calendars';
import { crmError, invalidBody, unauthorized } from '@/lib/crm-http';
import { fakeGoogleCalendarAllowed } from '@/lib/google-calendar-fake';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Calendarios externos de la persona logueada (no del workspace): qué tiene
 * conectado, la lista de cada proveedor y qué revisa / dónde escribe.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const me = realUserId(user);
  const [google, outlook, icloud, settings] = await Promise.all([
    getIntegration(me, GOOGLE_CALENDAR_PROVIDER),
    getIntegration(me, OUTLOOK_CALENDAR_PROVIDER),
    getIntegration(me, ICLOUD_CALENDAR_PROVIDER),
    getPersonCalendars(me),
  ]);
  // Las conexiones de antes no pidieron la lista de calendarios: hay que reconectar para elegir.
  const googleHasList = !!google && (fakeGoogleCalendarAllowed() || (google.scope ?? '').includes(GOOGLE_CALENDARLIST_SCOPE));
  return NextResponse.json({
    google: google
      ? {
          connected: true,
          email: google.email,
          calendars: googleHasList ? await listGoogleCalendars(me) : null,
          needsReconnect: !googleHasList,
        }
      : { connected: false },
    outlook: outlook ? { connected: true, email: outlook.email, calendars: await listOutlookCalendars(me) } : { connected: false },
    icloud: icloud ? { connected: true, email: icloud.email, calendars: await listICloudCalendars(me) } : { connected: false },
    settings,
  });
}

const id = z.string().trim().min(1).max(300);
const bodySchema = z.object({
  google: z.object({ check: z.array(id).max(20) }).optional(),
  outlook: z.object({ check: z.array(z.string().trim().max(300)).max(20) }).optional(),
  icloud: z.object({ check: z.array(z.string().trim().max(500)).max(20) }).optional(),
  write: z.object({ provider: z.enum(['google', 'outlook', 'icloud']), calendarId: z.string().trim().max(500) }).nullish(),
});

/** Guarda qué calendarios bloquean horarios y dónde se agregan las reservas. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const me = realUserId(user);
  const { write, ...rest } = parsed.data;
  // Solo calendarios que el proveedor de la persona devuelve (y se puede escribir en el destino).
  const lists = {
    google: rest.google || write?.provider === 'google' ? await listGoogleCalendars(me) : null,
    outlook: rest.outlook || write?.provider === 'outlook' ? await listOutlookCalendars(me) : null,
    icloud: rest.icloud || write?.provider === 'icloud' ? await listICloudCalendars(me) : null,
  };
  const idsOf = (provider: 'google' | 'outlook' | 'icloud', writable = false) =>
    new Set(
      (lists[provider] ?? [])
        .filter((c) => !writable || c.canWrite)
        .flatMap((c) => [c.id, ...(c.primary ? [provider === 'google' ? 'primary' : provider === 'outlook' ? '' : c.id] : [])]),
    );
  for (const provider of ['google', 'outlook', 'icloud'] as const) {
    const check = rest[provider]?.check;
    if (!check) continue;
    const allowed = idsOf(provider);
    if (check.some((c) => !allowed.has(c))) return crmError(400, 'invalid_calendar');
  }
  if (write && !idsOf(write.provider, true).has(write.calendarId)) return crmError(400, 'invalid_calendar');
  const saved = await setPersonCalendars(me, {
    ...rest,
    ...(write ? { write: { provider: write.provider, calendarId: write.calendarId } } : {}),
    clearWrite: write === null,
  });
  invalidateBusyCache(me);
  invalidateOutlookBusyCache(me);
  invalidateICloudBusyCache(me);
  return NextResponse.json({ settings: saved });
}
