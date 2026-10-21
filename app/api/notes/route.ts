import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { NotesError, createNote, listNotes, noteOwner } from '@/lib/notes';
import { noteCreateSchema } from '@/lib/notes-schema';
import { NOTES_SORTS, type NotesSort } from '@/lib/notes-types';
import { listSharedWithMe } from '@/lib/notes-shares';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const sp = req.nextUrl.searchParams;
  const viewParam = sp.get('view');
  // "Compartidas conmigo": notas de otras personas del workspace (sin búsqueda ni filtros).
  if (viewParam === 'shared') {
    return NextResponse.json({ notes: await listSharedWithMe(noteOwner(user), { q: sp.get('q')?.slice(0, 200) ?? null }) });
  }
  const view = viewParam === 'pinned' || viewParam === 'trash' ? viewParam : 'all';
  const sortParam = sp.get('sort') as NotesSort | null;
  const notes = await listNotes(noteOwner(user), {
    view,
    notebookId: sp.get('notebook'),
    tag: sp.get('tag'),
    q: sp.get('q')?.slice(0, 200) ?? null,
    sort: sortParam && NOTES_SORTS.includes(sortParam) ? sortParam : 'updated',
  });
  return NextResponse.json({ notes });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const owner = noteOwner(user);
  const limited = await limitWrites('notes:write', owner.personId);
  if (limited) return limited;
  const parsed = noteCreateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return invalidInput(parsed.error);
  try {
    const note = await createNote(owner, parsed.data);
    return NextResponse.json(note, { status: 201 });
  } catch (err) {
    if (err instanceof NotesError) return jsonError(400, err.code);
    if (/UNIQUE|PRIMARY KEY|constraint/i.test(String(err))) return jsonError(409, 'id_taken');
    throw err;
  }
}
