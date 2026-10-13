import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { emptyNotesTrash, noteOwner } from '@/lib/notes';
import { jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Vacía la papelera de la persona. */
export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const owner = noteOwner(user);
  const limited = await limitWrites('notes:write', owner.personId);
  if (limited) return limited;
  const deleted = await emptyNotesTrash(owner);
  return NextResponse.json({ deleted });
}
