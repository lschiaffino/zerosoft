import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { NOTES_SYNC_PAGE, listNotebooks, listNotesForSync, listTags, noteOwner } from '@/lib/notes';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Copia offline de Notes (components/notes/notesOffline.ts): notas completas
 * cambiadas desde ?since= (de a páginas con ?offset=), el índice de todas,
 * libretas y etiquetas. Solo las notas propias de quien pide.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const owner = noteOwner(user);
  const sp = req.nextUrl.searchParams;
  // ?probe=1: solo quién es la sesión. La app lo pide antes de abrir la copia
  // del dispositivo, reenviar cambios o sincronizar (que sea la misma persona).
  if (sp.get('probe') === '1') {
    return NextResponse.json({ owner: { userId: owner.personId, ws: owner.workspaceId } }, { headers: { 'cache-control': 'no-store' } });
  }
  const offset = Math.max(0, Math.floor(Number(sp.get('offset')) || 0));
  const [{ notes, index }, notebooks, tags] = await Promise.all([
    listNotesForSync(owner, { since: sp.get('since'), offset }),
    listNotebooks(owner),
    listTags(owner),
  ]);
  return NextResponse.json(
    {
      owner: { userId: owner.personId, ws: owner.workspaceId },
      notes,
      index,
      notebooks,
      tags,
      now: new Date().toISOString(),
      nextOffset: notes.length >= NOTES_SYNC_PAGE ? offset + notes.length : null,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
