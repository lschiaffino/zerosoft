import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { noteOwner } from '@/lib/notes';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';
import { z } from 'zod';
import { getNotePrefs, saveNotePrefs } from '@/lib/notes-prefs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const owner = noteOwner(user);
  // draftScope: de quién es el borrador local del bloc (ver NotesHome); no sale de esta persona.
  return NextResponse.json({ ...(await getNotePrefs(owner)), draftScope: `${user.id}:${owner.personId}` });
}

const schema = z.object({ home: z.array(z.string().max(30)).max(20).optional(), scratch: z.string().max(20_000).optional() });

/** Widgets del inicio y bloc rápido. */
export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const owner = noteOwner(user);
  const limited = await limitWrites('notes:write', owner.personId);
  if (limited) return limited;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput(parsed.error);
  return NextResponse.json(await saveNotePrefs(owner, parsed.data));
}
