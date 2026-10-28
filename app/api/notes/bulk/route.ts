import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { emitEventSoon } from '@/lib/events';
import { NotesError, bulkNotes, getNote, noteOwner } from '@/lib/notes';
import { noteBulkSchema } from '@/lib/notes-schema';
import { normalizeTag, noteEventPayload } from '@/lib/notes-types';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Varias notas a la vez (selección de la lista): mover a una libreta,
 * agregar o sacar una etiqueta, fijar, mandar a la papelera, restaurar o
 * borrar para siempre (solo desde la papelera). Solo notas propias.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const owner = noteOwner(user);
  const limited = await limitWrites('notes:write', owner.personId);
  if (limited) return limited;
  const parsed = noteBulkSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput(parsed.error);
  const { ids, action, notebook_id, tag } = parsed.data;
  if (action === 'move' && notebook_id === undefined) return jsonError(400, 'invalid_input');
  if ((action === 'tag' || action === 'untag') && !normalizeTag(tag ?? '')) return jsonError(400, 'invalid_input');
  try {
    const changed = await bulkNotes(owner, ids, action, { notebookId: notebook_id ?? null, tag });
    // Disparadores de Flow, como en el PATCH de una nota (sin el contenido).
    if (action === 'tag' || action === 'trash') {
      for (const id of changed.slice(0, 100)) {
        const note = await getNote(owner, id);
        if (!note) continue;
        const payload = noteEventPayload(note, owner.personId);
        if (action === 'tag') await emitEventSoon(owner.workspaceId, 'note.tagged', { ...payload, added: [normalizeTag(tag ?? '')] });
        else await emitEventSoon(owner.workspaceId, 'note.trashed', payload);
      }
    }
    return NextResponse.json({ changed });
  } catch (err) {
    if (err instanceof NotesError) return jsonError(400, err.code);
    throw err;
  }
}
