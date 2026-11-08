import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { publishBoardEvent } from '@/lib/board-live';
import { isDenied, requireBoardAccess } from '@/lib/board-access-http';
import { deleteBoardComment } from '@/lib/board-comments';
import { jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Los demás editores abiertos vuelven a leer los comentarios (evento en vivo, sin el texto). */
const announce = (workspaceId: string, boardId: string) =>
  publishBoardEvent({ boardId, workspaceId, socketId: 'server', kind: 'comments' }).catch(() => undefined);


/** Borra un comentario propio (si era el último, también el hilo). */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string; threadId: string; commentId: string }> }) {
  const { id, threadId, commentId } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const access = await requireBoardAccess(user, id, 'view');
  if (isDenied(access)) return access;
  const personId = user.actingUser?.id ?? user.id;
  const limited = await limitWrites('boards:comments', personId, 60);
  if (limited) return limited;
  const res = await deleteBoardComment(user.id, id, threadId, commentId, personId);
  if (res.ok) {
    await announce(user.id, id);
    return NextResponse.json({ threadDeleted: res.threadDeleted });
  }
  return jsonError(res.code === 'forbidden' ? 403 : 404, res.code);
}
