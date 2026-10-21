import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { isDenied, requireBoardAccess } from '@/lib/board-access-http';
import { duplicateBoard } from '@/lib/boards';
import { boardCreateSchema } from '@/lib/boards-schema';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Duplica la pizarra. Body opcional { name } (el cliente manda el nombre ya traducido). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const access = await requireBoardAccess(user, id, 'edit');
  if (isDenied(access)) return access;
  const personId = user.actingUser?.id ?? user.id;
  const limited = await limitWrites('boards:write', personId, 60);
  if (limited) return limited;
  const parsed = boardCreateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return invalidInput(parsed.error);
  const name = parsed.data.name;
  const board = await duplicateBoard(user.id, personId, id, name ? () => name : undefined);
  if (!board) return jsonError(404, 'not_found');
  return NextResponse.json(board, { status: 201 });
}
