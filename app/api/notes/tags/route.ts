import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { deleteTag, listTags, noteOwner, renameTag } from '@/lib/notes';
import { tagRenameSchema } from '@/lib/notes-schema';
import { normalizeTag } from '@/lib/notes-types';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  return NextResponse.json({ tags: await listTags(noteOwner(user)) });
}

/** Renombra una etiqueta (y sus hijas, "a/b" → "c/b") en todas las notas de la persona. */
export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const owner = noteOwner(user);
  const limited = await limitWrites('notes:write', owner.personId);
  if (limited) return limited;
  const parsed = tagRenameSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput(parsed.error);
  const to = normalizeTag(parsed.data.to);
  if (!to) return jsonError(400, 'invalid_input');
  const changed = await renameTag(owner, parsed.data.from, to);
  return NextResponse.json({ changed, tag: to });
}

/** Saca la etiqueta (y sus hijas) de todas las notas: ?tag=<etiqueta>. */
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const owner = noteOwner(user);
  const limited = await limitWrites('notes:write', owner.personId);
  if (limited) return limited;
  const tag = req.nextUrl.searchParams.get('tag')?.slice(0, 80) ?? '';
  if (!normalizeTag(tag)) return jsonError(400, 'invalid_input');
  return NextResponse.json({ changed: await deleteTag(owner, tag) });
}
