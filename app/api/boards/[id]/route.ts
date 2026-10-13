import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { deleteBoard, getBoard, renameBoard } from '@/lib/boards';
import { boardRenameSchema } from '@/lib/boards-schema';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const board = await getBoard(user.id, id);
  if (!board) return jsonError(404, 'not_found');
  return NextResponse.json(board);
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const limited = await limitWrites('boards:write', user.actingUser?.id ?? user.id, 60);
  if (limited) return limited;
  const parsed = boardRenameSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput(parsed.error);
  if (!(await renameBoard(user.id, id, parsed.data.name))) return jsonError(404, 'not_found');
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const limited = await limitWrites('boards:write', user.actingUser?.id ?? user.id, 60);
  if (limited) return limited;
  if (!(await deleteBoard(user.id, id))) return jsonError(404, 'not_found');
  return new NextResponse(null, { status: 204 });
}
