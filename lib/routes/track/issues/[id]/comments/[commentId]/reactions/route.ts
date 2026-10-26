import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { getAccessibleIssue } from '@/lib/track-data';
import { commentReactionSchema } from '@/lib/track-schema';
import { getComment, isAllowedReaction, listIssueReactions, toggleReaction } from '@/lib/track-ux';
import { invalidBody, notFound, trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string; commentId: string }> };

/** Pone o saca una reacción de la persona en un comentario; devuelve las reacciones del issue. */
export async function POST(req: NextRequest, props: Params) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const found = await getAccessibleIssue(params.id, user.team?.id ?? null, user.id);
  if (!found) return notFound();
  const comment = await getComment(found.issue.id, params.commentId);
  if (!comment) return notFound();

  const body: unknown = await req.json().catch(() => null);
  const parsed = commentReactionSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  if (!isAllowedReaction(parsed.data.emoji)) return trackError(400, 'invalid_reaction');

  const active = await toggleReaction(comment.id, realUserId(user), parsed.data.emoji);
  return NextResponse.json({ active, reactions: await listIssueReactions(found.issue.id) });
}
