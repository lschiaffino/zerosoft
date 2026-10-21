import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import {
  NotesConflictError,
  NotesError,
  deleteNoteForever,
  getNote,
  noteOwner,
  restoreNote,
  trashNote,
  updateNote,
} from '@/lib/notes';
import { noteUpdateSchema } from '@/lib/notes-schema';
import { getNoteForViewer, resolveNoteAccess, sharedPatchAllowed } from '@/lib/notes-shares';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  // Propia o compartida conmigo (con lo que corresponde ver a quien la recibió).
  const note = await getNoteForViewer(noteOwner(user), id);
  if (!note) return jsonError(404, 'not_found');
  return NextResponse.json(note);
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const owner = noteOwner(user);
  const limited = await limitWrites('notes:write', owner.personId);
  if (limited) return limited;
  const parsed = noteUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput(parsed.error);
  const { trashed, ...patch } = parsed.data;
  const access = await resolveNoteAccess(owner, id);
  if (!access) return jsonError(404, 'not_found');
  if (access.access !== 'owner') {
    // Compartida conmigo: con 'edit' solo título y contenido; lo demás es del dueño.
    if (access.access !== 'edit' || trashed !== undefined || !sharedPatchAllowed(patch)) return jsonError(403, 'forbidden');
    try {
      const updated = await updateNote(access.owner, id, patch);
      if (!updated) return jsonError(404, 'not_found');
      return NextResponse.json(await getNoteForViewer(owner, id));
    } catch (err) {
      if (err instanceof NotesConflictError) {
        return NextResponse.json({ error: 'conflict', note: await getNoteForViewer(owner, id) }, { status: 409 });
      }
      if (err instanceof NotesError && err.code === 'note_trashed') return jsonError(404, 'not_found');
      throw err;
    }
  }
  try {
    // Orden: restaurar, editar, mandar a la papelera (una nota en la papelera no se edita).
    if (trashed === false) {
      if (!(await getNote(owner, id))) return jsonError(404, 'not_found');
      await restoreNote(owner, id);
    }
    let note = await updateNote(owner, id, patch);
    if (!note) return jsonError(404, 'not_found');
    if (trashed === true) {
      await trashNote(owner, id);
      note = await getNote(owner, id);
      if (!note) return jsonError(404, 'not_found');
    }
    return NextResponse.json(note);
  } catch (err) {
    // Otra pestaña o dispositivo guardó desde que se abrió la nota: no se pisa en silencio.
    if (err instanceof NotesConflictError) {
      return NextResponse.json({ error: 'conflict', note: err.current }, { status: 409 });
    }
    if (err instanceof NotesError) {
      if (err.code === 'note_trashed') {
        return NextResponse.json({ error: 'note_trashed', note: await getNote(owner, id) }, { status: 409 });
      }
      return jsonError(400, err.code);
    }
    throw err;
  }
}

/** Borrado definitivo (solo notas en la papelera). */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const owner = noteOwner(user);
  const note = await getNote(owner, id);
  if (!note) return jsonError(404, 'not_found');
  if (!note.trashed) return jsonError(409, 'not_in_trash');
  await deleteNoteForever(owner, id);
  return new NextResponse(null, { status: 204 });
}
