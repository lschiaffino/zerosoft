import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { accessAtLeast, boardViewer, getTrashedBoardAccess } from '@/lib/board-access';
import { deleteBoard, restoreBoard } from '@/lib/boards';
import { logBoardAudit } from '@/lib/board-audit';
import { getDb } from '@/lib/db';
import { jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Pizarra en la papelera. Con el mismo permiso que hizo falta para borrarla:
 * editar, y gestionar si está restringida. 404 si no está en la papelera o no
 * la puede ver.
 */
async function trashed(id: string): Promise<{ res: NextResponse } | { viewer: ReturnType<typeof boardViewer>; name: string | null }> {
  const user = await getCurrentUser();
  if (!user) return { res: jsonError(401, 'unauthorized') };
  const viewer = boardViewer(user);
  const level = await getTrashedBoardAccess(viewer, id);
  if (!level) return { res: jsonError(404, 'not_found') };
  const row = (await getDb().prepare('SELECT name, access FROM boards WHERE id = ? AND workspace_id = ?').get(id, viewer.workspaceId)) as
    | { name: string; access: string | null }
    | undefined;
  const need = row?.access === 'restricted' ? 'manage' : 'edit';
  if (!accessAtLeast(level, need)) return { res: jsonError(403, 'forbidden') };
  const limited = await limitWrites('boards:write', viewer.personId, 60);
  if (limited) return { res: limited };
  return { viewer, name: row?.name ?? null };
}

/** POST: la saca de la papelera. */
export async function POST(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const t = await trashed(id);
  if ('res' in t) return t.res;
  if (!(await restoreBoard(t.viewer.workspaceId, id))) return jsonError(404, 'not_found');
  await logBoardAudit({ workspaceId: t.viewer.workspaceId, actorId: t.viewer.personId, action: 'board.restored', boardId: id, boardName: t.name });
  return NextResponse.json({ ok: true });
}

/** DELETE: la borra para siempre (escena, imágenes, comentarios e historial). */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const t = await trashed(id);
  if ('res' in t) return t.res;
  if (!(await deleteBoard(t.viewer.workspaceId, id, { trashed: true }))) return jsonError(404, 'not_found');
  await logBoardAudit({ workspaceId: t.viewer.workspaceId, actorId: t.viewer.personId, action: 'board.purged', boardId: id, boardName: t.name });
  return new NextResponse(null, { status: 204 });
}
