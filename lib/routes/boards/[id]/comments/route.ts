import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { isDenied, requireBoardAccess } from '@/lib/board-access-http';
import { boardExists } from '@/lib/boards';
import { createThread, listThreads } from '@/lib/board-comments';
import { boardAudience } from '@/lib/board-access';
import { boardCommentCreateSchema } from '@/lib/boards-schema';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Hilos de la pizarra (abiertos y resueltos) y quiénes se pueden mencionar (quienes la ven). */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const access = await requireBoardAccess(user, id, 'view');
  if (isDenied(access)) return access;
  if (!(await boardExists(user.id, id))) return jsonError(404, 'not_found');
  const [threads, members] = await Promise.all([listThreads(user.id, id), boardAudience(user.id, id)]);
  return NextResponse.json({ threads, members, me: user.actingUser?.id ?? user.id });
}

/** Hilo nuevo en un punto del lienzo. Body: { x, y, elementId?, body }. */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const access = await requireBoardAccess(user, id, 'view');
  if (isDenied(access)) return access;
  const personId = user.actingUser?.id ?? user.id;
  const limited = await limitWrites('boards:comments', personId, 60);
  if (limited) return limited;
  const parsed = boardCommentCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput(parsed.error);
  if (!(await boardExists(user.id, id))) return jsonError(404, 'not_found');
  const thread = await createThread(user.id, id, personId, parsed.data);
  return NextResponse.json(thread, { status: 201 });
}
