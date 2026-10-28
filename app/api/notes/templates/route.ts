import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { noteOwner } from '@/lib/notes';
import { NoteLibraryError, createNoteTemplate, listNoteTemplates } from '@/lib/notes-library';
import { noteTemplateCreateSchema } from '@/lib/notes-schema';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Plantillas propias de la persona (las de fábrica viven en el cliente). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  return NextResponse.json({ templates: await listNoteTemplates(noteOwner(user)) });
}

/** "Guardar como plantilla": título y bloques de una nota (sin adjuntos). */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const owner = noteOwner(user);
  const limited = await limitWrites('notes:write', owner.personId);
  if (limited) return limited;
  const parsed = noteTemplateCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput(parsed.error);
  try {
    return NextResponse.json(await createNoteTemplate(owner, parsed.data), { status: 201 });
  } catch (err) {
    if (err instanceof NoteLibraryError) return jsonError(409, err.code);
    throw err;
  }
}
