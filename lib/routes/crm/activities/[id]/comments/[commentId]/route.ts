import { NextRequest, NextResponse } from 'next/server';
import { realUserId } from '@/lib/session';
import { deleteComment, updateComment } from '@/lib/crm-activity-comments';
import { invalidBody } from '@/lib/crm-http';
import { commentBodySchema, commentErrorResponse, localeOf, notifyCommentMentions, threadAccess } from '@/lib/crm-comments-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string; commentId: string }> };

/** Editar un comentario propio (solo avisa a quienes la edición suma como mencionados). */
export async function PATCH(req: NextRequest, props: Params) {
  const { id, commentId } = await props.params;
  const access = await threadAccess(req, id);
  if (access instanceof NextResponse) return access;
  const parsed = commentBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const { user } = access;
  try {
    const { before, after } = await updateComment(user.id, id, commentId, realUserId(user), parsed.data.body);
    const notice = await notifyCommentMentions(user, id, after.body, localeOf(req), before.body);
    return NextResponse.json({ ...after, ...notice });
  } catch (err) {
    return commentErrorResponse(err);
  }
}

/** Borrar un comentario propio. */
export async function DELETE(req: NextRequest, props: Params) {
  const { id, commentId } = await props.params;
  const access = await threadAccess(req, id);
  if (access instanceof NextResponse) return access;
  try {
    await deleteComment(access.user.id, id, commentId, realUserId(access.user));
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return commentErrorResponse(err);
  }
}
