import { NextResponse, type NextRequest } from 'next/server';
import { noteOwner } from './notes';
import { notePeopleShareSchema } from './notes-schema';
import { listNoteShares, noteShareCandidates, setNoteShare, type NoteShareTarget } from './notes-shares';
import { invalidInput, jsonError, limitWrites } from './write-limit';

type SessionLike = { id: string; actingUser?: { id: string } | null };

/** GET de /api/notes/[id]/shares y /api/notes/notebooks/[id]/shares: solo el dueño. */
export async function sharesGet(user: SessionLike | null, target: NoteShareTarget): Promise<NextResponse> {
  if (!user) return jsonError(401, 'unauthorized');
  const owner = noteOwner(user);
  const shares = await listNoteShares(owner, target);
  if (!shares) return jsonError(404, 'not_found');
  return NextResponse.json({ shares, candidates: await noteShareCandidates(owner) });
}

/** PATCH: { personId, role } comparte o cambia el rol; role null deja de compartir. */
export async function sharesPatch(req: NextRequest, user: SessionLike | null, target: NoteShareTarget): Promise<NextResponse> {
  if (!user) return jsonError(401, 'unauthorized');
  const owner = noteOwner(user);
  const limited = await limitWrites('notes:share', owner.personId, 60);
  if (limited) return limited;
  const parsed = notePeopleShareSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput(parsed.error);
  const res = await setNoteShare(owner, target, parsed.data.personId, parsed.data.role);
  if (res === 'not_found') return jsonError(404, 'not_found');
  if (res === 'not_member') return jsonError(400, 'not_member');
  return NextResponse.json({ shares: await listNoteShares(owner, target), candidates: await noteShareCandidates(owner) });
}
