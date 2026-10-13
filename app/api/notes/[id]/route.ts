import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import {
  NotesError,
  deleteNoteForever,
  getNote,
  noteOwner,
  restoreNote,
  trashNote,
  updateNote,
} from '@/lib/notes';
import { noteUpdateSchema } from '@/lib/notes-schema';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const note = await getNote(noteOwner(user), id);
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
  try {
    if (trashed === true) {
      if (!(await getNote(owner, id))) return jsonError(404, 'not_found');
      await trashNote(owner, id);
    } else if (trashed === false) {
      if (!(await getNote(owner, id))) return jsonError(404, 'not_found');
      await restoreNote(owner, id);
    }
    const note = await updateNote(owner, id, patch);
    if (!note) return jsonError(404, 'not_found');
    return NextResponse.json(note);
  } catch (err) {
    if (err instanceof NotesError) return jsonError(400, err.code);
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
