import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { NotesError, noteOwner, restoreNoteVersion } from '@/lib/notes';
import { jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Restaura una versión (el estado actual queda guardado como versión 'restore'). */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string; versionId: string }> }) {
  const { id, versionId } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const owner = noteOwner(user);
  const limited = await limitWrites('notes:write', owner.personId);
  if (limited) return limited;
  try {
    const note = await restoreNoteVersion(owner, id, versionId);
    if (!note) return jsonError(404, 'not_found');
    return NextResponse.json(note);
  } catch (err) {
    if (err instanceof NotesError) return jsonError(409, err.code);
    throw err;
  }
}
