import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { noteOwner } from '@/lib/notes';
import { getNoteVersion } from '@/lib/notes-versions';
import { resolveBlocksPageLinks } from '@/lib/docs-page-links';
import { noteHref } from '@/lib/notes-types';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Vista previa de una versión (solo la persona dueña de la nota). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string; versionId: string }> }) {
  const { id, versionId } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const version = await getNoteVersion(noteOwner(user), id, versionId);
  if (!version) return jsonError(404, 'not_found');
  // Links [[ ]] guardados con el href de Docs: en la vista previa van a la nota.
  return NextResponse.json({ ...version, content: resolveBlocksPageLinks(version.content, (noteId) => ({ href: noteHref(noteId) })) });
}
