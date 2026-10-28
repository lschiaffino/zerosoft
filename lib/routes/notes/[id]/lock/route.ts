import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { NotesConflictError, NotesError, lockNote, noteOwner, unlockNote } from '@/lib/notes';
import { noteLockSchema } from '@/lib/notes-schema';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Bloquear o sacar el bloqueo de una nota (solo la persona dueña). El
 * cifrado pasa en el navegador: acá llega el sobre ya cifrado (lock) o el
 * contenido ya descifrado (unlock). La contraseña nunca viaja.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const owner = noteOwner(user);
  const limited = await limitWrites('notes:write', owner.personId);
  if (limited) return limited;
  const parsed = noteLockSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput(parsed.error);
  try {
    const body = parsed.data;
    const note =
      body.action === 'lock'
        ? await lockNote(owner, id, { lock: body.lock, content: body.content, base_updated_at: body.base_updated_at })
        : await unlockNote(owner, id, { title: body.title, content: body.content, base_updated_at: body.base_updated_at, proof: body.proof });
    if (!note) return jsonError(404, 'not_found');
    return NextResponse.json(note);
  } catch (err) {
    if (err instanceof NotesConflictError) return NextResponse.json({ error: 'conflict', note: err.current }, { status: 409 });
    if (err instanceof NotesError) return jsonError(err.code === 'wrong_password' ? 403 : 409, err.code);
    throw err;
  }
}
