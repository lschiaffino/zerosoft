import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { deleteBoardFolder, getBoardFolder, renameBoardFolder } from '@/lib/board-folders';
import { logBoardAudit } from '@/lib/board-audit';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ folderId: string }> };

const renameSchema = z.object({ name: z.string().trim().min(1).max(80) });

/** Renombra la carpeta (cualquiera del workspace, como una pizarra del workspace). */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { folderId } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const personId = user.actingUser?.id ?? user.id;
  const limited = await limitWrites('boards:write', personId, 60);
  if (limited) return limited;
  const parsed = renameSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput(parsed.error);
  const before = await getBoardFolder(user.id, folderId);
  const name = before ? await renameBoardFolder(user.id, folderId, parsed.data.name) : null;
  if (!name) return jsonError(404, 'not_found');
  await logBoardAudit({ workspaceId: user.id, actorId: personId, action: 'folder.renamed', data: { id: folderId, name, from: before?.name } });
  return NextResponse.json({ ok: true, name });
}

/** Borra la carpeta; sus pizarras quedan sin carpeta (no se borran). */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { folderId } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const personId = user.actingUser?.id ?? user.id;
  const limited = await limitWrites('boards:write', personId, 60);
  if (limited) return limited;
  const before = await getBoardFolder(user.id, folderId);
  if (!before || !(await deleteBoardFolder(user.id, folderId))) return jsonError(404, 'not_found');
  await logBoardAudit({ workspaceId: user.id, actorId: personId, action: 'folder.deleted', data: { id: folderId, name: before.name } });
  return new NextResponse(null, { status: 204 });
}
