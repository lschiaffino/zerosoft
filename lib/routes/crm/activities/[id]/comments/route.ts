import { NextRequest, NextResponse } from 'next/server';
import { realUserId } from '@/lib/session';
import { createComment, listComments } from '@/lib/crm-activity-comments';
import { invalidBody } from '@/lib/crm-http';
import { commentBodySchema, commentErrorResponse, localeOf, notifyCommentMentions, threadAccess } from '@/lib/crm-comments-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** El hilo de comentarios de una actividad (solo si quien pide ve la actividad). */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const access = await threadAccess(req, id);
  if (access instanceof NextResponse) return access;
  const comments = await listComments(access.user.id, id);
  return NextResponse.json({ comments, me: realUserId(access.user) });
}

/** Comentario nuevo, con aviso a los @mencionados que ven la actividad. */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const access = await threadAccess(req, id);
  if (access instanceof NextResponse) return access;
  const parsed = commentBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const { user } = access;
  try {
    const comment = await createComment(user.id, id, realUserId(user), parsed.data.body);
    const notice = await notifyCommentMentions(user, id, comment.body, localeOf(req));
    return NextResponse.json({ ...comment, ...notice }, { status: 201 });
  } catch (err) {
    return commentErrorResponse(err);
  }
}
