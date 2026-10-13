import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createNote, noteOwner } from '@/lib/notes';
import { noteClipSchema } from '@/lib/notes-schema';
import { clipBlocks } from '@/lib/notes-types';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Guarda una página recortada (bookmarklet "Clip page") como nota con su URL de origen. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const owner = noteOwner(user);
  const limited = await limitWrites('notes:write', owner.personId);
  if (limited) return limited;
  const parsed = noteClipSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput(parsed.error);
  const { url, title, selection } = parsed.data;
  const note = await createNote(owner, {
    title: (title?.trim() || url).slice(0, 300),
    source_url: url,
    content: clipBlocks(url, selection ?? ''),
    tags: ['clip'],
  });
  return NextResponse.json(note, { status: 201 });
}
