import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { noteOwner, renameStack } from '@/lib/notes';
import { stackPatchSchema } from '@/lib/notes-schema';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Renombra una pila de libretas ({ from, to }) o la deshace ({ from, to: null }). */
export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const owner = noteOwner(user);
  const limited = await limitWrites('notes:write', owner.personId);
  if (limited) return limited;
  const parsed = stackPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput(parsed.error);
  const changed = await renameStack(owner, parsed.data.from, parsed.data.to);
  if (!changed) return jsonError(404, 'not_found');
  return NextResponse.json({ changed });
}
