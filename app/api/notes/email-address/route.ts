import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { noteOwner } from '@/lib/notes';
import { jsonError, limitWrites } from '@/lib/write-limit';
import { getNotesEmail } from '@/lib/notes-email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** La dirección secreta para mandarse notas por email. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  return NextResponse.json(await getNotesEmail(noteOwner(user)));
}

/** Regenerar: la dirección vieja deja de funcionar. */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const owner = noteOwner(user);
  const limited = await limitWrites('notes:write', owner.personId);
  if (limited) return limited;
  return NextResponse.json(await getNotesEmail(owner, { rotate: true }));
}
