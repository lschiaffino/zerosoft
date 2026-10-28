import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { deleteNotebook, noteOwner, renameNotebook, setNotebookStack } from '@/lib/notes';
import { notebookPatchSchema } from '@/lib/notes-schema';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Renombra la libreta y/o la mueve a una pila (stack null o '' la saca). */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const owner = noteOwner(user);
  const limited = await limitWrites('notes:write', owner.personId);
  if (limited) return limited;
  const parsed = notebookPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput(parsed.error);
  if (parsed.data.name !== undefined && !(await renameNotebook(owner, id, parsed.data.name))) return jsonError(404, 'not_found');
  if (parsed.data.stack !== undefined && !(await setNotebookStack(owner, id, parsed.data.stack))) return jsonError(404, 'not_found');
  return NextResponse.json({ ok: true });
}

/** Borra la libreta: sus notas pasan a la papelera. */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const owner = noteOwner(user);
  const limited = await limitWrites('notes:write', owner.personId);
  if (limited) return limited;
  if (!(await deleteNotebook(owner, id))) return jsonError(404, 'not_found');
  return new NextResponse(null, { status: 204 });
}
