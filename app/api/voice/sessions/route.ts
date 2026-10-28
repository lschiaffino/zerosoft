import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createSession, getSessionDetail, listSessions, updateSession } from '@/lib/voice';
import { voiceAuth } from '@/lib/voice-route';
import { voiceErrorResponse, voiceJsonError } from '@/lib/voice-http';
import { linkBooking } from '@/lib/voice-integrations';
import { canSeeEntity, sessionScope } from '@/lib/crm-visibility';
import { findContactByEmail } from '@/lib/crm-integrations';
import { VOICE_TITLE_MAX } from '@/lib/voice-types';
import { findCalendarEvent, forgetCalendarCache, parseEventKey } from '@/lib/voice-calendar';
import { ownsFolder } from '@/lib/voice-library';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Lista propia. ?kind=meeting|dictation, ?q= busca en título, notas y transcripción, ?folder=<id>|none filtra por carpeta. */
export async function GET(req: NextRequest) {
  const auth = await voiceAuth();
  if (auth.res) return auth.res;
  const sp = new URL(req.url).searchParams;
  const kind = sp.get('kind');
  // ?folder= (o ?folderId=): 'none' o una carpeta propia; una ajena o borrada da 404.
  const folder = (sp.get('folder') || sp.get('folderId') || '').slice(0, 64) || null;
  if (folder && folder !== 'none' && !(await ownsFolder(auth.owner, folder))) return voiceJsonError(404, 'folder_not_found');
  const sessions = await listSessions(auth.owner, {
    kind: kind === 'meeting' || kind === 'dictation' ? kind : undefined,
    q: sp.get('q')?.slice(0, 200) ?? null,
    folderId: folder,
    limit: Number(sp.get('limit')) || 200,
    offset: Number(sp.get('offset')) || 0,
  });
  return NextResponse.json({ sessions });
}

const createSchema = z.object({
  title: z.string().max(VOICE_TITLE_MAX).optional(),
  capture: z.enum(['mic', 'mic_tab', 'file', 'desktop']).optional(),
  templateKey: z.string().max(64).optional(),
  bookingId: z.string().max(64).optional(),
  /** Evento del calendario ("cal:<id>", "google:<id>", "outlook:<id>"): título, asistentes y contacto salen de ahí. */
  eventKey: z.string().max(600).optional(),
  folderId: z.string().max(64).optional(),
  locale: z.enum(['en', 'es', 'pt']).optional(),
});

/** Reunión nueva (los dictados se crean en /api/voice/dictate). */
export async function POST(req: NextRequest) {
  const auth = await voiceAuth({ bucket: 'write' });
  if (auth.res) return auth.res;
  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return voiceJsonError(400, 'invalid_input');
  try {
    if (parsed.data.folderId && !(await ownsFolder(auth.owner, parsed.data.folderId))) return voiceJsonError(404, 'folder_not_found');
    // El evento se busca en el calendario de la persona (nunca se confía en lo que manda el cliente).
    const eventKey = parsed.data.eventKey && parseEventKey(parsed.data.eventKey) ? parsed.data.eventKey : null;
    const event = eventKey ? await findCalendarEvent(auth.owner, eventKey) : null;
    if (eventKey && !event) return voiceJsonError(404, 'event_not_found');
    const row = await createSession(auth.owner, {
      kind: 'meeting',
      title: parsed.data.title || (event && event.provider !== 'cal' ? event.title : undefined),
      capture: parsed.data.capture ?? 'mic',
      templateKey: parsed.data.templateKey ?? 'general',
      // 'recording' solo mientras graba (lo pone el grabador).
      status: 'done',
      locale: parsed.data.locale,
      folderId: parsed.data.folderId ?? null,
      attendees: event?.attendees ?? [],
      eventKey: event?.key ?? null,
    });
    const scope = await sessionScope(auth.user);
    const bookingId = parsed.data.bookingId ?? (event?.provider === 'cal' ? event.key.slice(4) : undefined);
    if (bookingId) {
      await linkBooking({ owner: auth.owner, scope, sessionId: row.id, bookingId, currentTitle: row.title });
    } else if (event) {
      // Google u Outlook: el contacto del CRM sale del primer asistente que esté en el CRM (y la persona vea).
      for (const a of event.attendees.slice(0, 10)) {
        const contact = a.email ? await findContactByEmail(auth.owner.workspaceId, a.email) : null;
        if (contact && (await canSeeEntity(auth.owner.workspaceId, 'contact', contact.id, scope))) {
          await updateSession(auth.owner, row.id, { contactId: contact.id });
          break;
        }
      }
    }
    if (event) forgetCalendarCache(auth.owner);
    return NextResponse.json(await getSessionDetail(auth.owner, row.id), { status: 201 });
  } catch (err) {
    return voiceErrorResponse(err);
  }
}
