import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { noteOwner } from '@/lib/notes';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';
import { z } from 'zod';
import { getTranslations } from 'next-intl/server';
import { canUseApp } from '@/lib/workspace';
import { listNoteEvents, noteFromEvent } from '@/lib/notes-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reservas próximas de Cal de la persona. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  if (!canUseApp({ role: user.role, apps: user.apps }, 'cal')) return NextResponse.json({ events: [] });
  return NextResponse.json({ events: await listNoteEvents(noteOwner(user)) });
}

const schema = z.object({ event_id: z.string().min(1).max(64), locale: z.enum(['en', 'es', 'pt']).default('en'), timezone: z.string().max(64).optional() });

/** Nota de reunión a partir de una reserva. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  if (!canUseApp({ role: user.role, apps: user.apps }, 'cal')) return jsonError(404, 'not_found');
  const owner = noteOwner(user);
  const limited = await limitWrites('notes:write', owner.personId);
  if (limited) return limited;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput(parsed.error);
  const t = await getTranslations({ locale: parsed.data.locale, namespace: 'notes.home.eventNote' });
  let tz = 'UTC';
  try {
    if (parsed.data.timezone) {
      new Intl.DateTimeFormat('en', { timeZone: parsed.data.timezone });
      tz = parsed.data.timezone;
    }
  } catch {
    // Zona inválida: UTC.
  }
  const note = await noteFromEvent(owner, parsed.data.event_id, { when: t('when'), with: t('with'), agenda: t('agenda'), notes: t('notes'), actions: t('actions') }, parsed.data.locale, tz);
  if (!note) return jsonError(404, 'not_found');
  return NextResponse.json(note, { status: 201 });
}
