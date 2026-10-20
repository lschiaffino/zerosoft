import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { replyToThread, updateThread } from '@/lib/board-comments';
import { boardCommentReplySchema, boardThreadPatchSchema } from '@/lib/boards-schema';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; threadId: string }> };

/** Responder el hilo. Body: { body }. Un hilo resuelto se reabre. */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id, threadId } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const personId = user.actingUser?.id ?? user.id;
  const limited = await limitWrites('boards:comments', personId, 60);
  if (limited) return limited;
  const parsed = boardCommentReplySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput(parsed.error);
  const thread = await replyToThread(user.id, id, threadId, personId, parsed.data.body);
  if (!thread) return jsonError(404, 'not_found');
  return NextResponse.json(thread, { status: 201 });
}

/** Resolver / reabrir ({ resolved }) o mover el pin ({ x, y }). */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id, threadId } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const personId = user.actingUser?.id ?? user.id;
  const limited = await limitWrites('boards:comments', personId, 120);
  if (limited) return limited;
  const parsed = boardThreadPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput(parsed.error);
  const thread = await updateThread(user.id, id, threadId, personId, parsed.data);
  if (!thread) return jsonError(404, 'not_found');
  return NextResponse.json(thread);
}
