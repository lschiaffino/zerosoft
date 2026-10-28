import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { noteOwner } from '@/lib/notes';
import { NoteLibraryError, createSavedSearch, listSavedSearches } from '@/lib/notes-library';
import { savedSearchCreateSchema } from '@/lib/notes-schema';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  return NextResponse.json({ searches: await listSavedSearches(noteOwner(user)) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const owner = noteOwner(user);
  const limited = await limitWrites('notes:write', owner.personId);
  if (limited) return limited;
  const parsed = savedSearchCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput(parsed.error);
  try {
    return NextResponse.json(await createSavedSearch(owner, parsed.data), { status: 201 });
  } catch (err) {
    if (err instanceof NoteLibraryError) return jsonError(409, err.code);
    throw err;
  }
}
