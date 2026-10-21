import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { noteBlocksForFiles, noteOwner } from '@/lib/notes';
import { resolveNoteAccess } from '@/lib/notes-shares';
import { findFileBlock } from '@/lib/docs-files';
import { fileBlockResponse } from '@/lib/upload-serve';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sirve el adjunto de una nota: a la persona dueña, a quien la recibió
 * compartida o, con ?share=<token>, a
 * quien tenga el link público de esa misma nota. Sin acceso: 404 (no se
 * confirma que exista). La URL del storage nunca sale de acá.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string; blockId: string }> }) {
  const { id, blockId } = await ctx.params;
  const user = await getCurrentUser();
  const share = req.nextUrl.searchParams.get('share');
  // Dueño de la nota: el propio, o el de una nota compartida conmigo.
  const access = user ? await resolveNoteAccess(noteOwner(user), id) : null;
  const blocks = await noteBlocksForFiles(access?.owner ?? null, id, share);
  if (!blocks) return jsonError(404, 'not_found');
  const block = findFileBlock(blocks, blockId);
  if (!block) return jsonError(404, 'not_found');
  return (
    (await fileBlockResponse(block, { download: req.nextUrl.searchParams.get('download') === '1' })) ??
    jsonError(404, 'not_found')
  );
}
