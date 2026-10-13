import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { noteOwner, setNoteShared } from '@/lib/notes';
import { noteShareSchema } from '@/lib/notes-schema';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Activa/desactiva el link público de solo lectura (/n/<token>). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const owner = noteOwner(user);
  const limited = await limitWrites('notes:share', owner.personId, 30);
  if (limited) return limited;
  const parsed = noteShareSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput(parsed.error);
  const token = await setNoteShared(owner, id, parsed.data.shared);
  if (token === false) return jsonError(404, 'not_found');
  return NextResponse.json({ share_token: token });
}
