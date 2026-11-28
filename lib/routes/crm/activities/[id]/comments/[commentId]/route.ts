import { NextRequest, NextResponse } from 'next/server';
import { realUserId } from '@/lib/session';
import { deleteComment, getComment, updateComment } from '@/lib/crm-activity-comments';
import { maskChatTaskTexts, masksChatTask } from '@/lib/crm-chat-privacy';
import { unmaskEdit } from '@/lib/groups-mask';
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
    // Con los teléfonos ocultos, el comentario llegó enmascarado: los números guardados no se pierden al editarlo.
    const masked = await masksChatTask(id, access.reader);
    const stored = masked ? await getComment(user.id, commentId) : null;
    const body = stored && stored.activity_id === id ? unmaskEdit(stored.body, parsed.data.body) : parsed.data.body;
    const { before, after } = await updateComment(user.id, id, commentId, realUserId(user), body);
    const notice = await notifyCommentMentions(user, id, after.body, localeOf(req), before.body);
    const [shown] = await maskChatTaskTexts(id, access.reader, [after]);
    return NextResponse.json({ ...shown, ...notice });
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
