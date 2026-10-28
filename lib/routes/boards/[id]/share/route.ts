import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { isDenied, requireBoardAccess } from '@/lib/board-access-http';
import { setBoardShared } from '@/lib/boards';
import { logBoardAudit } from '@/lib/board-audit';
import { boardShareSchema } from '@/lib/boards-schema';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Activa/desactiva el link público de solo lectura (/b/<token>). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const access = await requireBoardAccess(user, id, 'edit');
  if (isDenied(access)) return access;
  const limited = await limitWrites('boards:share', user.actingUser?.id ?? user.id, 30);
  if (limited) return limited;
  const parsed = boardShareSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput(parsed.error);
  const token = await setBoardShared(user.id, id, parsed.data.shared);
  if (token === false) return jsonError(404, 'not_found');
  await logBoardAudit({ workspaceId: user.id, actorId: user.actingUser?.id ?? user.id, action: 'share.link', boardId: id, data: { on: parsed.data.shared } });
  return NextResponse.json({ share_token: token });
}
