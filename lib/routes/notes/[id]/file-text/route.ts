import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { noteOwner } from '@/lib/notes';
import { resolveNoteAccess } from '@/lib/notes-shares';
import { noteFileFailures, retryNoteFileFailures } from '@/lib/notes-file-text';
import { jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Archivos de la nota que no se pudieron leer para la búsqueda. */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  if (!(await resolveNoteAccess(noteOwner(user), id))) return jsonError(404, 'not_found');
  return NextResponse.json({ failed: await noteFileFailures(id) });
}

/** Los vuelve a la cola. */
export async function POST(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const owner = noteOwner(user);
  const access = await resolveNoteAccess(owner, id);
  if (!access || access.access === 'view') return jsonError(404, 'not_found');
  const limited = await limitWrites('notes:write', owner.personId);
  if (limited) return limited;
  await retryNoteFileFailures(id);
  return NextResponse.json({ failed: [] });
}
