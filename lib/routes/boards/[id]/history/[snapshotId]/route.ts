import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { isDenied, requireBoardAccess } from '@/lib/board-access-http';
import { restoreSnapshotAsCopy } from '@/lib/boards';
import { logBoardAudit } from '@/lib/board-audit';
import { boardRestoreSchema } from '@/lib/boards-schema';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Restaura una versión como pizarra nueva. Body: { name } (el cliente manda
 * el nombre ya traducido, con la fecha de la versión). La original no cambia.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; snapshotId: string }> }) {
  const { id, snapshotId } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const access = await requireBoardAccess(user, id, 'edit');
  if (isDenied(access)) return access;
  const personId = user.actingUser?.id ?? user.id;
  const limited = await limitWrites('boards:write', personId, 60);
  if (limited) return limited;
  const parsed = boardRestoreSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput(parsed.error);
  const board = await restoreSnapshotAsCopy(user.id, personId, id, snapshotId, parsed.data.name);
  if (!board) return jsonError(404, 'not_found');
  await logBoardAudit({ workspaceId: user.id, actorId: personId, action: 'board.version_restored', boardId: board.id, boardName: board.name, data: { from: id, snapshotId } });
  return NextResponse.json(board, { status: 201 });
}
