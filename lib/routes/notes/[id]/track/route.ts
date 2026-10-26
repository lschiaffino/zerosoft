import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { noteOwner } from '@/lib/notes';
import { noteTrackSchema } from '@/lib/notes-schema';
import { resolveNoteAccess } from '@/lib/notes-shares';
import { sendNoteToTrack } from '@/lib/notes-track';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';
import en from '@/messages/en/notes.json';
import es from '@/messages/es/notes.json';
import pt from '@/messages/pt/notes.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FROM: Record<string, string> = { en: en.track.fromNote, es: es.track.fromNote, pt: pt.track.fromNote };

/**
 * Nota → issues de Track. Body: { projectId, blockIds?, base_updated_at?, locale? }.
 * Con `blockIds`, un issue por tarea; sin ellos, uno con toda la nota. La
 * nota tiene que ser propia o compartida conmigo para editar.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const viewer = noteOwner(user);
  const limited = await limitWrites('notes:track', viewer.personId, 30);
  if (limited) return limited;
  const parsed = noteTrackSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput(parsed.error);
  const access = await resolveNoteAccess(viewer, id);
  if (!access) return jsonError(404, 'not_found');
  if (access.access === 'view') return jsonError(403, 'forbidden');
  const res = await sendNoteToTrack({
    owner: access.owner,
    teamId: user.team?.id ?? null,
    personId: viewer.personId,
    noteId: id,
    projectId: parsed.data.projectId,
    blockIds: parsed.data.blockIds,
    baseUpdatedAt: parsed.data.base_updated_at,
    fromLabel: FROM[parsed.data.locale ?? 'en'] ?? FROM.en,
  });
  if (!res.ok) {
    const status = res.code === 'conflict' || res.code === 'trashed' ? 409 : res.code === 'nothing_to_send' ? 400 : 404;
    return jsonError(status, res.code);
  }
  return NextResponse.json({ issues: res.issues, skipped: res.skipped }, { status: 201 });
}
